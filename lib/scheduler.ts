import type { PrismaClient } from "@/generated/prisma/client";
import { config } from "./config";
import { ensureLive, seal, unseal } from "./auth";
import { googleFetch } from "./google";
import { plainBody, header, refreshThread, type GmailMessage } from "./mail";
import { ingestSource } from "./acquisition";
import { dayKey, AppError, hash } from "./util";
import { enqueue } from "./jobs";
import { prepareDay } from "./business";
import { audit } from "./db";
import { importProjectAlarm, retryProjectOriginals, needsAlarmReplay } from './freelancermap';
import { buildBriefing } from './personal';

export async function syncGmail(client:PrismaClient,owner:string){
  ensureLive();
  const query=process.env.GMAIL_ALARM_QUERY || '(from:freelancermap.de OR from:freelancermap.com) newer_than:14d -in:sent';
  let imported=0,pending=0,queued=0,ignored=0,pageToken:string|undefined;
  const cursor=await client.integration.findUnique({where:{id:'gmail_alarm_cursor'}});
  if(cursor?.sealed){try{const saved=unseal<{queryHash:string;pageToken:string}>(cursor.sealed);if(saved.queryHash===hash(query))pageToken=saved.pageToken;}catch{}}
  const alarmMailbox=await client.integration.findUnique({where:{id:'gmail_alarms'}});
  const mailPurpose: 'gmail'|'gmail_alarms'=process.env.GMAIL_ALARM_OWNER_EMAIL?'gmail_alarms':'gmail';
  if(mailPurpose==='gmail_alarms'&&alarmMailbox?.status!=='connected')throw new AppError('ALARM_MAILBOX','Verbinde zuerst dein Geschäfts-Gmail für die Projektalarme.',409);
  const budget={remaining:5};
  const recovered=await retryProjectOriginals(client,owner,budget);queued+=recovered.queued;
  for(let page=0;page<3;page++) {
    const found=await googleFetch<{messages?:{id:string}[];nextPageToken?:string}>(client,mailPurpose,`messages?${new URLSearchParams({q:query,maxResults:'30',...(pageToken?{pageToken}:{})})}`);
    for(const match of found.messages||[]) {
      const previous=await client.sourceEvent.findUnique({where:{externalId:`${mailPurpose}:${match.id}`}});
      if(previous&&!needsAlarmReplay(previous))continue;
      const message=await googleFetch<GmailMessage>(client,mailPurpose,`messages/${encodeURIComponent(match.id)}?format=full`);
      const result=await importProjectAlarm(client,message,owner,budget,mailPurpose);imported+=result.imported;pending+=result.pending;queued+=result.queued;ignored+=result.ignored?1:0;
    }
    pageToken=found.nextPageToken;if(!pageToken)break;
  }
  pending=await client.task.count({where:{status:'open',dedupeKey:{startsWith:'source-text:'}}});
  const detail=`${imported} neue Projekte · ${recovered.recovered} Originaltexte nachgeholt · ${queued} Analysen vorgemerkt · ${pending} Originaltexte offen · ${ignored} Nachrichten ohne Projektlink${pageToken?' · weitere Nachrichten im nächsten Abgleich':''}`;
  await client.integration.upsert({where:{id:'gmail_alarm_cursor'},create:{id:'gmail_alarm_cursor',status:pageToken?'pending':'complete',scopes:[],sealed:pageToken?seal({queryHash:hash(query),pageToken}):null},update:{status:pageToken?'pending':'complete',sealed:pageToken?seal({queryHash:hash(query),pageToken}):null}});
  await client.integration.upsert({where:{id:'gmail_last_sync'},create:{id:'gmail_last_sync',status:'checked',scopes:[],detail,checkedAt:new Date()},update:{status:'checked',detail,checkedAt:new Date()}});
  return {imported,recovered:recovered.recovered,pending,queued,ignored,more:!!pageToken};
}

export async function syncLinkedThreads(client:PrismaClient,owner:string){
  ensureLive();
  const threads=await client.mailThread.findMany({where:{opportunityId:{not:null}},orderBy:{updatedAt:"asc"},take:30});
  for(const thread of threads)await refreshThread(client,thread.providerId,owner,thread.opportunityId||undefined);
  return {checked:threads.length};
}

export async function schedulerTick(client:PrismaClient,owner:string){
  if(!config().scheduler)throw new AppError("SCHEDULER_DISABLED","Zeitgesteuerte Abläufe sind noch nicht aktiviert.",409);
  const now=new Date();const day=dayKey(now);
  const berlinHour=Number(new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/Berlin",hour:"2-digit",hourCycle:"h23"}).format(now));
  if(berlinHour>=8){
    if(!await client.dailyBriefing.findUnique({where:{day}}))await buildBriefing(client,owner,now);
    await prepareDay(client,owner,`daily:exercise:${day}`);
    const profile=await client.profile.findFirst({where:{confirmed:true},orderBy:{version:"desc"}});
    if(profile)await enqueue(client,"research",{profile:{skills:profile.skills,claims:profile.claims},focus:"Öffentlich ausgeschriebene kleine, klar begrenzte Projekte. Branchenübergreifend. Deutschland/remote.",maxResults:10,date:day},owner,{dedupe:`daily:research:${day}`});
  }
  const weekday=new Intl.DateTimeFormat("en-US",{timeZone:"Europe/Berlin",weekday:"long"}).format(now);
  if(weekday==="Friday"&&berlinHour>=8)await client.task.upsert({where:{dedupeKey:`weekly-review:${day}`},create:{dedupeKey:`weekly-review:${day}`,title:"Wochenreview: Aufträge, Belege und Transfer prüfen",kind:"review",dueAt:now},update:{}});
  await client.integration.upsert({where:{id:"scheduler_last_tick"},create:{id:"scheduler_last_tick",status:"checked",scopes:[],detail:"Tagesvorbereitung geprüft",checkedAt:now},update:{status:"checked",checkedAt:now}});
  return {day,checked:true};
}
