import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "./config";
import { ensureLive } from "./auth";
import { sendInput } from "./contracts";
import { checkDraftCurrent, draftSnapshot, serial } from "./acquisition";
import { AppError, hash, json, object, workingDays } from "./util";
import { audit } from "./db";
import { googleFetch } from "./google";

type Snapshot = Awaited<ReturnType<typeof draftSnapshot>>["snapshot"];
export type GmailPart = { mimeType?: string; filename?: string; body?: { data?: string; attachmentId?: string }; headers?: { name: string; value: string }[]; parts?: GmailPart[] };
export type GmailMessage = { id: string; threadId: string; internalDate: string; labelIds?: string[]; snippet?: string; payload: GmailPart };
const flat = (part: GmailPart): GmailPart[] => [part, ...(part.parts || []).flatMap(flat)];
export const header = (message: GmailMessage, name: string) => message.payload.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
export const plainBody = (message: GmailMessage) => {
  const part = flat(message.payload).find(p => p.mimeType === "text/plain" && p.body?.data);
  if (part) return Buffer.from(part.body!.data!, "base64url").toString("utf8");
  const html = flat(message.payload).find(p => p.mimeType === "text/html" && p.body?.data);
  return html ? Buffer.from(html.body!.data!, "base64url").toString("utf8").replace(/<br\s*\/?\s*>/gi, "\n").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ") : message.snippet || "";
};
const normalizeBody = (text: string) => text.replace(/\r\n/g, "\n").replace(/\n+$/, "");
const address = (text: string) => (text.match(/<([^>]+)>/)?.[1] || text).trim().toLowerCase();

export async function ingestThread(client: PrismaClient, messages: GmailMessage[], owner: string, opportunityId?: string) {
  if (!messages.length) throw new AppError("EMPTY_THREAD", "Der Gesprächsverlauf ist leer.");
  if(messages.some(m=>m.threadId!==messages[0].threadId))throw new AppError("MIXED_THREADS","Die Nachrichten gehören nicht zum selben Gespräch.",409);
  if(opportunityId&&!await client.opportunity.findUnique({where:{id:opportunityId}}))throw new AppError("THREAD_LINK","Die zugeordnete Projektchance fehlt.",404);
  const ordered = [...messages].sort((a,b) => Number(a.internalDate) - Number(b.internalDate));
  const latest = ordered.at(-1)!;
  const revision = hash(ordered.map(m => ({ id: m.id, time: m.internalDate,content:hash({from:header(m,'from'),to:header(m,'to'),subject:header(m,'subject'),body:plainBody(m)}) })));
  const direction = latest.labelIds?.includes("SENT") ? "outgoing" : "incoming";
  const subject = header(latest, "subject");
  const from = header(latest, "from");
  const automatic = header(latest, "auto-submitted");
  const classification = /mailer-daemon|postmaster/i.test(from) || /undeliver|zustell|delivery status/i.test(subject) ? "bounce" : automatic && automatic !== "no" || /out of office|abwesen|automatic reply/i.test(subject) ? "away" : "normal";
  const result = await serial(client, async tx => {
    const old = await tx.mailThread.findUnique({ where: { providerId: latest.threadId } });
    if(old?.opportunityId&&opportunityId&&old.opportunityId!==opportunityId)throw new AppError('THREAD_ALREADY_LINKED','Dieses Gespräch ist bereits einer anderen Projektchance zugeordnet.',409);
    const associated = opportunityId || old?.opportunityId || null;
    const value = { opportunityId: associated, revision, latestMessageId: latest.id, latestAt: new Date(Number(latest.internalDate)), direction, classification, messages: json(ordered.map(m => ({ id: m.id, time: m.internalDate, subject: header(m,"subject"), from: header(m,"from"), to: header(m,"to"), body: plainBody(m).slice(0,16_000), labels: m.labelIds || [] }))) };
    const thread = await tx.mailThread.upsert({ where: { providerId: latest.threadId }, create: { providerId: latest.threadId, ...value }, update: value });
    if (direction === "incoming" && (old?.revision !== revision||old?.opportunityId!==associated) && associated) {
      await tx.task.updateMany({ where: { opportunityId: associated, kind: "followup", status: "open" }, data: { status: "stopped" } });
      const drafts = await tx.draft.findMany({ where: { opportunityId: associated }, select: {id: true} });
      await tx.outbox.updateMany({ where: { draftId: { in: drafts.map(d => d.id) }, status: "approved" }, data: { status: "stale", errorCode: "REPLY_RECEIVED" } });
      await tx.task.upsert({ where: { dedupeKey: `reply:${latest.id}` }, create: { dedupeKey: `reply:${latest.id}`, title: classification === "bounce" ? "Unzustellbarkeit prüfen" : classification === "away" ? "Abwesenheitsantwort prüfen" : "Neue Antwort prüfen", kind: "reply", opportunityId: associated, notes: subject }, update: {} });
      if (classification === "normal") await tx.opportunity.updateMany({ where: { id: associated,stage:{in:['new','reviewed','prepared','submitted','conversation']} }, data: { stage: "conversation" } });
    }
    return thread;
  });
  await audit(client, "thread.synced", owner, result.id, { classification, direction, revision });
  return result;
}

export async function refreshThread(client: PrismaClient, providerId: string, owner: string, opportunityId?: string) {
  const thread = await googleFetch<{messages?: GmailMessage[]}>(client, "gmail", `threads/${encodeURIComponent(providerId)}?format=full`);
  return ingestThread(client, thread.messages || [], owner, opportunityId);
}

export async function approveSend(client: PrismaClient, input: unknown, owner: string, liveGate = true) {
  if (liveGate) { ensureLive(); if (!config().mailEnabled) throw new AppError("MAIL_DISABLED", "Der echte Versand ist noch nicht aktiviert.", 409); }
  const parsed = sendInput.parse(input);
  const result = await serial(client, async tx => {
    const repeated = await tx.outbox.findUnique({ where: { idempotencyKey: parsed.idempotencyKey } });
    if (repeated) {
      if (repeated.draftId !== parsed.draftId || repeated.snapshotHash !== parsed.snapshotHash) throw new AppError("SEND_CONFLICT", "Dieser Versandauftrag gehört zu einer anderen Version.", 409);
      return repeated;
    }
    const draft = await tx.draft.findUniqueOrThrow({ where: { id: parsed.draftId } });
    await checkDraftCurrent(tx, draft);
    if (!draft.recipient) throw new AppError("NO_RECIPIENT", "Bitte eine bestätigte Empfängeradresse eintragen.");
    const snapshot = await draftSnapshot(tx, draft);
    if (snapshot.snapshotHash !== parsed.snapshotHash) throw new AppError("SNAPSHOT_CHANGED", "Die angezeigte Version hat sich geändert. Bitte erneut vollständig prüfen.", 409);
    const prior = await tx.outbox.findUnique({ where: { draftId: draft.id } });
    if (prior) {
      if(prior.status==="approved"&&Date.now()-prior.approvedAt.getTime()>10*60_000)return tx.outbox.update({where:{id:prior.id},data:{approvedAt:new Date(),approvedBy:owner,idempotencyKey:parsed.idempotencyKey}});
      return prior;
    }
    const uncertain = await tx.outbox.findFirst({ where: { status: { in: ["sending", "uncertain"] }, draftId: { in: (await tx.draft.findMany({ where: { opportunityId: draft.opportunityId }, select: {id:true} })).map(d => d.id) } } });
    if (uncertain) throw new AppError("UNCERTAIN_SEND", "Ein früherer Versandversuch muss zuerst geklärt werden.", 409);
    return tx.outbox.create({ data: { draftId: draft.id, idempotencyKey: parsed.idempotencyKey, snapshotHash: snapshot.snapshotHash, snapshot: json(snapshot.snapshot), approvedBy: owner } });
  });
  await audit(client, "send.approved", owner, result.id, { snapshotHash: result.snapshotHash });
  return result;
}

export async function prepareClaim(client: PrismaClient, outboxId: string) {
  ensureLive();
  if (!config().mailEnabled) throw new AppError("MAIL_DISABLED", "Versand ist deaktiviert.", 409);
  const pending = await client.outbox.findUniqueOrThrow({ where: {id:outboxId} });
  if (pending.status !== "approved") throw new AppError("OUTBOX_CLAIMED", "Dieser Versandauftrag wurde bereits bearbeitet oder muss geprüft werden.", 409);
  const snapshot = object<Snapshot>(pending.snapshot);
  if(!snapshot.recipient || /(^|\.)(example|invalid|test)$/.test(snapshot.recipient.split("@")[1]))throw new AppError("EXAMPLE_RECIPIENT","Beispieladressen können nicht versendet werden.",409);
  if (snapshot.threadId) await refreshThread(client, snapshot.threadId, pending.approvedBy, (await client.draft.findUniqueOrThrow({where:{id:pending.draftId}})).opportunityId);
  const sent = await googleFetch<{messages?: {id:string}[]}>(client, "gmail", `messages?${new URLSearchParams({ q: `in:sent rfc822msgid:${pending.id}@${config().owner.split("@")[1]}`, maxResults: "5" })}`);
  if (sent.messages?.length) {
    await client.outbox.update({where:{id:pending.id},data:{status:"uncertain",errorCode:"EXISTING_SENT_MESSAGE"}});
    throw new AppError("EXISTING_SENT", "Gmail enthält bereits eine passende Nachricht. Bitte den Versand abgleichen.",409);
  }
  return serial(client, async tx => {
    const box = await tx.outbox.findUniqueOrThrow({ where: { id: outboxId } });
    if (box.status !== "approved" || Date.now() - box.approvedAt.getTime() > 10 * 60_000) throw new AppError("APPROVAL_EXPIRED", "Der Versandauftrag muss erneut geprüft werden.", 409);
    const draft = await tx.draft.findUniqueOrThrow({ where: { id: box.draftId } });
    await checkDraftCurrent(tx, draft);
    if ((await draftSnapshot(tx, draft)).snapshotHash !== box.snapshotHash) throw new AppError("SNAPSHOT_CHANGED", "Die freigegebene Version hat sich geändert.", 409);
    await tx.outbox.update({ where: { id: outboxId }, data: { status: "sending", attemptedAt: new Date() } });
    return box;
  });
}

export async function rawMime(client: PrismaClient, outboxId: string) {
  const box = await client.outbox.findUniqueOrThrow({ where:{id:outboxId} });
  const snapshot = object<Snapshot>(box.snapshot);
  const boundary = `os_${box.id.replaceAll("-", "")}`;
  const headers = [`From: ${config().owner}`, `To: ${snapshot.recipient}`, `Subject: =?UTF-8?B?${Buffer.from(snapshot.subject).toString("base64")}?=`, `Message-ID: <${box.id}@${config().owner.split("@")[1]}>`, "MIME-Version: 1.0", `Content-Type: multipart/mixed; boundary="${boundary}"`];
  if (snapshot.threadId) {
    const thread = await client.mailThread.findUnique({where:{providerId:snapshot.threadId}});
    if (thread) {
      const provider = await googleFetch<GmailMessage>(client,"gmail",`messages/${encodeURIComponent(thread.latestMessageId)}?format=metadata&metadataHeaders=Message-ID`);
      const messageId = header(provider,"message-id");
      if (/^<[^<>\r\n]+>$/.test(messageId)) headers.push(`In-Reply-To: ${messageId}`, `References: ${messageId}`);
    }
  }
  const fold64 = (buffer: Buffer) => buffer.toString("base64").match(/.{1,76}/g)?.join("\r\n") || "";
  const parts = [`--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${fold64(Buffer.from(snapshot.body))}`];
  for (const attachment of snapshot.attachments) {
    const record = await client.attachment.findUniqueOrThrow({where:{id:attachment.id}});
    const bytes = await readFile(path.join(config().dataDir,"attachments",record.storageKey));
    if (hash(bytes.toString("base64")) !== attachment.hash) throw new AppError("ATTACHMENT_CHANGED", "Ein Anhang stimmt nicht mehr mit der Freigabe überein.",409);
    parts.push(`--${boundary}\r\nContent-Type: ${attachment.mimeType}\r\nContent-Disposition: attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}\r\nContent-Transfer-Encoding: base64\r\n\r\n${fold64(bytes)}`);
  }
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n--${boundary}--\r\n`).toString("base64url");
}

export async function verifyReceipt(client: PrismaClient, outboxId: string, message: GmailMessage) {
  const box = await client.outbox.findUniqueOrThrow({where:{id:outboxId}});
  const snapshot = object<Snapshot>(box.snapshot);
  const attachments = flat(message.payload).filter(p => p.filename);
  if (!message.labelIds?.includes("SENT") || header(message,"message-id")!==`<${box.id}@${config().owner.split("@")[1]}>` || header(message,"cc") || header(message,"bcc") || header(message,"to").includes(",") || address(header(message,"to")) !== snapshot.recipient?.toLowerCase() || address(header(message,"from")) !== config().owner || header(message,"subject") !== snapshot.subject || normalizeBody(plainBody(message)) !== normalizeBody(snapshot.body) || (snapshot.threadId && message.threadId !== snapshot.threadId) || attachments.length !== snapshot.attachments.length) throw new AppError("RECEIPT_MISMATCH", "Die Gmail-Bestätigung passt nicht vollständig zur freigegebenen Nachricht.", 409);
  for (const expected of snapshot.attachments) {
    const actual = attachments.find(p => p.filename === expected.name);
    if (!actual) throw new AppError("ATTACHMENT_RECEIPT", "Ein bestätigter Anhang fehlt im Versandnachweis.",409);
    let data = actual.body?.data;
    if (!data && actual.body?.attachmentId) data = (await googleFetch<{data:string}>(client,"gmail",`messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(actual.body.attachmentId)}`)).data;
    if (!data || hash(Buffer.from(data,"base64url").toString("base64")) !== expected.hash) throw new AppError("ATTACHMENT_RECEIPT", "Der Inhalt eines versendeten Anhangs passt nicht zur Freigabe.",409);
  }
  const result = await serial(client, async tx => {
    const current = await tx.outbox.findUniqueOrThrow({where:{id:outboxId}});
    if (!['sending','uncertain','sent'].includes(current.status)) throw new AppError("RECEIPT_STATE", "Dieser Versandauftrag wartet nicht auf eine Bestätigung.",409);
    if(current.status==='sent'){if(current.providerMessageId!==message.id)throw new AppError('RECEIPT_MISMATCH','Eine weitere Gmail-Nachricht kann den vorhandenen Versandnachweis nicht ersetzen.',409);return current;}
    const sentBox = await tx.outbox.update({where:{id:outboxId},data:{status:"sent",providerMessageId:message.id,providerThreadId:message.threadId,receipt:json({messageId:message.id,threadId:message.threadId,snapshotHash:box.snapshotHash,recipient:snapshot.recipient,attachments:snapshot.attachments.map(a=>a.hash)}),verifiedAt:new Date(),errorCode:null}});
    const draft = await tx.draft.findUniqueOrThrow({where:{id:box.draftId}});
    if(draft.kind==="application"){
      const sentAt=new Date(Number(message.internalDate));
      await tx.opportunity.update({where:{id:draft.opportunityId},data:{stage:"submitted",submittedAt:sentAt,submissionProof:`gmail:${message.id}`}});
      for (const days of [5,10]) await tx.task.upsert({where:{dedupeKey:`followup:${box.id}:${days}`},create:{dedupeKey:`followup:${box.id}:${days}`,title:`Bewerbung nach ${days} Werktagen prüfen`,kind:"followup",opportunityId:draft.opportunityId,dueAt:workingDays(sentAt,days)},update:{}});
    }
    return sentBox;
  });
  await audit(client,"send.verified",box.approvedBy,box.id,{messageId:message.id,threadId:message.threadId});
  return result;
}

export async function dispatchOutbox(client: PrismaClient, outboxId: string,viaIntegration=false) {
  const existing = await client.outbox.findUniqueOrThrow({where:{id:outboxId}});
  if (existing.status !== "approved") return existing;
  if (process.env.N8N_DISPATCH_URL&&!viaIntegration) {
    // n8n claims the approval through /api/integrations/outbox/claim before transport.
    try { await fetch(process.env.N8N_DISPATCH_URL, {method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${process.env.N8N_DISPATCH_TOKEN || ""}`},body:JSON.stringify({outboxId}),signal:AbortSignal.timeout(20_000)}); }
    catch { /* The claim state, not this webhook timeout, determines whether sending began. */ }
    return client.outbox.findUniqueOrThrow({where:{id:outboxId}});
  }
  const claimed = await prepareClaim(client,outboxId);
  try {
    const raw = await rawMime(client,outboxId);
    const snapshot = object<Snapshot>(claimed.snapshot);
    const sent = await googleFetch<{id:string;threadId:string}>(client,"gmail","messages/send",{method:"POST",body:JSON.stringify({raw,...(snapshot.threadId?{threadId:snapshot.threadId}:{})})});
    const message = await googleFetch<GmailMessage>(client,"gmail",`messages/${encodeURIComponent(sent.id)}?format=full`);
    const verified = await verifyReceipt(client,outboxId,message);
    const draft=await client.draft.findUniqueOrThrow({where:{id:claimed.draftId}});
    await refreshThread(client,message.threadId,claimed.approvedBy,draft.opportunityId);
    return verified;
  } catch {
    await client.outbox.updateMany({where:{id:outboxId,status:"sending"},data:{status:"uncertain",errorCode:"TRANSPORT_UNCONFIRMED"}});
    await audit(client,"send.uncertain",claimed.approvedBy,outboxId,{});
    return client.outbox.findUniqueOrThrow({where:{id:outboxId}});
  }
}

export async function reconcileOutbox(client: PrismaClient, outboxId: string) {
  ensureLive();
  const box = await client.outbox.findUniqueOrThrow({where:{id:outboxId}});
  if (!['sending','uncertain'].includes(box.status)) throw new AppError("RECONCILE_STATE","Dieser Auftrag wartet nicht auf Versandabgleich.",409);
  const matches=await googleFetch<{messages?:{id:string}[]}>(client,"gmail",`messages?${new URLSearchParams({q:`in:sent rfc822msgid:${box.id}@${config().owner.split("@")[1]}`,maxResults:"10"})}`);
  if (matches.messages?.length !== 1) throw new AppError("RECONCILE_OPEN","Kein eindeutiger Versandnachweis gefunden. Der Auftrag bleibt gesperrt.",409);
  const message=await googleFetch<GmailMessage>(client,"gmail",`messages/${encodeURIComponent(matches.messages[0].id)}?format=full`);
  return verifyReceipt(client,outboxId,message);
}
