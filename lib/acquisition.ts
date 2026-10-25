import type { Prisma, PrismaClient, Draft } from "@/generated/prisma/client";
import { analysisSchema, sourceInput, profileInput, draftEditInput, type AnalysisResult, type Claim } from "./contracts";
import { AppError, canonicalUrl, hash, json, object } from "./util";
import { audit } from "./db";

export async function serial<T>(client: PrismaClient, run: (tx: Prisma.TransactionClient) => Promise<T>) {
  await client.runtimeState.upsert({ where: { id: "singleton" }, create: { id: "singleton" }, update: {} });
  return client.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "RuntimeState" WHERE "id" = 'singleton' FOR UPDATE`; return run(tx); }, { timeout: 15_000 });
}

export async function currentProfile(client: PrismaClient) {
  const profile = await client.profile.findFirst({ where: { confirmed: true }, orderBy: { version: "desc" } });
  if (!profile) throw new AppError("PROFILE_REQUIRED", "Bestätige zuerst dein Kompetenzprofil.", 409);
  return profile;
}

export async function saveProfile(client: PrismaClient, input: unknown, owner: string) {
  const parsed = profileInput.parse(input);
  if (new Set(parsed.claims.map(c => c.id)).size !== parsed.claims.length) throw new AppError("CLAIM_IDS", "Jeder Profilbeleg braucht eine eindeutige Kennung.");
  const evidenceIds = [...new Set(parsed.claims.flatMap(c => c.evidenceIds))];
  if (evidenceIds.length && await client.evidence.count({ where: { id: { in: evidenceIds }, confirmed: true } }) !== evidenceIds.length) throw new AppError("PROFILE_EVIDENCE", "Verknüpfte Arbeitsbelege müssen von dir bestätigt sein.");
  const profile = await serial(client, async tx => {
    const previous = await tx.profile.findFirst({ orderBy: { version: "desc" } });
    const created = await tx.profile.create({ data: { ...parsed, claims: json(parsed.claims), skills: json(parsed.skills), version: (previous?.version || 0) + 1 } });
    await tx.outbox.updateMany({ where: { status: "approved" }, data: { status: "stale", errorCode: "PROFILE_CHANGED" } });
    return created;
  });
  await audit(client, "profile.confirmed", owner, profile.id, { version: profile.version });
  return profile;
}

export async function ingestSource(client: PrismaClient, input: unknown, owner: string) {
  const parsed = sourceInput.parse(input);
  const contentHash = hash(parsed.content);
  const url = parsed.url ? canonicalUrl(parsed.url) : null;
  const fingerprint = hash(url || parsed.content.toLowerCase().replace(/\s+/g, " ").trim());
  const result = await serial(client, async tx => {
    const existingEvent = await tx.sourceEvent.findUnique({ where: { externalId: parsed.externalId } });
    if (existingEvent) {
      if (existingEvent.contentHash !== contentHash) throw new AppError("EVENT_CONFLICT", "Diese Quellenkennung wurde bereits mit anderem Inhalt verwendet.", 409);
      return { opportunity: await tx.opportunity.findUnique({ where: { id: existingEvent.opportunityId! } }), duplicate: true };
    }
    const existing = await tx.opportunity.findUnique({ where: { fingerprint } });
    const opportunity = existing
      ? (existing.contentHash === contentHash ? existing : await tx.opportunity.update({ where: { id: existing.id }, data: { content: parsed.content, contentHash, title: parsed.title, company: parsed.company, analysisId: null } }))
      : await tx.opportunity.create({ data: { fingerprint, title: parsed.title, company: parsed.company, url, content: parsed.content, contentHash, sourceKind: parsed.kind } });
    if (existing && existing.contentHash !== contentHash) {
      const drafts = await tx.draft.findMany({ where: { opportunityId: opportunity.id }, select: { id: true } });
      await tx.outbox.updateMany({ where: { draftId: { in: drafts.map(d => d.id) }, status: "approved" }, data: { status: "stale", errorCode: "SOURCE_CHANGED" } });
    }
    await tx.sourceEvent.create({ data: { externalId: parsed.externalId, kind: parsed.kind, url, content: parsed.content, contentHash, opportunityId: opportunity.id } });
    return { opportunity, duplicate: !!existing };
  });
  await audit(client, "source.ingested", owner, result.opportunity?.id || null, { duplicate: result.duplicate, kind: parsed.kind });
  return result;
}

export function validateAnalysis(content: string, claims: Claim[], value: unknown,sourceTitle?:string): AnalysisResult {
  const parsed = analysisSchema.parse(value);
  const known = new Set(claims.flatMap(c => [c.id, ...c.evidenceIds]));
  for(const proof of parsed.fieldEvidence)if(!content.includes(proof.quote))throw new AppError("QUOTE_NOT_FOUND","Ein Textbeleg für eine extrahierte Angabe fehlt im Original.",422);
  for(const [field,value] of Object.entries(parsed.extracted))if(value!==null&&!parsed.fieldEvidence.some(p=>p.field===field))throw new AppError("FIELD_EVIDENCE","Eine angegebene Projektinformation braucht einen Originalbeleg.",422);
  for (const requirement of parsed.requirements) {
    if (!content.includes(requirement.quote)&&!sourceTitle?.includes(requirement.quote)) throw new AppError("QUOTE_NOT_FOUND", "Ein Anforderungsbeleg fehlt im Originaltext und im erfassten Originaltitel.", 422);
    if (requirement.evidenceIds.some(v => !known.has(v))) throw new AppError("INVENTED_EVIDENCE", "Die Analyse nennt einen nicht vorhandenen Profilbeleg.", 422);
    if (["belegt", "teilweise"].includes(requirement.assessment) && !requirement.evidenceIds.length) throw new AppError("MISSING_EVIDENCE", "Eine positive Kompetenzbewertung braucht einen bestätigten Beleg.", 422);
  }
  if (parsed.extracted.contactEmail && !content.toLowerCase().includes(parsed.extracted.contactEmail.toLowerCase())) throw new AppError("INVENTED_EMAIL", "Die Kontaktadresse steht nicht in der Ausschreibung.", 422);
  return parsed;
}

export async function checkDraftCurrent(client: PrismaClient | Prisma.TransactionClient, draft: Draft) {
  const opportunity = await client.opportunity.findUniqueOrThrow({ where: { id: draft.opportunityId } });
  const profile = await client.profile.findFirst({ where: { confirmed: true }, orderBy: { version: "desc" } });
  const latest = await client.draft.findFirst({ where: { opportunityId: draft.opportunityId }, orderBy: { revision: "desc" } });
  if (latest?.id !== draft.id || draft.profileId !== profile?.id || draft.contentHash !== opportunity.contentHash) throw new AppError("DRAFT_STALE", "Ausschreibung, Profil oder Entwurf wurden geändert. Prüfe eine neue Entwurfsversion.", 409);
  if (draft.threadId) {
    const thread = await client.mailThread.findUnique({ where: { providerId: draft.threadId } });
    if (!thread || thread.revision !== draft.threadRevision) throw new AppError("THREAD_CHANGED", "Im Gespräch gibt es einen neuen Stand. Prüfe den Antwortentwurf erneut.", 409);
  }
  return opportunity;
}

export async function draftSnapshot(client: PrismaClient | Prisma.TransactionClient, draft: Draft) {
  const ids = object<string[]>(draft.attachmentIds);
  const attachments = await client.attachment.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" } });
  if (attachments.length !== ids.length) throw new AppError("ATTACHMENT_MISSING", "Ein ausgewählter Anhang fehlt.", 409);
  const snapshot = { draftId: draft.id, revision: draft.revision, recipient: draft.recipient, subject: draft.subject, body: draft.body, attachments: attachments.map(a => ({ id: a.id, name: a.name, mimeType: a.mimeType, size: a.size, hash: a.hash })), profileId: draft.profileId, contentHash: draft.contentHash, threadId: draft.threadId, threadRevision: draft.threadRevision };
  return { snapshot, snapshotHash: hash(snapshot) };
}

export async function editDraft(client: PrismaClient, draftId: string, input: unknown, owner: string) {
  const parsed = draftEditInput.parse(input);
  const original = await client.draft.findUniqueOrThrow({ where: { id: draftId } });
  const result = await serial(client, async tx => {
    const latest = await tx.draft.findFirstOrThrow({ where: { opportunityId: original.opportunityId }, orderBy: { revision: "desc" } });
    if (latest.id !== original.id) throw new AppError("DRAFT_STALE", "Es gibt bereits einen neueren Entwurf.", 409);
    await tx.outbox.updateMany({ where: { draftId: original.id, status: "approved" }, data: { status: "stale", errorCode: "DRAFT_CHANGED" } });
    const thread = original.threadId ? await tx.mailThread.findUnique({ where: { providerId: original.threadId } }) : null;
    const { id: _id, createdAt: _createdAt, ...copy } = original;
    const profile = await tx.profile.findFirstOrThrow({ where: { confirmed: true }, orderBy: { version: "desc" } });
    const opportunity = await tx.opportunity.findUniqueOrThrow({ where: { id: original.opportunityId } });
    return tx.draft.create({ data: { ...copy, ...parsed, references:json(original.references),warnings:json(original.warnings),profileId: profile.id, contentHash: opportunity.contentHash, threadRevision: thread?.revision ?? null, attachmentIds: json(parsed.attachmentIds), revision: latest.revision + 1 } });
  });
  await audit(client, "draft.revised", owner, result.id, { previousId: original.id, revision: result.revision });
  return result;
}
