import type { PrismaClient } from '@/generated/prisma/client';
import { type GmailMessage, type GmailPart, header, plainBody } from './mail';
import { ingestSource } from './acquisition';
import { fetchPublicSource } from './sources';
import { queueAnalysis } from './jobs';
import { personalSettings } from './personal';
import { AppError, canonicalUrl, hash } from './util';

export function projectUrl(value:string):string|null {
  try {
    const url=new URL(value.replace(/&amp;/g,'&').replace(/[.,;)]+$/,''));
    if(url.protocol!=='https:'||url.username||url.password||url.port)return null;
    if(!['freelancermap.de','www.freelancermap.de','freelancermap.com','www.freelancermap.com'].includes(url.hostname.toLowerCase()))return null;
    if(!/^\/(?:(?:projekt|project)\/[a-z0-9][a-z0-9-]*(?:\.html)?\/?|nproj\/[1-9][0-9]{0,11}\.html)$/i.test(url.pathname))return null;
    url.search='';url.hash='';url.hostname=url.hostname.toLowerCase().replace(/^www\./,'');return canonicalUrl(url.href);
  }catch{return null;}
}
const parts=(p:GmailPart):GmailPart[]=>[p,...(p.parts||[]).flatMap(parts)];
const decode=(s:string)=>s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&nbsp;/g,' ');
export function parseProjectAlarm(message:GmailMessage) {
  const links=new Map<string,{url:string;title:string}>();
  const add=(url:string,title='')=>{const clean=projectUrl(decode(url));if(clean&&!links.has(clean))links.set(clean,{url:clean,title:decode(title.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim().slice(0,500)});};
  for(const part of parts(message.payload)) {
    if(!part.body?.data)continue;
    const body=Buffer.from(part.body.data,'base64url').toString('utf8');
    if(part.mimeType==='text/html')for(const match of body.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi))add(match[1],match[2]);
    for(const match of body.matchAll(/https:\/\/[^\s<>"']+/gi))add(match[0]);
  }
  for(const match of plainBody(message).matchAll(/https:\/\/[^\s<>"']+/gi))add(match[0]);
  return [...links.values()].slice(0,50);
}
const alarmContentHash=(subject:string)=>hash({parserVersion:2,subject:subject.slice(0,500)});
export function needsAlarmReplay(event:{kind:string;contentHash:string;content:string}) {
  return event.kind==='gmail_ignored'&&event.contentHash!==alarmContentHash(event.content);
}
export function originalProject(fresh:{url:string;title:string;content:string},url:string) {
  const expected=projectUrl(url),actual=projectUrl(fresh.url);
  if(!expected||!actual||fresh.content.length<200||/^(?:Login|Anmeldung|Access denied|IT-Projekte f[üu]r)/i.test(fresh.title))return false;
  if(actual===expected)return true;
  const before=new URL(expected),after=new URL(actual);
  return /^\/nproj\/[1-9][0-9]{0,11}\.html$/.test(before.pathname)&&before.hostname===after.hostname&&/^\/(?:projekt|project)\//.test(after.pathname);
}
export async function retryProjectOriginals(client:PrismaClient,owner:string,budget:{remaining:number}) {
  const tasks=await client.task.findMany({where:{status:'open',dedupeKey:{startsWith:'source-text:'},OR:[{dueAt:null},{dueAt:{lte:new Date()}}]},orderBy:{createdAt:'asc'},take:2});
  const settings=await personalSettings(client),profile=await client.profile.findFirst({where:{confirmed:true},orderBy:{version:'desc'}});
  let recovered=0,queued=0;
  for(const task of tasks) {
    if(budget.remaining<=0)break;
    const old=task.opportunityId?await client.opportunity.findUnique({where:{id:task.opportunityId}}):null,url=old?.url&&projectUrl(old.url);if(!old||!url)continue;
    budget.remaining--;
    try {
      const fresh=await fetchPublicSource(url);if(!originalProject(fresh,url))continue;
      await ingestSource(client,{externalId:`public:${hash({url,content:fresh.content})}`,kind:'public',url,title:fresh.title,company:old.company,content:fresh.content},owner);
      await client.task.update({where:{id:task.id},data:{status:'done'}});recovered++;
      if(profile&&settings.autoAnalyze){const job=await queueAnalysis(client,old.id,owner,{automaticPreparation:true});if(!('skipped' in job))queued++;}
    }catch{/* Keep the task visible; retry only within the next bounded sync. */}
    finally{await client.task.update({where:{id:task.id},data:{dueAt:new Date(Date.now()+3600_000)}});}
  }
  return {recovered,queued};
}
export async function importProjectAlarm(client:PrismaClient,message:GmailMessage,owner:string,budget={remaining:5},mailbox='gmail') {
  const externalId=`${mailbox}:${message.id}`;
  const previous=await client.sourceEvent.findUnique({where:{externalId}});
  if(previous&&!needsAlarmReplay(previous))return {imported:0,duplicate:true,pending:0,queued:0,ignored:false};
  if(!/@(?:[a-z0-9-]+\.)*freelancermap\.(?:de|com)(?:>|\s|$)/i.test(header(message,'from')))throw new AppError('ALARM_SENDER','Die Nachricht ist kein freelancermap-Eingang.',422);
  const links=parseProjectAlarm(message),settings=await personalSettings(client);
  const profile=await client.profile.findFirst({where:{confirmed:true},orderBy:{version:'desc'}});
  let imported=0,pending=0,queued=0;
  for(const link of links) {
    const old=await client.opportunity.findUnique({where:{fingerprint:hash(canonicalUrl(link.url))}});
    let fresh:{url:string;title:string;content:string}|null=null;
    if(budget.remaining>0){budget.remaining--;try {fresh=await fetchPublicSource(link.url);if(!originalProject(fresh,link.url))fresh=null;}catch{}}
    if(!fresh&&old&&!old.content.includes('Originalausschreibung noch nicht übernommen'))continue;
    const content=fresh?.content||`Projektlink: ${link.url}\nOriginalausschreibung noch nicht übernommen. Öffne die Originalquelle und ergänze den einzelnen Ausschreibungstext.`;
    const result=await ingestSource(client,{externalId:`${externalId}:${hash(link.url).slice(0,20)}`,kind:'gmail',url:link.url,title:fresh?.title||link.title||header(message,'subject').slice(0,500)||'freelancermap-Projekt',company:null,content},owner);
    imported+=result.duplicate?0:1;
    if(result.opportunity&&fresh&&profile&&settings.autoAnalyze) {const job=await queueAnalysis(client,result.opportunity.id,owner,{automaticPreparation:true});if(!('skipped' in job))queued++;}
    else if(result.opportunity&&!fresh) {pending++;await client.task.upsert({where:{dedupeKey:`source-text:${result.opportunity.id}`},create:{dedupeKey:`source-text:${result.opportunity.id}`,title:'Originalausschreibung ergänzen',kind:'acquisition',opportunityId:result.opportunity.id,notes:link.url},update:{}});}
  }
  const event={kind:links.length?'gmail_digest':'gmail_ignored',contentHash:alarmContentHash(header(message,'subject')),content:header(message,'subject').slice(0,500)};
  await client.sourceEvent.upsert({where:{externalId},create:{externalId,...event},update:event});
  return {imported,pending,queued,ignored:links.length===0,duplicate:false};
}
