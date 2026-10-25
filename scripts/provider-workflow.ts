import 'dotenv/config';import {mkdir,writeFile} from 'node:fs/promises';
import {db} from '../lib/db';import {seedDemo} from '../lib/demo';import {queueAnalysis,queueDraft,workOnce,enqueue} from '../lib/jobs';import {queueContent,prepareDay} from '../lib/business';import {technicalContext} from '../lib/knowledge';
if(!process.argv.includes('--confirmed-subscription-check'))throw new Error('Explicit validation flag required.');
process.env.APP_MODE='demo';process.env.DATA_DIR='.data/provider-validation';process.env.AI_ENABLED='true';
const client=await db();await seedDemo(client);
const opportunities=await client.opportunity.findMany({where:{stage:'prepared'},take:3,orderBy:{createdAt:'asc'}});
const execute=async()=>{const result=await workOnce(client);console.log(JSON.stringify(result));if(result.status!=='completed')throw new Error(`Bounded validation stopped: ${result.status}`);};
async function ensure(job:any){if(job.status==='completed')return;if(job.status==='failed')await enqueue(client,job.kind,job.input,'synthetic-validation',{dedupe:`validation-retry:${job.id}:${crypto.randomUUID()}`,model:job.model,reasoning:job.reasoning,profileId:job.profileId||undefined});await execute();}
try{
for(const opportunity of opportunities){await ensure(await queueAnalysis(client,opportunity.id,'synthetic-validation'));await ensure(await queueDraft(client,opportunity.id,'synthetic-validation'));}
const evidence=await client.evidence.findFirstOrThrow({where:{confirmed:true}});await enqueue(client,'learn',{evidence},'synthetic-validation');await execute();await prepareDay(client,'synthetic-validation','validation:daily-exercise');await execute();await queueContent(client,evidence.projectId,'synthetic-validation');await execute();
const query='Welche Regeln gelten für die Anforderungsanalyse und die Vergütung?';for(const mode of ['full','retrieval'] as const){await enqueue(client,'technical',await technicalContext(client,query,mode,evidence.projectId),'synthetic-validation');await execute();}
}catch(error){console.log(error instanceof Error?error.message:'Validation interrupted');}
const jobs=await client.job.findMany({where:{model:{not:'example-fixture'}},select:{id:true,kind:true,status:true,errorCode:true,durationMs:true,model:true,usage:true,promptVersion:true}});const generatedDrafts=await client.draft.count({where:{revision:{gt:1}}});const runtime=await client.runtimeState.findUniqueOrThrow({where:{id:'singleton'}});
const report={at:new Date().toISOString(),mode:'actual-codex-subscription-synthetic-workflow',realMailSent:false,publications:0,generatedDrafts,callsToday:runtime.quotaCount,limit:25,jobs};await mkdir('docs/proof',{recursive:true});await writeFile('docs/proof/provider-workflow.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));await client.$disconnect();process.exit(0);
