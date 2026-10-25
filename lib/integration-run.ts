import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { audit } from './db';
const runInput=z.object({executionId:z.string().max(100).optional(),trigger:z.enum(['automatic','manual','unknown']).default('unknown')}).strict();
export async function integrationRun<T>(client:PrismaClient,name:string,payload:unknown,run:()=>Promise<T>){
  const input=runInput.parse(payload),started=new Date();
  try{
    const result=await run();
    const detail=JSON.stringify({startedAt:started.toISOString(),completedAt:new Date().toISOString(),executionId:input.executionId||null,trigger:input.trigger,result});
    await client.integration.upsert({where:{id:'n8n_'+name},create:{id:'n8n_'+name,status:'checked',scopes:[],detail,checkedAt:new Date()},update:{status:'checked',detail,checkedAt:new Date()}});
    await audit(client,'integration.run_completed','n8n',name,{...input,startedAt:started.toISOString()});return result;
  }catch(error){const code=(error as any)?.code||'REQUEST_FAILED';const detail=JSON.stringify({startedAt:started.toISOString(),completedAt:new Date().toISOString(),executionId:input.executionId||null,trigger:input.trigger,failed:true,code});await client.integration.upsert({where:{id:'n8n_'+name},create:{id:'n8n_'+name,status:'error',scopes:[],detail,checkedAt:new Date()},update:{status:'error',detail,checkedAt:new Date()}});await audit(client,'integration.run_failed','n8n',name,{...input,code});throw error;}
}
