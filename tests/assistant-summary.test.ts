import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../lib/db';
import {saveProfile,ingestSource} from '../lib/acquisition';
import {assistantCall} from '../lib/assistant';

test('assistant project counts cover the whole list while cards omit large sources and old profile analyses',async()=>{
  const local=await createTestDb(),client=local.client,owner='synthetic@example.org';
  try{
    const profile=await saveProfile(client,{name:'Synthetic',skills:[],claims:[],availability:null,minimumRate:null,confirmed:true},owner);
    for(let i=0;i<14;i++){
      const r=await ingestSource(client,{externalId:`compact-${i}`,kind:'manual',title:'Synthetic '.repeat(40),company:null,url:`https://freelancermap.de/nproj/${i+100}.html`,content:i===0?'Originalausschreibung noch nicht übernommen':'PRIVATE-SOURCE-MARKER '.repeat(1000)},owner),o=r.opportunity!;
      if(i>0&&i<12){const a=await client.analysis.create({data:{opportunityId:o.id,profileId:profile.id,contentHash:o.contentHash,result:{verdict:'unpassend',reason:'Synthetic '.repeat(150)}}});await client.opportunity.update({where:{id:o.id},data:{analysisId:a.id,stage:'reviewed'}});}
    }
    const result=await assistantCall(client,'list_project_chances',{}) as any;
    assert.equal(result.counts.total,14);assert.equal(result.counts.freelancermap,14);
    assert.equal(result.counts.reviewed,11);assert.equal(result.counts.notReviewed,3);
    assert.equal(result.counts.missingOriginal,1);assert.equal(result.counts.unpassend,11);
    assert.equal(result.counts.submittedWithProof,0);assert.equal(result.opportunities.length,8);assert.equal(result.more,true);
    assert.ok(JSON.stringify(result).length<12_000);assert.ok(!JSON.stringify(result).includes('PRIVATE-SOURCE-MARKER'));
    await saveProfile(client,{name:'Updated synthetic',skills:[],claims:[],availability:null,minimumRate:null,confirmed:true},owner);
    const stale=await assistantCall(client,'list_project_chances',{}) as any;
    assert.equal(stale.counts.reviewed,0);assert.equal(stale.counts.unpassend,0);
    assert.ok(stale.opportunities.every((o:any)=>o.verdict===null));
  }finally{await local.close();}
});
