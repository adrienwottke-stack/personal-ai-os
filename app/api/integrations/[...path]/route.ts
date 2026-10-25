import { z } from 'zod';
import { db, audit } from '@/lib/db';
import { integrationAuth, ensureLive } from '@/lib/auth';
import { config } from '@/lib/config';
import { failure, readJson, respond } from '@/lib/http';
import { ingestSource } from '@/lib/acquisition';
import { dispatchOutbox, prepareClaim, rawMime, verifyReceipt, refreshThread, type GmailMessage } from '@/lib/mail';
import { googleFetch } from '@/lib/google';
import { syncGmail, syncLinkedThreads, schedulerTick } from '@/lib/scheduler';
import { AppError, object } from '@/lib/util';
import { morningBriefingTick } from '@/lib/personal';
import { integrationRun } from '@/lib/integration-run';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}){
  try{
    integrationAuth(request);ensureLive();const client=await db();const route=(await params).path.join('/');const payload=await readJson(request);const owner=config().owner;
    switch(route){
      case 'sources':return respond(await ingestSource(client,payload,'n8n'));
      case 'gmail/sync':return respond(await integrationRun(client,'gmail',payload,()=>syncGmail(client,'n8n')));
      case 'threads/sync':return respond(await syncLinkedThreads(client,'n8n'));
      case 'schedule/tick':return respond(await schedulerTick(client,'n8n'));
      case 'personal/briefing':return respond(await integrationRun(client,'briefing',payload,()=>morningBriefingTick(client,'n8n')));
      case 'threads/link':{const p=z.object({providerId:z.string().regex(/^[a-zA-Z0-9_-]+$/),opportunityId:z.string()}).strict().parse(payload);return respond(await refreshThread(client,p.providerId,owner,p.opportunityId));}
      case 'outbox/dispatch':{const p=z.object({outboxId:z.string()}).strict().parse(payload);const result=await dispatchOutbox(client,p.outboxId,true);return respond({id:result.id,status:result.status});}
      case 'outbox/claim':{const p=z.object({outboxId:z.string()}).strict().parse(payload);const box=await prepareClaim(client,p.outboxId);try{return respond({outboxId:box.id,raw:await rawMime(client,box.id),threadId:object<any>(box.snapshot).threadId});}catch(error){await client.outbox.update({where:{id:box.id},data:{status:'uncertain',errorCode:'MIME_PREPARATION_FAILED'}});throw error;}}
      case 'outbox/receipt':{const p=z.object({outboxId:z.string(),messageId:z.string().regex(/^[a-zA-Z0-9_-]+$/)}).strict().parse(payload);try{const message=await googleFetch<GmailMessage>(client,'gmail',`messages/${p.messageId}?format=full`);const result=await verifyReceipt(client,p.outboxId,message);const draft=await client.draft.findUniqueOrThrow({where:{id:result.draftId}});await refreshThread(client,message.threadId,owner,draft.opportunityId);return respond({id:result.id,status:result.status});}catch(error){await client.outbox.updateMany({where:{id:p.outboxId,status:'sending'},data:{status:'uncertain',errorCode:'RECEIPT_UNCONFIRMED'}});throw error;}}
      case 'outbox/uncertain':{const p=z.object({outboxId:z.string()}).strict().parse(payload);await client.outbox.updateMany({where:{id:p.outboxId,status:'sending'},data:{status:'uncertain',errorCode:'TRANSPORT_UNCONFIRMED'}});await audit(client,'send.uncertain','n8n',p.outboxId,{});return respond({requiresReconciliation:true});}
      default:throw new AppError('UNKNOWN_ROUTE','Diese Integrationsschnittstelle existiert nicht.',404);
    }
  }catch(error){return failure(error);}
}
