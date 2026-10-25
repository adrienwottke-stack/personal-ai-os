import { createCipheriv,createDecipheriv,randomBytes,scryptSync,createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { AppError } from './util';
import { hash } from './util';
const magic=Buffer.from('AIOSBKP1');
const bundleMagic=Buffer.from('AIOSPKG2');
export function packRecovery(database:Buffer,files:{storageKey:string;bytes:Buffer}[]){
  let size=database.length;for(const f of files){if(!/^[a-f0-9-]{36}$/i.test(f.storageKey)||f.bytes.length>8_000_000)throw new Error('Invalid recovery attachment');size+=f.bytes.length;}if(size>64*1024*1024)throw new Error('Recovery bundle exceeds bounded size; use a separate verified file archive');
  return Buffer.concat([bundleMagic,Buffer.from(JSON.stringify({database:database.toString('base64'),files:files.map(f=>({storageKey:f.storageKey,size:f.bytes.length,hash:hash(f.bytes.toString('base64')),data:f.bytes.toString('base64')}))}))]);
}
export function unpackRecovery(bytes:Buffer){
  if(!bytes.subarray(0,8).equals(bundleMagic))return {database:bytes,files:[] as {storageKey:string;bytes:Buffer}[],includesFiles:false};
  const data=JSON.parse(bytes.subarray(8).toString());if(typeof data.database!=='string'||!Array.isArray(data.files)||data.files.length>1000)throw new Error('Invalid recovery bundle');
  const files=data.files.map((f:any)=>{if(!/^[a-f0-9-]{36}$/i.test(f.storageKey)||typeof f.data!=='string')throw new Error('Invalid recovery path');const bytes=Buffer.from(f.data,'base64');if(bytes.length!==f.size||bytes.length>8_000_000||hash(bytes.toString('base64'))!==f.hash)throw new Error('Recovery attachment mismatch');return {storageKey:f.storageKey,bytes};});
  return {database:Buffer.from(data.database,'base64'),files,includesFiles:true};
}
export function encryptBackup(data:Buffer,secret:string){if(secret.length<32)throw new AppError('BACKUP_SETUP','BACKUP_SECRET muss mindestens 32 Zeichen haben.');const salt=randomBytes(16),iv=randomBytes(12),key=scryptSync(secret,salt,32);const cipher=createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);return Buffer.concat([magic,salt,iv,cipher.getAuthTag(),encrypted]);}
export function decryptBackup(file:Buffer,secret:string){if(file.length<52||!file.subarray(0,8).equals(magic))throw new Error('Invalid backup format');const salt=file.subarray(8,24),iv=file.subarray(24,36),tag=file.subarray(36,52),key=scryptSync(secret,salt,32);const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(tag);return Buffer.concat([cipher.update(file.subarray(52)),cipher.final()]);}
export const backupHash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');
export function pgEnvironment(url:string):NodeJS.ProcessEnv{const parsed=new URL(url);if(parsed.protocol!=='postgresql:'&&parsed.protocol!=='postgres:')throw new Error('Dedicated PostgreSQL URL required');return {NODE_ENV:'production',PATH:process.env.PATH,Path:process.env.Path,SystemRoot:process.env.SystemRoot,PGHOST:parsed.hostname,PGPORT:parsed.port||'5432',PGDATABASE:decodeURIComponent(parsed.pathname.slice(1)),PGUSER:decodeURIComponent(parsed.username),PGPASSWORD:decodeURIComponent(parsed.password),PGSSLMODE:parsed.searchParams.get('sslmode')||'prefer'};}
export async function postgresProcess(binary:string,args:string[],url:string,stdin?:Buffer){return new Promise<Buffer>((resolve,reject)=>{const child=spawn(binary,args,{env:pgEnvironment(url),windowsHide:true,stdio:['pipe','pipe','pipe'],shell:false});const chunks:Buffer[]=[];let bytes=0;const timer=setTimeout(()=>child.kill('SIGKILL'),120_000);child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>256*1024*1024){child.kill('SIGKILL');return;}chunks.push(chunk);});child.stderr.resume();child.on('error',()=>{clearTimeout(timer);reject(new Error('PostgreSQL backup tool unavailable'));});child.on('close',code=>{clearTimeout(timer);if(code!==0)reject(new Error('PostgreSQL backup or restore failed; credentials are withheld from diagnostics'));else resolve(Buffer.concat(chunks));});child.stdin.on('error',()=>{});child.stdin.end(stdin);});}
