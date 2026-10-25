import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
dotenv.config({path:'.env.local',quiet:true});dotenv.config({quiet:true});
process.env.APP_MODE ||= 'demo';process.env.APP_URL ||= 'http://127.0.0.1:3141';
if(process.env.APP_MODE==='demo'){
  await mkdir('.data',{recursive:true});let secret;
  try{secret=await readFile('.data/local-session.key','utf8');}catch{secret=randomBytes(48).toString('base64url');await writeFile('.data/local-session.key',secret,{mode:0o600});}
  process.env.SESSION_SECRET ||= secret;
}
const child=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',new URL(process.env.APP_URL).port||'3141'],{env:process.env,stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code||0));
