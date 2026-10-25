import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { hash } from './util';
const start='<!-- AI-OS MANAGED START -->',end='<!-- AI-OS MANAGED END -->';
export async function syncNote(directory:string,note:{id:string;title:string;content:string}){
  const target=path.resolve(directory);await mkdir(target,{recursive:true});
  const safe=note.id.replace(/[^a-zA-Z0-9_-]/g,'');if(safe!==note.id)throw new Error('Invalid note id');
  const file=path.join(target,`${safe}.md`),manifest=path.join(target,'.ai-os-manifest.json');let known:Record<string,string>={};try{known=JSON.parse(await readFile(manifest,'utf8'));}catch{}
  let previous:string|null=null;try{previous=await readFile(file,'utf8');}catch{}
  const managed=`${start}\n${note.content.trim()}\n${end}`;
  if(previous!==null){const left=previous.indexOf(start),right=previous.indexOf(end);const block=left>=0&&right>left?previous.slice(left,right+end.length):null;
    if(!block||!known[note.id]||hash(block)!==known[note.id]){const incoming=`${file}.incoming-${hash(note.content).slice(0,10)}.md`;try{await writeFile(incoming,`${managed}\n`,{mode:0o600,flag:'wx'});}catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST'))throw error;}return {id:note.id,status:'conflict',file,incoming};}
    await writeFile(file,previous.slice(0,left)+managed+previous.slice(right+end.length),{mode:0o600});
  }else await writeFile(file,`${managed}\n\n## Persönliche Ergänzungen\n\n`,{mode:0o600,flag:'wx'});
  known[note.id]=hash(managed);await writeFile(manifest,JSON.stringify(known,null,2),{mode:0o600});return {id:note.id,status:'synced',file};
}
