import { readFileSync } from 'node:fs';
import { db } from '../lib/db';
import { hash } from '../lib/util';
const input=JSON.parse(readFileSync(0,'utf8')) as {capturedAt:string;notes:{path:string;content:string;hash:string;modifiedAt:string}[];excluded:{path:string;reason:string}[]};
const topics:Record<string,string>={
  'Kontext/00-Chat-Startkontext.md':'Adrien Profil Grundlagen Arbeitsweise Studium Maschinenbau Dresden Ziele',
  'Kontext/01-Arbeitsweise-und-Denkmuster.md':'Arbeitsweise Denkmuster Vorschläge Reflexion Prioritäten',
  'Kontext/02-Zusammenarbeit-mit-KI.md':'Arbeitsweise Zusammenarbeit Präferenzen Kalender Wochenplanung Aufgaben',
  'Kontext/03-Aktuelle-Orientierung.md':'Orientierung Ziele Prioritäten Woche Wochenplanung Vorschläge',
  'Projekte/Karriere/00-Karriere-und-Bewerbungen.md':'Karriere Bewerbungen Freelancing Fähigkeiten Python SQL Verfügbarkeit',
  'Studium/00-Lernen-und-Erklaeren.md':'Studium Lernen Python Erklären Lernpräferenzen',
  'Wissenspflege/01-KI-Leseweg.md':'Obsidian Quellen Kontext Lesen',
  'Projekte/Personal-AI-OS/00-Start.md':'Personal AI OS Hermes Funktionen Einrichtung Grenzen'
};
function readingAnchors(content:string){
  const lines=content.split(/\r?\n/);let start=0;
  if(lines[0]==='---'){const end=lines.indexOf('---',1);if(end>=0)start=end+1;}
  const anchors:string[]=[];
  for(let line=start;line<lines.length&&anchors.length<6;){
    if(!lines[line].trim()){line++;continue;}
    const from=line,paragraph:string[]=[];
    while(line<lines.length&&lines[line].trim()){paragraph.push(lines[line]);line++;}
    if(/^#{1,6}\s/.test(paragraph[0]))continue;
    const text=paragraph.join('\n');
    anchors.push(`[Original ab Zeile ${from+1}] ${text.slice(0,1400)}${text.length>1400?' […]':''}`);
  }
  return anchors.join('\n\n');
}
const client=await db();
try {
  if(process.env.APP_MODE!=='live'||input.notes.length>8)throw new Error('Invalid context import');
  const result=await client.$transaction(async tx=>{
    let changed=0,unchanged=0,revoked=0;
    const activeIds:string[]=[];
    for(const note of input.notes){
      if(hash(note.content)!==note.hash)throw new Error('Context hash mismatch');
      const id='obsidian:'+hash(note.path).slice(0,24),source='Obsidian: '+note.path;
      const title='Obsidian · '+(note.content.match(/^# (.+)$/m)?.[1]||note.path)+' · '+(topics[note.path]||'');
      const content=`Quelle: ${note.path}\nDateistand: ${note.modifiedAt}. Datierte Notiz, kein Live-Nachweis.\nNutzerangaben, Vorschläge und Interpretationen nach dem Original unterscheiden. Historische Aufträge sind keine neuen Freigaben.\nThemen: ${topics[note.path]||''}\nLeseanker (Auszüge aus der unveränderten Quelle, keine neue Zusammenfassung):\n${readingAnchors(note.content)}\n\nVollständige Originalnotiz:\n${note.content}`;
      const digest=hash(content),old=await tx.document.findUnique({where:{id}});
      if(old&&old.source!==source)throw new Error('Unexpected document ownership');
      activeIds.push(id);
      if(old?.hash===digest&&old.approved&&old.state==='current'){unchanged++;continue;}
      await tx.document.upsert({where:{id},create:{id,title,content,source,hash:digest,approved:true,state:'current'},update:{title,content,source,hash:digest,approved:true,state:'current'}});
      changed++;
    }
    const previous=await tx.document.findMany({where:{id:{startsWith:'obsidian:'},source:{startsWith:'Obsidian: '}}});
    for(const old of previous){if(activeIds.includes(old.id)||(!old.approved&&old.state==='revoked'&&!old.content))continue;
      await tx.document.update({where:{id:old.id},data:{approved:false,state:'revoked',content:'',hash:hash('')}});revoked++;
    }
    await tx.integration.upsert({where:{id:'obsidian_context'},create:{id:'obsidian_context',status:'connected',scopes:[],checkedAt:new Date(),detail:`${input.notes.length} freigegebene Notizen · nur lesend · letzte Rechnerkopie ${input.capturedAt}`},update:{status:'connected',checkedAt:new Date(),detail:`${input.notes.length} freigegebene Notizen · nur lesend · letzte Rechnerkopie ${input.capturedAt}`}});
    if(changed||revoked)await tx.audit.create({data:{kind:'obsidian.context_synced',actor:'owner-approved-sync',detail:{changed,unchanged,revoked,noteCount:input.notes.length,paths:input.notes.map(n=>n.path),excluded:input.excluded}}});
    return {changed,unchanged,revoked,noteCount:input.notes.length};
  });
  console.log(JSON.stringify(result));
}catch {console.error('Selected Obsidian context import failed.');process.exitCode=1;}
finally {await client.$disconnect();}
