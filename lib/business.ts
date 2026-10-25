import type { PrismaClient } from "@/generated/prisma/client";
import { z } from "zod";
import { documentInput, evidenceInput, projectInput, sessionInput, publicationInput, contentSchema } from "./contracts";
import { audit } from "./db";
import { AppError, hash, json, object } from "./util";
import { ensureLive } from "./auth";
import { serial } from "./acquisition";
import { enqueue } from "./jobs";

export async function createProject(client:PrismaClient,input:unknown,owner:string){
  const parsed=projectInput.parse(input);
  if(parsed.opportunityId && !await client.opportunity.findUnique({where:{id:parsed.opportunityId}}))throw new AppError("OPPORTUNITY_MISSING","Die zugehörige Chance fehlt.");
  const project=await client.project.create({data:parsed});
  await audit(client,"project.created",owner,project.id,{});return project;
}

export async function addEvidence(client:PrismaClient,input:unknown,owner:string){
  const parsed=evidenceInput.parse(input);await client.project.findUniqueOrThrow({where:{id:parsed.projectId}});
  if(parsed.origin==="repository" && (!parsed.repository || !parsed.commitSha))throw new AppError("REPOSITORY_PROOF","Ein Repository-Beleg braucht den Repository-Link und einen konkreten Commit.");
  const evidence=await client.evidence.create({data:parsed});
  await audit(client,"evidence.recorded",owner,evidence.id,{confirmed:evidence.confirmed,origin:evidence.origin});return evidence;
}

export async function closeSession(client:PrismaClient,input:unknown,owner:string){
  const parsed=sessionInput.parse(input);
  const result=await serial(client,async tx=>{
    const learning=await tx.learning.findUniqueOrThrow({where:{id:parsed.learningId}});
    if(!learning.confirmed)throw new AppError("LEARNING_CANDIDATE","Bestätige zuerst den Lernkandidaten.",409);
    if(["independent","transfer"].includes(parsed.result) && (parsed.help.trim()||parsed.hintsUsed.length))throw new AppError("HELP_USED","Mit verwendeten Hilfen wird die Lösung als unterstützt dokumentiert.",409);
    if(parsed.result==="transfer" && (!parsed.transfer || !["independent","transfer"].includes(learning.level)))throw new AppError("TRANSFER_PREREQUISITE","Transfer braucht eine neue Aufgabe und einen zuvor selbstständig gelösten Lernstand.",409);
    const session=await tx.learningSession.create({data:{...parsed,hintsUsed:json(parsed.hintsUsed)}});
    if(parsed.reviewed && parsed.result!=="retry"){
      const ranks=["seen","assisted","independent","transfer"];
      if(ranks.indexOf(parsed.result)>ranks.indexOf(learning.level))await tx.learning.update({where:{id:learning.id},data:{level:parsed.result}});
    }
    await tx.task.updateMany({where:{learningId:learning.id,status:'open',dedupeKey:{startsWith:'repeat:'}},data:{status:'done'}});
    const previous=await tx.learningSession.count({where:{learningId:learning.id,reviewed:true,result:{in:['independent','transfer']}}});
    const days=parsed.reviewed&&['independent','transfer'].includes(parsed.result)&&previous>1?7:2;
    await tx.task.upsert({where:{dedupeKey:`repeat:${learning.id}`},create:{title:`${learning.title} wiederholen`,kind:'learning',learningId:learning.id,dueAt:new Date(Date.now()+days*86400_000),dedupeKey:`repeat:${learning.id}`},update:{status:'open',dueAt:new Date(Date.now()+days*86400_000)}});
    await tx.timeEntry.create({data:{category:"learning",minutes:parsed.minutes,note:learning.title}});
    return session;
  });
  await audit(client,"learning.session_closed",owner,result.id,{reviewed:result.reviewed,transfer:result.transfer});return result;
}

export async function saveDocument(client:PrismaClient,input:unknown,owner:string,documentId?:string){
  const parsed=documentInput.parse(input);const data={...parsed,hash:hash(parsed.content)};
  if(parsed.projectId)await client.project.findUniqueOrThrow({where:{id:parsed.projectId}});
  const document=documentId?await client.document.update({where:{id:documentId},data}):await client.document.create({data});
  await audit(client,"document.saved",owner,document.id,{approved:document.approved,state:document.state});return document;
}

export async function queueContent(client:PrismaClient,projectId:string,owner:string){
  const project=await client.project.findUniqueOrThrow({where:{id:projectId}});
  const evidence=await client.evidence.findMany({where:{projectId,confirmed:true},orderBy:{createdAt:"desc"},take:15});
  if(!evidence.length)throw new AppError("CONTENT_NEEDS_EVIDENCE","Bestätige zuerst mindestens einen tatsächlichen Arbeitsbeleg.",409);
  const selectedProject={...project,problem:project.problem.slice(0,3000),inputs:project.inputs.slice(0,2000),outcome:project.outcome.slice(0,3000),acceptance:project.acceptance.slice(0,3000)};
  return enqueue(client,"content",{project:selectedProject,evidence:evidence.slice(0,10).map(e=>({...e,content:e.content.slice(0,5000),checkedScope:e.checkedScope.slice(0,2000)}))},owner);
}

export async function publish(client:PrismaClient,input:unknown,owner:string,liveGate=true){
  if(liveGate)ensureLive();
  const parsed=publicationInput.parse(input);
  const content=await client.contentPackage.findUniqueOrThrow({where:{id:parsed.contentPackageId}});
  if(hash(content.result)!==parsed.expectedHash)throw new AppError("CONTENT_CHANGED","Das Content-Paket wurde verändert. Bitte erneut prüfen.",409);
  const result=contentSchema.parse(content.result);
  if(await client.evidence.count({where:{id:{in:result.evidenceIds},confirmed:true}})!==result.evidenceIds.length)throw new AppError("EVIDENCE_REVOKED","Ein Arbeitsbeleg ist nicht mehr bestätigt.",409);
  // Only this whitelist is public; raw reports, prompts, client data and tokens are excluded.
  const publication=await client.publication.create({data:{slug:parsed.slug,contentPackageId:content.id,snapshot:json(parsed.snapshot),hash:hash(parsed.snapshot),approvedBy:owner}});
  await audit(client,"portfolio.published",owner,publication.id,{hash:publication.hash,slug:publication.slug});return publication;
}

export async function recordTime(client:PrismaClient,input:unknown){
  const parsed=z.object({category:z.enum(["acquisition","delivery","correction","learning"]),minutes:z.number().int().min(1).max(1440),note:z.string().min(1).max(1000),projectId:z.string().nullable(),opportunityId:z.string().nullable()}).strict().parse(input);
  if(parsed.projectId)await client.project.findUniqueOrThrow({where:{id:parsed.projectId}});
  if(parsed.opportunityId)await client.opportunity.findUniqueOrThrow({where:{id:parsed.opportunityId}});
  return client.timeEntry.create({data:parsed});
}

export async function recordPayment(client:PrismaClient,input:unknown){
  const parsed=z.object({projectId:z.string().min(1),amountCents:z.number().int().min(1).max(100_000_000),paidAt:z.string().datetime(),note:z.string().max(2000)}).strict().parse(input);
  await client.project.findUniqueOrThrow({where:{id:parsed.projectId}});
  return client.payment.create({data:{...parsed,paidAt:new Date(parsed.paidAt)}});
}

export async function prepareDay(client:PrismaClient,owner:string,dedupeKey?:string){
  const learnings=await client.learning.findMany({where:{confirmed:true},orderBy:{createdAt:"desc"},take:5});
  const evidence=await client.evidence.findMany({where:{confirmed:true},orderBy:{createdAt:"desc"},take:3});
  const sources=[{title:"Structured Outputs",url:"https://developers.openai.com/api/docs/guides/structured-outputs"},{title:"Codex: non-interactive mode",url:"https://learn.chatgpt.com/docs/non-interactive-mode"}];
  return enqueue(client,"exercise",{learnings,evidence,sources,minutes:30},owner,dedupeKey?{dedupe:dedupeKey}:{});
}
