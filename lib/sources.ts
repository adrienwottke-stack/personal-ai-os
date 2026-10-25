import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { PrismaClient } from '@/generated/prisma/client';
import { AppError, canonicalUrl, hash } from './util';
import { ingestSource } from './acquisition';

export function publicAddress(address:string){
  if(isIP(address)===6){const first=parseInt(address.split(':')[0],16);return first>=0x2000&&first<=0x3fff&&!/^2001:0*db8:/i.test(address);}
  if(isIP(address)!==4)return false;
  const [a,b]=address.split('.').map(Number);
  return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19)));
}
export function textFromHtml(html:string){
  return html.replace(/<(script|style|nav|noscript)[\s\S]*?<\/\1>/gi,' ').replace(/<!--[\s\S]*?-->/g,' ').replace(/<\/(?:p|div|h[1-6]|li|section|br)>/gi,'\n').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|#160);/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#(\d+);/g,(_,code)=>String.fromCodePoint(Math.min(0x10ffff,Number(code)))).replace(/[ \t]+/g,' ').replace(/\n\s*\n+/g,'\n\n').trim();
}
export function pinnedLookup(pinned:{address:string;family:number}):NonNullable<https.RequestOptions['lookup']> {
  return ((_name:unknown,options:unknown,callback:any)=>{
    if(options&&typeof options==='object'&&'all' in options&&options.all)callback(null,[pinned]);
    else callback(null,pinned.address,pinned.family);
  }) as NonNullable<https.RequestOptions['lookup']>;
}
export async function fetchPublicSource(rawUrl:string,redirects=0):Promise<{url:string;title:string;content:string}>{
  const url=new URL(canonicalUrl(rawUrl));
  if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password)throw new AppError('PUBLIC_URL','Nur öffentliche HTTPS-Quellen auf Port 443 können geladen werden.');
  const addresses=await lookup(url.hostname,{all:true});
  if(!addresses.length||addresses.some(r=>!publicAddress(r.address)))throw new AppError('PRIVATE_SOURCE','Diese Quelle gehört nicht zum erlaubten öffentlichen Netz.',403);
  const pinned=addresses.find(address=>address.family===4)||addresses[0];
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{headers:{'User-Agent':'Personal-AI-OS/0.1 source reader','Accept':'text/html,text/plain','Accept-Encoding':'identity'},lookup:pinnedLookup(pinned)},response=>{
      if(response.statusCode&&response.statusCode>=300&&response.statusCode<400&&response.headers.location){response.resume();if(redirects>=3){reject(new AppError('REDIRECT_LIMIT','Die Quelle hat zu viele Weiterleitungen.'));return;}resolve(fetchPublicSource(new URL(response.headers.location,url).href,redirects+1));return;}
      if(response.statusCode!==200){response.resume();reject(new AppError('SOURCE_ACCESS','Die Originalquelle ist nicht öffentlich lesbar. Stelle den Text manuell bereit.',422));return;}
      if(!/^(text\/html|text\/plain)/i.test(String(response.headers['content-type']||''))){response.resume();reject(new AppError('SOURCE_FORMAT','Nur HTML- und Textquellen werden unterstützt.',422));return;}
      const chunks:Buffer[]=[];let size=0;response.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>600_000){request.destroy(new AppError('SOURCE_SIZE','Die Quelle ist zu groß.',413));return;}chunks.push(chunk);});
      response.on('end',()=>{const html=Buffer.concat(chunks).toString('utf8');const title=textFromHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||url.hostname).slice(0,500);const content=textFromHtml(html).slice(0,40_000);if(content.length<40){reject(new AppError('SOURCE_EMPTY','Die Quelle enthält keinen ausreichenden lesbaren Text.',422));return;}resolve({url:url.href,title,content});});
    });request.setTimeout(15_000,()=>request.destroy(new AppError('SOURCE_TIMEOUT','Die Quelle antwortet nicht rechtzeitig.',504)));request.on('error',reject);
  });
}
export async function enrichSource(client:PrismaClient,id:string,owner:string){
  const old=await client.opportunity.findUniqueOrThrow({where:{id}});if(!old.url)throw new AppError('SOURCE_URL','Diese Chance hat keinen Original-Link.');
  const fresh=await fetchPublicSource(old.url);return ingestSource(client,{externalId:`public:${hash({url:old.url,content:fresh.content})}`,kind:'public',title:fresh.title,company:old.company,url:old.url,content:fresh.content},owner);
}
