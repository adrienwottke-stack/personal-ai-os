import { readFileSync } from 'node:fs';
import { db } from '../lib/db';
import { contextRecord } from '../lib/conversation-context';
import { hash } from '../lib/util';
const request=JSON.parse(readFileSync(0,'utf8')) as {after?:string};
if(request.after&&!/^hermes-context:[a-f0-9]{40}$/.test(request.after))throw new Error('Invalid cursor');
const client=await db();
try{
  const rows=await client.document.findMany({where:{id:{startsWith:'hermes-context:',...(request.after?{gt:request.after}:{})},source:{startsWith:'Hermes-Gespräch: '}},orderBy:{id:'asc'},take:101});
  const page=rows.slice(0,100).map(r=>{
    if(hash(r.content)!==r.hash||!['current','proposed','superseded'].includes(r.state))throw new Error('Invalid context record');
    const record=contextRecord.parse(JSON.parse(r.content));
    if(r.source!=='Hermes-Gespräch: '+record.turnId||r.approved!==(r.state==='current'))throw new Error('Invalid context ownership');
    return {id:r.id,state:r.state,record};
  });
  console.log(JSON.stringify({version:1,records:page,next:rows.length>100?page.at(-1)!.id:null}));
}finally{await client.$disconnect();}
