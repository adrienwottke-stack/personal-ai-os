import type { PrismaClient } from '@/generated/prisma/client';
import { learningLabels } from './config';
export async function exportNotes(client:PrismaClient){
  const projects=await client.project.findMany({orderBy:{createdAt:'asc'}});const notes:{id:string;title:string;content:string}[]=[];
  for(const p of projects){const evidence=await client.evidence.findMany({where:{projectId:p.id,confirmed:true}});const learnings=await client.learning.findMany({where:{evidenceId:{in:evidence.map(e=>e.id)},confirmed:true}});
    notes.push({id:`project-${p.id}`,title:p.title,content:`# ${p.title}\n\n## Problem\n\n${p.problem}\n\n## Ergebnis\n\n${p.outcome}\n\n## Abnahmekriterien\n\n${p.acceptance}\n\n## Bestätigte Arbeitsbelege\n\n${evidence.map(e=>`### ${e.title}\n\n${e.content}\n\nGeprüfter Umfang: ${e.checkedScope}\n\nHerkunft: ${e.origin}${e.commitSha?` · Commit ${e.commitSha}`:''}`).join('\n\n')}\n\n## Bestätigte Lernstände\n\n${learnings.map(l=>`### ${l.title}\n\n${learningLabels[l.level]}\n\n${l.concept}\n\nÜbung: ${l.exercise}\n\nTransfer: ${l.transferQuestion}`).join('\n\n')}\n`});
  }return notes;
}
