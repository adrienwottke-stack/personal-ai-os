import type { PrismaClient } from "@/generated/prisma/client";
import { technicalSchema } from "./contracts";
import { AppError, hash } from "./util";

export async function searchDocuments(client: PrismaClient, query: string, projectId?: string) {
  if (!query.trim()) return [];
  const stop=new Set(['welche','welcher','welches','was','wie','die','der','das','für','und','oder','ist','sind','gelten','einer','einem','eine','einen','mit','von','aus','bei','den','des']);
  const words=query.toLowerCase().match(/[\p{L}\p{N}_-]+/gu)?.filter(word=>word.length>2&&!stop.has(word)).slice(0,20)||[];
  if(!words.length)return [];
  const search=words.map(word=>`"${word}"`).join(' OR ');
  const rows = await client.$queryRaw<{id:string;title:string;content:string;source:string;hash:string;updatedAt:Date;projectId:string|null}[]>`
    SELECT "id", "title", "content", "source", "hash", "updatedAt", "projectId" FROM "Document"
    WHERE "approved" = true AND "state" = 'current'
    AND (${projectId || null}::text IS NULL OR "projectId" = ${projectId || null})
    AND to_tsvector('simple', "title" || ' ' || "content") @@ websearch_to_tsquery('simple', ${search})
    ORDER BY ts_rank(to_tsvector('simple', "title" || ' ' || "content"), websearch_to_tsquery('simple', ${search})) DESC
    LIMIT 6`;
  return rows.map(row => {
    const lines = row.content.split(/\r?\n/);
    const first=Math.max(0,lines.findIndex(line=>words.some(w=>line.toLowerCase().includes(w))));
    const start=Math.max(0,first-2); const snippet=lines.slice(start,start+18).map((line,index)=>`${start+index+1}: ${line}`).join("\n").slice(0,6000);
    return {...row,content:snippet,originalContent:row.content,lineStart:start+1};
  });
}

export async function technicalContext(client: PrismaClient, query: string, mode: "retrieval" | "full", projectId?: string) {
  const found=mode === "retrieval" ? await searchDocuments(client,query,projectId) : (await client.document.findMany({where:{approved:true,state:"current",...(projectId?{projectId}:{})},orderBy:{updatedAt:"desc"},take:6})).map(doc=>({...doc,originalContent:doc.content,lineStart:1,content:doc.content.split(/\r?\n/).map((line,i)=>`${i+1}: ${line}`).join("\n").slice(0,6000)}));
  const unavailable=await client.document.findMany({where:{approved:true,state:{not:"current"},...(projectId?{projectId}:{})},select:{id:true,title:true,state:true},take:20});
  return { query, mode, documents:found.map(d=>({id:d.id,title:d.title,source:d.source,hash:d.hash,content:d.content,lineStart:d.lineStart,updatedAt:d.updatedAt.toISOString()})), unavailable, contextHash:hash(found.map(d=>[d.id,d.hash,d.content])) };
}

export async function validateTechnical(client: PrismaClient, input: {documents:{id:string;hash:string;content:string}[]}, output: unknown) {
  const result=technicalSchema.parse(output);
  for(const citation of result.citations){
    const doc=input.documents.find(d=>d.id===citation.documentId);
    if(!doc) throw new AppError("UNKNOWN_CITATION","Die Antwort nennt ein nicht bereitgestelltes Dokument.",422);
    const actual=await client.document.findUnique({where:{id:doc.id}});
    if(!actual || !actual.approved || actual.state!=="current" || actual.hash!==doc.hash) throw new AppError("STALE_DOCUMENT","Eine Quelle wurde geändert oder ist nicht mehr freigegeben.",409);
    if(!doc.content.split('\n').some(line=>line.startsWith(`${citation.line}: `)))throw new AppError("CITATION_CONTEXT","Die Fundstelle war nicht im bereitgestellten Kontext.",422);
    const fromLine=actual.content.split(/\r?\n/).slice(citation.line-1).join("\n");
    if(!fromLine.startsWith(citation.quote)) throw new AppError("CITATION_LOCATION","Zitat und Fundstelle passen nicht zur Quelle.",422);
  }
  if(!input.documents.length && !result.gaps.length) throw new AppError("MISSING_SOURCE_GAP","Die Antwort muss fehlende Quellen sichtbar machen.",422);
  return result;
}
