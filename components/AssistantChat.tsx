'use client';
import { useRef, useState } from 'react';
import type { CockpitState } from '@/lib/state';
export function AssistantChat({data,refresh}:{data:CockpitState;refresh:()=>Promise<unknown>}) {
  const requestRef=useRef<{id:string;message:string}|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  async function send(event:React.FormEvent) {
    event.preventDefault();setBusy(true);setError('');
    try{if(!requestRef.current||requestRef.current.message!==message)requestRef.current={id:crypto.randomUUID(),message};const response=await fetch('/api/assistant/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(requestRef.current)});const result=await response.json();if(!response.ok)throw new Error(result.message||'Die Antwort konnte nicht gelesen werden.');setMessage('');requestRef.current=null;}catch(e){setError(e instanceof Error?e.message:'Die Antwort konnte nicht gelesen werden.');}finally{await refresh();setBusy(false);}
  }
  return <section className="panel personal-chat"><div className="section-heading"><div><span className="eyebrow">HERMES</span><h2>Sprich mit deinem Assistenten.</h2></div></div><p className="muted">„Was steht heute an?“ · „Merke mir morgen Training vor.“ · „Ich habe 80 g Haferflocken gegessen.“</p>
    {data.personal.chat.length>0&&<div className="personal-chat-history">{[...data.personal.chat].reverse().map(t=><div key={t.id}><small>{new Date(t.createdAt).toLocaleString("de-DE",{timeZone:"Europe/Berlin"})} · {t.status==="completed"?"Antwort zum damaligen Stand":t.status==="failed"?"Antwort unvollständig – Aufgabenstand prüfen":"In Bearbeitung"}</small><p className="chat-owner">{t.message}</p><p className={t.status==='failed'?'personal-notice':'chat-assistant'}>{t.response||'Antwort wird vorbereitet …'}</p></div>)}</div>}
    <form onSubmit={send}><label className="field"><span>Deine Nachricht</span><textarea name="message" value={message} onChange={e=>setMessage(e.target.value)} required maxLength={4000} placeholder="Was möchtest du heute erledigen?"/></label>{error&&<p role="alert" className="personal-notice">{error}</p>}<button className="btn primary" disabled={busy||data.demo||!message.trim()}>{busy?'Hermes antwortet …':'Nachricht senden'}</button><small>{data.demo?'Echte KI-Antworten sind in der Demo deaktiviert.':'Bis zu 25 Nachrichten pro Tag. Mahlzeiten-Schätzwerte bleiben als solche erkennbar.'}</small></form>
  </section>;
}
