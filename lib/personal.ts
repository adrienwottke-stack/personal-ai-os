import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { audit } from './db';
import { serial } from './acquisition';
import { AppError, dayKey, hash, json, object } from './util';
import { googleFetch } from './google';
import { config } from './config';

export const calendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => {
  const d = new Date(`${v}T12:00:00Z`); return Number.isFinite(d.getTime()) && d.toISOString().startsWith(v);
}, 'Dieses Kalenderdatum existiert nicht.');
const mealFields = z.object({day:calendarDay,description:z.string().trim().min(1).max(1000),calories:z.number().finite().min(0).max(15000),protein:z.number().finite().min(0).max(1000),carbs:z.number().finite().min(0).max(2000).nullable(),fat:z.number().finite().min(0).max(1000).nullable(),estimated:z.boolean(),quantities:z.string().max(2000).nullable()}).strict();
export const mealInput = mealFields.extend({externalId:z.string().min(1).max(120)});
export async function recordMeal(client:PrismaClient,input:unknown,owner:string) {
  const p=mealInput.parse(input);
  return serial(client,async tx=>{
    const old=await tx.mealEntry.findUnique({where:{externalId:p.externalId}});
    if(old) {
      const comparable={day:old.day,description:old.description,calories:old.calories,protein:old.protein,carbs:old.carbs,fat:old.fat,estimated:old.estimated,quantities:old.quantities,externalId:old.externalId};
      if(old.deletedAt || hash(comparable)!==hash(p))throw new AppError('MEAL_CONFLICT','Diese Eingangskennung gehört bereits zu einem anderen oder korrigierten Eintrag.',409);
      return {entry:old,duplicate:true};
    }
    const entry=await tx.mealEntry.create({data:p});await audit(tx as PrismaClient,'meal.recorded',owner,entry.id,{day:p.day,estimated:p.estimated});
    return {entry,duplicate:false};
  });
}
export async function correctMeal(client:PrismaClient,input:unknown,owner:string) {
  const p=z.object({id:z.string(),expectedRevision:z.number().int().positive(),entry:mealFields}).strict().parse(input);
  return serial(client,async tx=>{
    const changed=await tx.mealEntry.updateMany({where:{id:p.id,revision:p.expectedRevision,deletedAt:null},data:{...p.entry,revision:{increment:1}}});
    if(!changed.count)throw new AppError('MEAL_CHANGED','Der Eintrag wurde inzwischen geändert. Lade ihn neu und prüfe deine Korrektur.',409);
    await audit(tx as PrismaClient,'meal.corrected',owner,p.id,{revision:p.expectedRevision+1});
    return tx.mealEntry.findUniqueOrThrow({where:{id:p.id}});
  });
}
export async function removeMeal(client:PrismaClient,input:unknown,owner:string) {
  const p=z.object({id:z.string(),expectedRevision:z.number().int().positive()}).strict().parse(input);
  const changed=await client.mealEntry.updateMany({where:{id:p.id,revision:p.expectedRevision,deletedAt:null},data:{deletedAt:new Date(),revision:{increment:1}}});
  if(!changed.count)throw new AppError('MEAL_CHANGED','Der Eintrag wurde inzwischen geändert.',409);
  await audit(client,'meal.removed',owner,p.id,{});return {removed:true};
}
export async function personalSettings(client:PrismaClient) {
  return client.personalSettings.upsert({where:{id:'singleton'},create:{id:'singleton',calendarIds:['primary']},update:{}});
}
export async function savePersonalSettings(client:PrismaClient,input:unknown,owner:string) {
  const p=z.object({calorieTarget:z.number().int().min(500).max(10000).nullable(),proteinTarget:z.number().finite().min(1).max(1000).nullable(),autoAnalyze:z.boolean(),autoDraft:z.boolean(),calendarIds:z.array(z.string().min(1).max(300)).min(1).max(8)}).strict().parse(input);
  const result=await client.personalSettings.upsert({where:{id:'singleton'},create:{id:'singleton',...p,calendarIds:json(p.calendarIds)},update:{...p,calendarIds:json(p.calendarIds)}});
  await audit(client,'personal.settings',owner,null,{autoAnalyze:p.autoAnalyze,autoDraft:p.autoDraft});return result;
}
export function nutritionDays(entries:{day:string;calories:number;protein:number;estimated:boolean}[],end=dayKey()) {
  return Array.from({length:7},(_,i)=>{
    const d=new Date(`${end}T12:00:00Z`);d.setUTCDate(d.getUTCDate()-6+i);const day=d.toISOString().slice(0,10),rows=entries.filter(e=>e.day===day);
    return {day,entries:rows.length,calories:Math.round(rows.reduce((s,e)=>s+e.calories,0)),protein:Math.round(rows.reduce((s,e)=>s+e.protein,0)*10)/10,estimated:rows.some(e=>e.estimated),recorded:rows.length>0};
  });
}
export type CalendarEvent={id:string;summary?:string;status?:string;start:{dateTime?:string;date?:string};end:{dateTime?:string;date?:string};calendarId?:string};
export function taskPriorities(tasks:{id:string;title:string;kind:string;dueAt:Date|string|null;status:string;notes?:string|null}[],day:string){
  const open=tasks.filter(t=>t.status==='open');
  const due=open.filter(t=>t.dueAt&&dayKey(new Date(t.dueAt))<=day).sort((a,b)=>new Date(a.dueAt!).getTime()-new Date(b.dueAt!).getTime());
  return [...due,...open.filter(t=>!t.dueAt)].slice(0,3).map(t=>({...t,dueAt:t.dueAt?new Date(t.dueAt).toISOString():null,source:`task:${t.id}`}));
}
export function eventOccursOn(event:CalendarEvent,day:string) {
  const start=event.start.date || (event.start.dateTime?dayKey(new Date(event.start.dateTime)):null);
  if(!start||start>day)return false;
  // Google all-day end dates are exclusive. A timed end at midnight
  // also excludes the following day.
  const end=event.end.date || (event.end.dateTime?dayKey(new Date(new Date(event.end.dateTime).getTime()-1)):start);
  return event.end.date ? day<end! : day<=end!;
}
export async function buildBriefing(client:PrismaClient,owner:string,now=new Date()) {
  const day=dayKey(now),settings=await personalSettings(client),alerts:string[]=[];
  const [tasks,opportunities,meals,connection]=await Promise.all([
    client.task.findMany({where:{status:'open'},orderBy:[{dueAt:'asc'},{createdAt:'asc'}],take:200}),
    client.opportunity.findMany({where:{stage:{in:['new','reviewed','prepared','conversation','offer']}},orderBy:{updatedAt:'desc'},take:100}),
    client.mealEntry.findMany({where:{day,deletedAt:null},orderBy:{createdAt:'asc'}}),
    client.integration.findUnique({where:{id:'calendar'}})
  ]);
  let events:CalendarEvent[]=[];
  if(config().demo)alerts.push('Demo: Es wurde kein echter Kalender gelesen.');
  else if(connection?.status!=='connected')alerts.push('Kalender noch nicht verbunden. Feste Termine können fehlen.');
  else {
    // Wide UTC envelope includes all local Berlin days across DST, then filter by local date.
    const min=new Date(now);min.setUTCDate(min.getUTCDate()-1);const max=new Date(now);max.setUTCDate(max.getUTCDate()+8);
    for(const calendarId of object<string[]>(settings.calendarIds)) {
      try {
        let pageToken:string|undefined;
        for(let page=0;page<5;page++) {
          const query=new URLSearchParams({timeMin:min.toISOString(),timeMax:max.toISOString(),singleEvents:'true',orderBy:'startTime',maxResults:'250',...(pageToken?{pageToken}:{})});
          const r=await googleFetch<{items?:CalendarEvent[];nextPageToken?:string}>(client,'calendar',`calendars/${encodeURIComponent(calendarId)}/events?${query}`);
          events.push(...(r.items||[]).filter(e=>e.status!=='cancelled').map(e=>({...e,calendarId})));pageToken=r.nextPageToken;if(!pageToken)break;if(page===4)alerts.push(`Kalender ${calendarId}: Weitere Termine wurden noch nicht gelesen.`);
        }
      }catch{alerts.push(`Kalender ${calendarId} konnte nicht gelesen werden. Die Übersicht ist unvollständig.`);}
    }
  }
  const weekDays=Array.from({length:7},(_,i)=>{const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
  events=events.filter(e=>weekDays.some(d=>eventOccursOn(e,d))).sort((a,b)=>(a.start.dateTime||a.start.date||'').localeCompare(b.start.dateTime||b.start.date||''));
  const due=tasks.filter(t=>t.dueAt&&dayKey(t.dueAt)<=day),undated=tasks.filter(t=>!t.dueAt);
  const snapshot={day,generatedAt:now.toISOString(),alerts,events,todayEvents:events.filter(e=>eventOccursOn(e,day)),priorities:taskPriorities(tasks,day),tasks:tasks.map(t=>({id:t.id,title:t.title,kind:t.kind,dueAt:t.dueAt?.toISOString()||null,status:t.status})),applications:opportunities.filter(o=>['prepared','conversation','offer'].includes(o.stage)).map(o=>({id:o.id,title:o.title,stage:o.stage,url:o.url,source:`opportunity:${o.id}`})),nutrition:nutritionDays(meals,day).at(-1),calendarChecked:connection?.status==='connected'&&!alerts.some(a=>a.includes('Kalender')),method:'deterministic-v1'};
  const value=await client.dailyBriefing.upsert({where:{day},create:{day,snapshot:json(snapshot)},update:{snapshot:json(snapshot)}});
  await audit(client,'briefing.prepared',owner,value.id,{day,calendarChecked:snapshot.calendarChecked});return snapshot;
}
export async function personalOverview(client:PrismaClient) {
  const today=dayKey(),start=new Date(`${today}T12:00:00Z`);start.setUTCDate(start.getUTCDate()-6);const reviewStart=new Date(today+'T12:00:00Z');reviewStart.setUTCDate(reviewStart.getUTCDate()-13);
  const [settings,meals,briefing,hermes,tasks,reviews]=await Promise.all([personalSettings(client),client.mealEntry.findMany({where:{day:{gte:start.toISOString().slice(0,10),lte:today},deletedAt:null},orderBy:{createdAt:'desc'},take:500}),client.dailyBriefing.findFirst({orderBy:{day:'desc'}}),client.integration.findUnique({where:{id:'hermes'}}),client.task.findMany({where:{status:'open'},orderBy:[{dueAt:'asc'},{createdAt:'asc'}],take:200}),client.dayReview.findMany({where:{day:{gte:reviewStart.toISOString().slice(0,10),lte:today}},orderBy:{day:'desc'},take:14})]);
  const chat=await client.assistantTurn.findMany({orderBy:{createdAt:'desc'},take:20});
  const stored=briefing?object<any>(briefing.snapshot):null;
  const current=stored?{...stored,day:today,priorities:taskPriorities(tasks,today),tasks,todayEvents:(stored.events||[]).filter((e:CalendarEvent)=>eventOccursOn(e,today)),calendarStale:stored.day!==today||Date.now()-new Date(stored.generatedAt).getTime()>90*60_000}:null;
  return {today,settings,meals,chat,reviews,priorities:taskPriorities(tasks,today),nutrition:nutritionDays(meals,today),briefing:current,hermes:hermes?{status:hermes.status,detail:hermes.detail,checkedAt:hermes.checkedAt}:null};
}

// A deterministic morning routine can run independently of external web research.
export async function morningBriefingTick(client:PrismaClient,owner:string,now=new Date()) {
  const day=dayKey(now);
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',hourCycle:'h23'}).format(now));
  if(hour<8)return {day,prepared:false,reason:'before_morning'};
  const previous=await client.dailyBriefing.findUnique({where:{day}});
  if(previous&&now.getTime()-new Date(object<any>(previous.snapshot).generatedAt).getTime()<60*60_000)return {day,prepared:false,reason:'fresh'};
  await buildBriefing(client,owner,now);
  return {day,prepared:true,reason:'created'};
}
