import { z } from "zod";
import { db, audit } from "./db";
import { config } from "./config";
import { AppError, hash, json, object,canonicalUrl } from "./util";
import { enrichSource } from './sources';
import { currentProfile, draftSnapshot, editDraft, ingestSource, saveProfile, serial } from "./acquisition";
import { approveSend, dispatchOutbox, reconcileOutbox, refreshThread } from "./mail";
import { enqueue, queueAnalysis, queueDraft, workOnce } from "./jobs";
import { addEvidence, closeSession, createProject, prepareDay, publish, queueContent, recordPayment, recordTime, saveDocument } from "./business";
import { stageInput } from "./contracts";
import { searchDocuments, technicalContext } from "./knowledge";
import { startEval } from "./evals";
import { calendarEvents } from "./google";
import { syncGmail, schedulerTick } from "./scheduler";
import { buildBriefing, calendarDay, correctMeal, recordMeal, removeMeal, savePersonalSettings } from './personal';

const identifier=z.object({id:z.string().min(1).max(120)});
export async function action(name:string,payload:unknown,owner:string){
  if(name==='worker.once'&&!config().demo)throw new AppError('WORKER_BACKGROUND','Deine KI-Aufträge werden automatisch im Hintergrund bearbeitet. Aktualisiere den Auftragsstatus.',409);
  const client=await db();
  switch(name){
    case 'personal.briefing':return buildBriefing(client,owner);
    case 'personal.settings':return savePersonalSettings(client,payload,owner);
    case 'day.review':{const p=z.object({day:calendarDay,maintenanceMinutes:z.number().int().min(0).max(1440),savedMinutes:z.number().int().min(0).max(1440),usefulStep:z.string().trim().max(2000)}).strict().parse(payload);return client.dayReview.upsert({where:{day:p.day},create:p,update:p});}
    case 'task.edit':{const p=z.object({id:z.string(),title:z.string().trim().min(1).max(500),dueAt:z.string().datetime().nullable(),notes:z.string().max(2000).nullable()}).strict().parse(payload);const result=await client.task.update({where:{id:p.id},data:{title:p.title,dueAt:p.dueAt?new Date(p.dueAt):null,notes:p.notes}});await audit(client,'task.edited',owner,result.id,{});return result;}
    case 'task.reopen':{const result=await client.task.update({where:{id:identifier.parse(payload).id},data:{status:'open'}});await audit(client,'task.reopened',owner,result.id,{});return result;}
    case 'meal.add':return recordMeal(client,payload,owner);
    case 'meal.edit':return correctMeal(client,payload,owner);
    case 'meal.remove':return removeMeal(client,payload,owner);
    case 'personal.task':{const p=z.object({title:z.string().trim().min(1).max(500),kind:z.enum(['personal','training','learning','acquisition']),dueAt:z.string().datetime().nullable(),notes:z.string().max(2000).nullable()}).strict().parse(payload);return client.task.create({data:{...p,dueAt:p.dueAt?new Date(p.dueAt):null}});}
    case "source.add":return ingestSource(client,payload,owner);
    case "source.enrich":return enrichSource(client,identifier.parse(payload).id,owner);
    case "research.import":{const p=z.object({jobId:z.string(),index:z.number().int().min(0).max(9)}).strict().parse(payload);const job=await client.job.findUniqueOrThrow({where:{id:p.jobId}});if(job.kind!=='research'||job.status!=='completed')throw new AppError('RESEARCH_PENDING','Der Rechercheauftrag ist noch nicht abgeschlossen.',409);const proposal=object<any>(job.result).opportunities?.[p.index];if(!proposal)throw new AppError('RESEARCH_RESULT','Dieser Recherchetreffer fehlt.',404);const {fetchPublicSource}=await import('./sources');const source=await fetchPublicSource(proposal.url);return ingestSource(client,{externalId:`research:${job.id}:${p.index}`,kind:'public',company:null,...source},owner);}
    case "profile.save":return saveProfile(client,payload,owner);
    case "source.analyze":return queueAnalysis(client,identifier.parse(payload).id,owner);
    case "draft.generate":{const p=z.object({id:z.string(),threadId:z.string().optional()}).parse(payload);return queueDraft(client,p.id,owner,p.threadId);}
    case "draft.edit":{const p=z.object({id:z.string(),draft:z.unknown()}).parse(payload);return editDraft(client,p.id,p.draft,owner);}
    case "draft.preview":{const draft=await client.draft.findUniqueOrThrow({where:{id:identifier.parse(payload).id}});return {...await draftSnapshot(client,draft),draft};}
    case "draft.send":{const box=await approveSend(client,payload,owner);return dispatchOutbox(client,box.id);}
    case "send.reconcile":return reconcileOutbox(client,identifier.parse(payload).id);
    case "thread.refresh":return refreshThread(client,identifier.parse(payload).id,owner);
    case "thread.link":{const p=z.object({id:z.string(),providerId:z.string().regex(/^[a-zA-Z0-9_-]+$/)}).strict().parse(payload);return refreshThread(client,p.providerId,owner,p.id);}
    case "source.star":{const p=z.object({id:z.string(),starred:z.boolean()}).parse(payload);return client.opportunity.update({where:{id:p.id},data:{starred:p.starred}});}
    case "source.stage":{
      const p=z.object({id:z.string(),change:z.unknown()}).parse(payload);const change=stageInput.parse(p.change);
      const source=await client.opportunity.findUniqueOrThrow({where:{id:p.id}});
      if(change.stage==="submitted" && !change.proof?.trim())throw new AppError("PORTAL_PROOF","Bestätige die tatsächlich von dir eingereichte Portalbewerbung mit einer kurzen Notiz.",409);
      const data={stage:change.stage,...(change.stage==="submitted"?{submissionProof:`owner-reported:${change.proof}`,submittedAt:change.submittedAt?new Date(change.submittedAt):new Date()}:{} )};
      const result=await client.opportunity.update({where:{id:p.id},data});await audit(client,"stage.changed",owner,p.id,{from:source.stage,to:change.stage,proof:change.proof||null});return result;
    }
    case "project.add":return createProject(client,payload,owner);
    case "project.accept":{const p=z.object({id:z.string(),note:z.string().min(10).max(4000),reviewed:z.literal(true)}).parse(payload);const project=await client.project.update({where:{id:p.id},data:{stage:"completed",acceptedAt:new Date()}});await addEvidence(client,{projectId:project.id,title:"Bestätigte Abnahme",content:p.note,repository:project.repository,commitSha:null,checkedScope:project.acceptance,origin:"acceptance",confirmed:true},owner);return project;}
    case "task.add":{const p=z.object({title:z.string().min(1).max(500),kind:z.enum(["project","acquisition","learning"]),projectId:z.string().nullable(),dueAt:z.string().datetime().nullable(),notes:z.string().max(2000).nullable()}).parse(payload);if(p.projectId)await client.project.findUniqueOrThrow({where:{id:p.projectId}});return client.task.create({data:{...p,dueAt:p.dueAt?new Date(p.dueAt):null}});}
    case "task.complete":{const result=await client.task.update({where:{id:identifier.parse(payload).id},data:{status:"done"}});await audit(client,"task.completed",owner,result.id,{});return result;}
    case "evidence.add":return addEvidence(client,payload,owner);
    case "evidence.confirm":{const p=z.object({id:z.string(),reviewed:z.literal(true)}).strict().parse(payload);const result=await client.evidence.update({where:{id:p.id},data:{confirmed:true}});await audit(client,'evidence.confirmed',owner,result.id,{checkedScope:result.checkedScope});return result;}
    case "learning.generate":{const evidence=await client.evidence.findUniqueOrThrow({where:{id:identifier.parse(payload).id}});if(!evidence.confirmed)throw new AppError("EVIDENCE_REQUIRED","Bestätige zuerst den geprüften Arbeitsbeleg.",409);return enqueue(client,"learn",{evidence},owner);}
    case "learning.add":{const p=z.object({evidenceId:z.string(),title:z.string().min(1).max(500),concept:z.string().min(1).max(4000),exercise:z.string().min(1).max(3000),transferQuestion:z.string().min(1).max(1500)}).parse(payload);await client.evidence.findUniqueOrThrow({where:{id:p.evidenceId}});return client.learning.create({data:p});}
    case "learning.confirm":{const learning=await client.learning.findUniqueOrThrow({where:{id:identifier.parse(payload).id}});const evidence=await client.evidence.findUniqueOrThrow({where:{id:learning.evidenceId}});if(!evidence.confirmed)throw new AppError("EVIDENCE_REQUIRED","Der Arbeitsbeleg ist noch nicht bestätigt.",409);const result=await client.learning.update({where:{id:learning.id},data:{confirmed:true}});await audit(client,"learning.confirmed",owner,result.id,{});return result;}
    case "learning.close":return closeSession(client,payload,owner);
    case "day.prepare":return prepareDay(client,owner);
    case "document.save":{const p=z.object({id:z.string().optional(),document:z.unknown()}).parse(payload);return saveDocument(client,p.document,owner,p.id);}
    case "knowledge.search":{const p=z.object({query:z.string().min(1).max(1000),projectId:z.string().optional()}).parse(payload);return searchDocuments(client,p.query,p.projectId);}
    case "technical.analyze":{const p=z.object({query:z.string().min(1).max(4000),mode:z.enum(["retrieval","full"]),projectId:z.string().optional()}).parse(payload);return enqueue(client,"technical",await technicalContext(client,p.query,p.mode,p.projectId),owner);}
    case "content.generate":return queueContent(client,identifier.parse(payload).id,owner);
    case "content.save":{const p=z.object({id:z.string(),result:z.unknown()}).parse(payload);const {contentSchema}=await import("./contracts");const checked=contentSchema.parse(p.result);const old=await client.contentPackage.findUniqueOrThrow({where:{id:p.id}});const allowed=object<string[]>(old.evidenceIds);if(checked.evidenceIds.some(id=>!allowed.includes(id)))throw new AppError("CONTENT_EVIDENCE","Neue Belege müssen über ein neues geprüftes Content-Paket eingebracht werden.");return client.contentPackage.create({data:{projectId:old.projectId,evidenceIds:json(checked.evidenceIds),result:json(checked),version:old.version+1}});}
    case "portfolio.publish":return publish(client,payload,owner);
    case "portfolio.withdraw":{const result=await client.publication.update({where:{id:identifier.parse(payload).id},data:{active:false}});await audit(client,"portfolio.withdrawn",owner,result.id,{});return result;}
    case "content.link":{const p=z.object({id:z.string(),url:z.string().url().max(2000)}).parse(payload);return client.contentPackage.update({where:{id:p.id},data:{publishedUrl:canonicalUrl(p.url)}});}
    case "time.add":return recordTime(client,payload);
    case "payment.add":return recordPayment(client,payload);
    case "eval.start":{const p=z.object({title:z.string().min(1).max(300),mode:z.enum(["reference","provider"]),split:z.enum(["development","holdout"]),model:z.enum(["gpt-6.1-sol","gpt-6-luna","gpt-6-astra"]).optional()}).parse(payload);return startEval(client,p.title,p.mode,p.split,owner,p.model);}
    case "job.retry":{const old=await client.job.findUniqueOrThrow({where:{id:identifier.parse(payload).id}});if(object<any>(old.input).validationOnly)throw new AppError('VALIDATION_PROOF','Importierte Ausführungsnachweise sind schreibgeschützte Prüfbelege.',409);if(!["failed","paused","stale","interrupted"].includes(old.status))throw new AppError("JOB_STATE","Dieser Auftrag ist bereits aktiv oder abgeschlossen.",409);return enqueue(client,old.kind as any,old.input,owner,{dedupe:`retry:${old.id}:${crypto.randomUUID()}`,model:old.model,reasoning:old.reasoning,profileId:old.profileId||undefined});}
    case "queue.resume":{await serial(client,async tx=>{await tx.runtimeState.update({where:{id:"singleton"},data:{pausedReason:null}});await tx.job.updateMany({where:{status:"paused"},data:{status:"queued",completedAt:null,errorCode:null}});});await audit(client,"queue.resumed",owner,null,{});return {resumed:true};}
    case "worker.once":{
      void workOnce(client).catch(()=>console.error("Worker tick failed"));return {started:config().aiEnabled};
    }
    case "gmail.sync":return syncGmail(client,owner);
    case "calendar.read":return calendarEvents(client);
    case "schedule.tick":return schedulerTick(client,owner);
    default:throw new AppError("UNKNOWN_ACTION","Diese Aktion ist nicht verfügbar.",404);
  }
}
