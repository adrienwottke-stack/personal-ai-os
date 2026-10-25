import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { db } from '../lib/db';
const p=z.object({written:z.number().int().min(0).max(10000),unchanged:z.number().int().min(0).max(10000),conflicts:z.number().int().min(0).max(10000)}).strict().parse(JSON.parse(readFileSync(0,'utf8')));
const client=await db();
try{
  const now=new Date();
  await client.integration.upsert({where:{id:'obsidian_writeback'},create:{id:'obsidian_writeback',status:p.conflicts?'conflict':'connected',scopes:['conversation-context:write'],checkedAt:now,detail:`Rechner bestätigt: ${p.written} geschrieben, ${p.unchanged} unverändert, ${p.conflicts} Konflikte`},update:{status:p.conflicts?'conflict':'connected',checkedAt:now,detail:`Rechner bestätigt: ${p.written} geschrieben, ${p.unchanged} unverändert, ${p.conflicts} Konflikte`}});
  console.log(JSON.stringify({completed:true,...p,checkedAt:now.toISOString()}));
}finally{await client.$disconnect();}
