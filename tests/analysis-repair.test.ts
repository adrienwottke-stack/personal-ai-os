import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../lib/db';
import {saveProfile,ingestSource} from '../lib/acquisition';
import {enqueue,workOnce,queueAnalysisRepair} from '../lib/jobs';
import {dayKey} from '../lib/util';
import type {AnalysisResult} from '../lib/contracts';

test('invalid analysis gets one quota-counted correction, retains failure and never accepts missing evidence',async()=>{
  const local=await createTestDb(),client=local.client,owner='owner@example.org';
  const before={mode:process.env.APP_MODE,ai:process.env.AI_ENABLED,limit:process.env.AI_DAILY_LIMIT};
  process.env.APP_MODE='demo';process.env.AI_ENABLED='true';process.env.AI_DAILY_LIMIT='2';
  try{
    const profile=await saveProfile(client,{name:'Synthetic',skills:['n8n'],claims:[{id:'n8n',text:'Ich arbeite mit n8n und API-Integrationen.',evidenceIds:[]}],availability:null,minimumRate:null,confirmed:true},owner);
    const source=await ingestSource(client,{externalId:'repair-fixture',kind:'manual',title:'Synthetic n8n project',company:null,url:null,content:'Wir suchen Hilfe mit n8n. Remote.'},owner),o=source.opportunity!;
    const input={profile:{id:profile.id,claims:profile.claims},opportunity:{id:o.id,title:o.title,content:o.content,contentHash:o.contentHash}};
    const invalid:AnalysisResult={summary:'Synthetic',verdict:'prüfen',reason:'Verfügbarkeit offen.',extracted:{projectType:null,presence:null,timeCommitment:null,deadline:null,pay:null,applicationChannel:null,contactEmail:null},fieldEvidence:[],requirements:[{name:'n8n',quote:'n8n',assessment:'teilweise',evidenceIds:[],question:null}],questions:[]};
    const first=await enqueue(client,'analyze',input,owner,{profileId:profile.id});
    await client.runtimeState.update({where:{id:'singleton'},data:{quotaDay:dayKey(),quotaCount:0,pausedReason:null}});
    await workOnce(client,async()=>({value:invalid,usage:{}}));
    assert.equal((await client.job.findUniqueOrThrow({where:{id:first.id}})).errorCode,'MISSING_EVIDENCE');
    assert.equal(await client.analysis.count(),0);
    const repair=await client.job.findFirstOrThrow({where:{status:'queued'}});
    assert.equal((repair.input as any).analysisRepair.previousJobId,first.id);
    assert.equal((await queueAnalysisRepair(client,first,'MISSING_EVIDENCE',invalid))?.id,repair.id);
    assert.equal(await client.job.count(),2);
    const valid=structuredClone(invalid);valid.requirements[0].evidenceIds=['n8n'];
    await workOnce(client,async()=>({value:valid,usage:{}}));
    assert.equal((await client.job.findUniqueOrThrow({where:{id:repair.id}})).status,'completed');
    assert.equal(await client.analysis.count(),1);
    assert.equal((await client.runtimeState.findUniqueOrThrow({where:{id:'singleton'}})).quotaCount,2);
    assert.equal(await queueAnalysisRepair(client,repair,'QUOTE_NOT_FOUND',invalid),null);
    assert.equal(await queueAnalysisRepair(client,first,'AUTH_REQUIRED',invalid),null);
    assert.equal(await queueAnalysisRepair(client,first,'SOURCE_CHANGED',invalid),null);
  }finally{
    for(const [key,value] of Object.entries({APP_MODE:before.mode,AI_ENABLED:before.ai,AI_DAILY_LIMIT:before.limit}))if(value===undefined)delete process.env[key];else process.env[key]=value;
    await local.close();
  }
});

test('a failed correction stops after the second attempt without producing a loop',async()=>{
  const local=await createTestDb(),client=local.client;
  const oldAi=process.env.AI_ENABLED;process.env.AI_ENABLED='true';
  try{
    const profile=await saveProfile(client,{name:'Synthetic',skills:[],claims:[],availability:null,minimumRate:null,confirmed:true},'owner@example.org');
    const source=await ingestSource(client,{externalId:'stop-fixture',kind:'manual',title:'Synthetic',company:null,url:null,content:'Original.'},'owner@example.org'),o=source.opportunity!;
    const input={profile:{id:profile.id,claims:[]},opportunity:{id:o.id,content:o.content,contentHash:o.contentHash},analysisRepair:{previousJobId:'old',validationCode:'QUOTE_NOT_FOUND',previousResult:{}}};
    const job=await enqueue(client,'analyze',input,'owner@example.org',{profileId:profile.id});
    await workOnce(client,async()=>({value:{summary:'Synthetic',verdict:'unpassend',reason:'Synthetic',extracted:{projectType:null,presence:null,timeCommitment:null,deadline:null,pay:null,applicationChannel:null,contactEmail:null},fieldEvidence:[],requirements:[{name:'Synthetic',quote:'invented',assessment:'fehlt',evidenceIds:[],question:null}],questions:[]},usage:{}}));
    assert.equal((await client.job.findUniqueOrThrow({where:{id:job.id}})).status,'failed');
    assert.equal(await client.job.count(),1);
    assert.equal(await client.analysis.count(),0);
    assert.equal(await client.task.count({where:{dedupeKey:`analysis-review:${job.id}`,status:'open'}}),1);
  }finally{if(oldAi===undefined)delete process.env.AI_ENABLED;else process.env.AI_ENABLED=oldAi;await local.close();}
});
