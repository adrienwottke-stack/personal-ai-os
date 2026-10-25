import { z } from 'zod';
import type { PrismaClient } from '@/generated/prisma/client';
import { serial } from './acquisition';
import { AppError, hash } from './util';

export const contextRecord=z.object({version:z.literal(1),topic:z.string().regex(/^[a-z][a-z0-9-]{2,59}$/),quote:z.string().trim().min(12).max(600),kind:z.enum(['user_statement','user_preference','proposal']),turnId:z.string().uuid(),capturedAt:z.string().datetime(),replacesId:z.string().nullable()}).strict();
export const captureContextInput=z.discriminatedUnion('action',[
  z.object({action:z.literal('capture'),turnId:z.string().uuid(),topic:contextRecord.shape.topic,quote:contextRecord.shape.quote,kind:contextRecord.shape.kind,replacesId:z.string().regex(/^hermes-context:[a-f0-9]{40}$/).nullable()}).strict(),
  z.object({action:z.literal('pending')}).strict()
]);
// Flat public properties remain legible to provider tool adapters. The strict
// action-specific union above still validates every actual call server-side.
export const captureContextToolInput=z.object({
  action:z.enum(['capture','pending']),
  turnId:z.string().uuid().optional().describe('Für capture erforderlich: aktuelle Nachrichtenkennung.'),
  topic:contextRecord.shape.topic.optional().describe('Für capture erforderlich: enger stabiler Themenbegriff.'),
  quote:contextRecord.shape.quote.optional().describe('Für capture erforderlich: unverändertes Originalzitat aus der aktuellen Nutzernachricht.'),
  kind:contextRecord.shape.kind.optional().describe('Für capture erforderlich: user_statement, user_preference oder proposal.'),
  replacesId:z.string().regex(/^hermes-context:[a-f0-9]{40}$/).nullable().optional().describe('Für capture: frühere passende Erkenntnis oder null. Bei pending alle übrigen Felder weglassen.')
}).strict();
const secret=/-----BEGIN[^\r\n]*PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bGOCSPX-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{24,}|(?:password|passwort|api[_-]?key|client[_-]?secret|access[_-]?token|refresh[_-]?token|authorization)\s*[:=]/i;
const restricted=/\b(?:iban|kreditkarte|diagnose|medikament|depression|suizid|sexleben|sexuell|kontostand|depotwert|steueridentifikationsnummer)\b|sensitivity:\s*(?:privat|private)|\bDE\d{20}\b/i;
const optOut=/\b(?:nicht (?:speichern|merken|übernehmen|festhalten)|vertraulich|unter uns|nur für (?:diesen|diese) (?:chat|unterhaltung))\b/i;

export async function captureContext(client:PrismaClient,input:unknown) {
  const raw=captureContextToolInput.parse(input);
  const p=captureContextInput.parse(raw.action==='capture'?{...raw,replacesId:raw.replacesId??null}:raw);
  if(p.action==='pending') {
    const rows=await client.document.findMany({where:{id:{startsWith:'hermes-context:'},source:{startsWith:'Hermes-Gespräch: '},state:'proposed',approved:false},orderBy:{createdAt:'desc'},take:21,select:{id:true,title:true,content:true,createdAt:true}});
    return {proposals:rows.slice(0,20).map(r=>({id:r.id,topic:r.title,quote:contextRecord.parse(JSON.parse(r.content)).quote,createdAt:r.createdAt})),more:rows.length>20,instruction:'Vorschläge sind kein bestätigter Kontext. Nutzer kann die konkrete Aussage selbst klar formulieren; dann erneut capture mit passendem topic und replacesId.'};
  }
  return serial(client,async tx=>{
    const turn=await tx.assistantTurn.findUnique({where:{id:p.turnId}});
    if(!turn||turn.status!=='running'||Date.now()-turn.createdAt.getTime()>180_000||!turn.message.includes(p.quote))throw new AppError('CONTEXT_SOURCE','Die Erkenntnis braucht ein wörtliches Zitat aus der aktuellen eigenen Nutzernachricht.',422);
    if(optOut.test(turn.message)||secret.test(turn.message)||restricted.test(p.quote))throw new AppError('CONTEXT_PRIVATE','Diese Nachricht wird nicht automatisch in den allgemeinen Kontext übernommen.',422);
    // Store literal user wording, never an inferred summary as a fact. Unclear wording stays proposed.
    const clear=/\bich (?:bin|habe|arbeite|studiere|lerne|nutze|möchte|will|bevorzuge|brauche|mag|plane|wohne|heiße)\b|\bmir ist .{0,100}wichtig\b/i.test(p.quote);
    const uncertain=/\b(?:vielleicht|eventuell|vermutlich|angenommen|falls|wenn ich|könnte|würde|beispiel|zitiere|er meinte|sie meinte)\b|[?]/i.test(p.quote);
    const id='hermes-context:'+hash([p.turnId,p.topic,p.quote]).slice(0,40);
    const old=await tx.document.findUnique({where:{id}});
    if(old)return {id,state:old.state,duplicate:true,availableAsContext:old.approved&&old.state==='current'};
    if(await tx.document.count({where:{id:{startsWith:'hermes-context:'},source:'Hermes-Gespräch: '+p.turnId}})>=3)throw new AppError('CONTEXT_LIMIT','Höchstens drei kurze Erkenntnisse pro Nachricht.',429);
    const current=await tx.document.findMany({where:{id:{startsWith:'hermes-context:'},source:{startsWith:'Hermes-Gespräch: '},title:'Gesprächserkenntnis · '+p.topic,state:'current',approved:true}});
    const matching=current.filter(r=>contextRecord.parse(JSON.parse(r.content)).topic===p.topic);
    const approved=p.kind!=='proposal'&&clear&&!uncertain&&matching.every(r=>r.id===p.replacesId);
    let previous=null;
    if(p.replacesId){
      previous=await tx.document.findUnique({where:{id:p.replacesId}});
      if(!previous||!previous.source.startsWith('Hermes-Gespräch: ')||contextRecord.parse(JSON.parse(previous.content)).topic!==p.topic)throw new AppError('CONTEXT_REPLACEMENT','Die bezeichnete frühere Erkenntnis passt nicht zu diesem Thema.',409);
      if(!['current','proposed'].includes(previous.state))throw new AppError('CONTEXT_STALE','Die frühere Erkenntnis wurde bereits abgelöst.',409);
    }
    const record=contextRecord.parse({version:1,topic:p.topic,quote:p.quote,kind:approved?p.kind:'proposal',turnId:p.turnId,capturedAt:new Date().toISOString(),replacesId:p.replacesId});
    const content=JSON.stringify(record,null,2);
    await tx.document.create({data:{id,title:'Gesprächserkenntnis · '+p.topic,content,source:'Hermes-Gespräch: '+p.turnId,hash:hash(content),approved,state:approved?'current':'proposed'}});
    if(previous&&approved)await tx.document.update({where:{id:previous.id},data:{approved:false,state:'superseded'}});
    await tx.audit.create({data:{kind:'context.captured',entityId:id,actor:'hermes',detail:{turnId:p.turnId,approved,topic:p.topic,replacesId:p.replacesId}}});
    return {id,state:approved?'current':'proposed',availableAsContext:approved,obsidian:'Für den nächsten Rechner-Abgleich vorgemerkt; noch kein Nachweis einer geschriebenen Notiz.',source:'Wörtliche eigene Nutzerangabe, keine unabhängig geprüfte Tatsache.'};
  });
}
