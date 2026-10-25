import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createTestDb} from '../lib/db';
import {recordMeal,correctMeal,removeMeal,personalOverview,buildBriefing,morningBriefingTick,calendarDay,nutritionDays,eventOccursOn} from '../lib/personal';
import {claimChatTurn} from '../lib/assistant-chat';
import {action} from '../lib/actions';
import {beginOAuth,googleFetch} from '../lib/google';
import {seal,sign} from '../lib/auth';
import {assistantAuth,assistantCall,toolDefinitions} from '../lib/assistant';
import {projectUrl,parseProjectAlarm,importProjectAlarm,originalProject,needsAlarmReplay} from '../lib/freelancermap';
import {queueAnalysis} from '../lib/jobs';
import {dayKey,hash} from '../lib/util';
import type {GmailMessage} from '../lib/mail';
let database:Awaited<ReturnType<typeof createTestDb>>,client:Awaited<ReturnType<typeof createTestDb>>['client'];
const owner='synthetic@example.org';
before(async()=>{process.env.APP_MODE='demo';database=await createTestDb();client=database.client;});
after(async()=>database.close());
const meal={externalId:'synthetic-message:meal-1',day:dayKey(),description:'Synthetic oats',calories:500,protein:30,carbs:50,fat:10,estimated:true,quantities:'Synthetic fixture, not a real meal'};
test('meal replay counts once, conflicting replay is rejected',async()=>{assert.equal((await recordMeal(client,meal,owner)).duplicate,false);assert.equal((await recordMeal(client,meal,owner)).duplicate,true);await assert.rejects(()=>recordMeal(client,{...meal,calories:600},owner),{code:'MEAL_CONFLICT'});assert.equal((await personalOverview(client)).nutrition.at(-1)?.calories,500);});
test('correction changes the same entry and rejects a stale revision',async()=>{const value=await client.mealEntry.findUniqueOrThrow({where:{externalId:meal.externalId}});const {externalId,...entry}=meal;await correctMeal(client,{id:value.id,expectedRevision:1,entry:{...entry,calories:450}},owner);await assert.rejects(()=>correctMeal(client,{id:value.id,expectedRevision:1,entry},owner),{code:'MEAL_CHANGED'});assert.equal(await client.mealEntry.count(),1);assert.equal((await personalOverview(client)).nutrition.at(-1)?.calories,450);});
test('removed meals leave totals and cannot be resurrected by replay',async()=>{const row=await client.mealEntry.findUniqueOrThrow({where:{externalId:meal.externalId}});await removeMeal(client,{id:row.id,expectedRevision:2},owner);assert.equal((await personalOverview(client)).nutrition.at(-1)?.recorded,false);await assert.rejects(()=>recordMeal(client,meal,owner),{code:'MEAL_CONFLICT'});});
test('missing intake is unknown and targets are not invented',async()=>{assert.equal(nutritionDays([]).at(-1)?.recorded,false);assert.equal((await personalOverview(client)).settings.calorieTarget,null);assert.equal(calendarDay.safeParse('2026-02-30').success,false);assert.equal(calendarDay.safeParse('2028-02-29').success,true);});
test('briefing persists once per Berlin day and exposes missing calendar',async()=>{await client.task.create({data:{title:'Synthetic follow-up',kind:'acquisition',dueAt:new Date('2026-10-11T06:00:00Z')}});const first=await buildBriefing(client,owner,new Date('2026-10-11T22:30:00Z'));assert.equal(first.day,'2026-10-12');assert.equal(first.priorities[0].title,'Synthetic follow-up');assert.equal(first.calendarChecked,false);assert.ok(first.alerts.length);await buildBriefing(client,owner,new Date('2026-10-11T22:31:00Z'));assert.equal(await client.dailyBriefing.count(),1);});
test('morning routine observes Berlin DST and refreshes after one hour',async()=>{
  assert.equal((await morningBriefingTick(client,owner,new Date('2026-10-25T06:59:00Z'))).reason,'before_morning');
  assert.equal(await client.dailyBriefing.findUnique({where:{day:'2026-10-25'}}),null);
  assert.equal((await morningBriefingTick(client,owner,new Date('2026-10-25T07:01:00Z'))).prepared,true);
  const first=await client.dailyBriefing.findUniqueOrThrow({where:{day:'2026-10-25'}});
  assert.equal((await morningBriefingTick(client,owner,new Date('2026-10-25T08:00:00Z'))).reason,'fresh');
  assert.deepEqual((await client.dailyBriefing.findUniqueOrThrow({where:{day:'2026-10-25'}})).snapshot,first.snapshot);
  assert.equal((await morningBriefingTick(client,owner,new Date('2026-10-25T08:02:00Z'))).prepared,true);
});
test('live web process cannot claim a queued Codex job through the old manual worker action',async()=>{
  const mode=process.env.APP_MODE;
  try{process.env.APP_MODE='live';await assert.rejects(()=>action('worker.once',{},owner),{code:'WORKER_BACKGROUND'});}
  finally{process.env.APP_MODE=mode;}
});
test('assistant token is distinct from n8n and unavailable tools cannot send',async()=>{process.env.ASSISTANT_TOKEN='synthetic-assistant-token-at-least-32-characters';process.env.INTEGRATION_TOKEN='synthetic-n8n-token-at-least-32-characters';assert.throws(()=>assistantAuth(new Request('https://example.org/api/assistant',{headers:{authorization:`Bearer ${process.env.INTEGRATION_TOKEN}`}})),{code:'ASSISTANT_AUTH'});assistantAuth(new Request('https://example.org/api/assistant',{headers:{authorization:`Bearer ${process.env.ASSISTANT_TOKEN}`}}));await assert.rejects(()=>assistantCall(client,'draft.send',{}),{code:'ASSISTANT_TOOL'});assert.ok(!toolDefinitions().some(t=>/send|publish|shell|secret/.test(t.name)));});
test('remembered task replay is idempotent and cannot change its meaning',async()=>{const p={externalId:'synthetic-task-1',title:'Synthetic training',kind:'training',dueAt:null,notes:null};await assistantCall(client,'remember_task',p);assert.equal((await assistantCall(client,'remember_task',p) as any).duplicate,true);await assert.rejects(()=>assistantCall(client,'remember_task',{...p,title:'Changed task'}),{code:'TASK_CONFLICT'});});
test('freelancermap accepts DE/COM project links and removes tracking, rejects impostors',()=>{assert.equal(projectUrl('https://www.freelancermap.com/project/test-react?utm_source=mail'),'https://freelancermap.com/project/test-react');assert.equal(projectUrl('https://freelancermap.de/projekt/n8n-automation#apply'),'https://freelancermap.de/projekt/n8n-automation');for(const url of ['https://freelancermap.de.attacker.test/projekt/foo','http://freelancermap.de/projekt/foo','https://user:password@freelancermap.de/projekt/foo','https://freelancermap.de/login','https://freelancermap.de:8443/projekt/foo'])assert.equal(projectUrl(url),null);});
const alarm:GmailMessage={id:'synthetic-alarm',threadId:'synthetic-thread',internalDate:'0',payload:{mimeType:'multipart/alternative',headers:[{name:'from',value:'alerts@freelancermap.de'},{name:'subject',value:'Synthetic project alert'}],parts:[{mimeType:'text/html',body:{data:Buffer.from('<a href="https://www.freelancermap.de/projekt/test-n8n?utm_source=x&amp;source=y">n8n Projekt</a><a href="https://www.freelancermap.com/project/test-react">React Projekt</a><a href="https://attacker.test/projekt/x">ignore</a>').toString('base64url')}}]}};
test('multipart HTML digest becomes individual links, never one invented project',()=>{const links=parseProjectAlarm(alarm);assert.equal(links.length,2);assert.equal(links[0].title,'n8n Projekt');assert.equal(links[0].url,'https://freelancermap.de/projekt/test-n8n');});
test('unavailable originals remain pending and cannot be analyzed; replay does not duplicate',async()=>{const result=await importProjectAlarm(client,alarm,owner,{remaining:0});assert.equal(result.imported,2);assert.equal(result.pending,2);assert.equal(result.queued,0);assert.equal((await importProjectAlarm(client,alarm,owner,{remaining:0})).duplicate,true);const rows=await client.opportunity.findMany();assert.equal(rows.length,2);await client.profile.create({data:{version:1,name:'Synthetic',claims:[],skills:[],confirmed:true}});await assert.rejects(()=>queueAnalysis(client,rows[0].id,owner),{code:'ORIGINAL_TEXT_REQUIRED'});});
test('non-project mail creates no project opportunity',async()=>{const message={...alarm,id:'synthetic-invoice',payload:{headers:alarm.payload.headers,mimeType:'text/plain',body:{data:Buffer.from('Synthetic invoice without a project link').toString('base64url')}}};const before=await client.opportunity.count();assert.equal((await importProjectAlarm(client,message,owner,{remaining:0})).ignored,true);assert.equal(await client.opportunity.count(),before);});

test('numeric project alarm links remove tracking and allow only a same-site project redirect',()=>{
  assert.equal(projectUrl('https://www.freelancermap.de/nproj/3059175.html?agent=synthetic&t=synthetic'),'https://freelancermap.de/nproj/3059175.html');
  for(const url of ['https://freelancermap.de/nproj/../login','https://freelancermap.de/nproj/text.html','https://freelancermap.de/nproj/3059175.html/extra','https://freelancermap.de/posteingang.html?token=synthetic'])assert.equal(projectUrl(url),null);
  const source={url:'https://www.freelancermap.de/projekt/synthetic-project',title:'Synthetic original',content:'Synthetic original text. '.repeat(20)};
  assert.equal(originalProject(source,'https://freelancermap.de/nproj/3059175.html'),true);
  assert.equal(originalProject({...source,url:'https://attacker.test/projekt/synthetic-project'},'https://freelancermap.de/nproj/3059175.html'),false);
  assert.equal(originalProject({...source,url:'https://freelancermap.com/project/synthetic-project'},'https://freelancermap.de/nproj/3059175.html'),false);
  assert.equal(originalProject({...source,url:'https://freelancermap.de/login'},'https://freelancermap.de/nproj/3059175.html'),false);
  assert.equal(originalProject({...source,title:'Anmeldung'},'https://freelancermap.de/nproj/3059175.html'),false);
  assert.equal(originalProject(source,'https://freelancermap.de/projekt/different-project'),false);
});
test('legacy ignored alarms are reprocessed once without deleting history or duplicating projects',async()=>{
  const message={...alarm,id:'synthetic-numeric-alarm',payload:{headers:alarm.payload.headers,mimeType:'text/html',body:{data:Buffer.from('<a href="https://www.freelancermap.de/nproj/3059175.html?agent=synthetic&amp;t=synthetic">Synthetic project</a>').toString('base64url')}}};
  const externalId=`gmail_alarms:${message.id}`,subject='Synthetic project alert';
  const legacy=await client.sourceEvent.create({data:{externalId,kind:'gmail_ignored',contentHash:hash(subject),content:subject}});
  assert.equal(needsAlarmReplay(legacy),true);
  const before=await client.opportunity.count();
  const result=await importProjectAlarm(client,message,owner,{remaining:0},'gmail_alarms');
  assert.equal(result.imported,1);assert.equal(result.pending,1);
  const updated=await client.sourceEvent.findUniqueOrThrow({where:{externalId}});
  assert.equal(updated.id,legacy.id);assert.equal(updated.kind,'gmail_digest');assert.equal(needsAlarmReplay(updated),false);
  assert.equal((await importProjectAlarm(client,message,owner,{remaining:0},'gmail_alarms')).duplicate,true);
  assert.equal(await client.opportunity.count(),before+1);
  const ignored={...message,id:'synthetic-still-ignored',payload:{headers:alarm.payload.headers,mimeType:'text/plain',body:{data:Buffer.from('Synthetic notification without projects').toString('base64url')}}};
  await importProjectAlarm(client,ignored,owner,{remaining:0},'gmail_alarms');
  assert.equal(needsAlarmReplay(await client.sourceEvent.findUniqueOrThrow({where:{externalId:`gmail_alarms:${ignored.id}`}})),false);
});

test('all-day and overnight events span local days with exclusive midnight endings',()=>{
  const allDay={id:'all-day',start:{date:'2026-10-10'},end:{date:'2026-10-13'}};
  assert.equal(eventOccursOn(allDay,'2026-10-11'),true);assert.equal(eventOccursOn(allDay,'2026-10-13'),false);
  const overnight={id:'overnight',start:{dateTime:'2026-10-24T23:00:00+02:00'},end:{dateTime:'2026-10-25T03:00:00+01:00'}};
  assert.equal(eventOccursOn(overnight,'2026-10-25'),true);
  assert.equal(eventOccursOn({...overnight,end:{dateTime:'2026-10-25T00:00:00+02:00'}},'2026-10-25'),false);
});
test('chat duplicates do not call twice, active work is serialized, and daily requests are bounded',async()=>{
  const database=await createTestDb(),now=new Date('2026-10-11T22:30:00Z'),id='11111111-1111-4111-8111-111111111111';
  try {
    assert.equal((await claimChatTurn(database.client,{id,message:'Synthetic request'},now)).duplicate,false);
    assert.equal((await claimChatTurn(database.client,{id,message:'Synthetic request'},now)).duplicate,true);
    await assert.rejects(()=>claimChatTurn(database.client,{id,message:'Changed request'},now),{code:'CHAT_CONFLICT'});
    await assert.rejects(()=>claimChatTurn(database.client,{id:'22222222-2222-4222-8222-222222222222',message:'Concurrent request'},now),{code:'CHAT_BUSY'});
    await database.client.assistantTurn.update({where:{id},data:{status:'completed'}});
    for(let i=0;i<24;i++)await database.client.assistantTurn.create({data:{id:`limit-${i}`,message:'Synthetic completed fixture',status:'completed',createdAt:now}});
    await assert.rejects(()=>claimChatTurn(database.client,{id:'33333333-3333-4333-8333-333333333333',message:'Over quota'},now),{code:'CHAT_LIMIT'});
  }finally{await database.close();}
});
test('business alarm mailbox requests only read access and is selected independently from sending mailbox',async()=>{
  const names=['APP_MODE','APP_URL','OWNER_EMAIL','SESSION_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GMAIL_ALARM_OWNER_EMAIL'],saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  const originalFetch=global.fetch;
  try {
    Object.assign(process.env,{APP_MODE:'live',APP_URL:'https://synthetic.example.org',OWNER_EMAIL:owner,SESSION_SECRET:'synthetic-secret-only-for-test-32-characters',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-client-secret',GMAIL_ALARM_OWNER_EMAIL:'alarms@example.org'});
    const request=new Request('https://synthetic.example.org/api/auth/start?purpose=gmail_alarms',{headers:{cookie:`ai_os_session=${sign({email:owner,expires:Date.now()+60000})}`}});
    const location=new URL(beginOAuth(request).headers.get('location')!);
    assert.equal(location.searchParams.get('login_hint'),'alarms@example.org');assert.match(location.searchParams.get('scope')!,/gmail.readonly/);assert.doesNotMatch(location.searchParams.get('scope')!,/gmail.send/);
    await client.integration.create({data:{id:'gmail_alarms',status:'connected',scopes:[],sealed:seal({access_token:'synthetic-token',expires_at:Date.now()+600000,scope:'gmail.readonly'})}});
    global.fetch=async(input,options)=>{assert.equal(String(input),'https://gmail.googleapis.com/gmail/v1/users/me/messages?q=synthetic');assert.equal((options?.headers as any).authorization,'Bearer synthetic-token');return Response.json({messages:[]});};
    assert.deepEqual(await googleFetch(client,'gmail_alarms','messages?q=synthetic'),{messages:[]});
  }finally{global.fetch=originalFetch;for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}
});
