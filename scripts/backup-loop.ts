import 'dotenv/config';
import { spawn } from 'node:child_process';
if(process.env.BACKUP_ENABLED!=='true')throw new Error('Backup schedule has not been activated.');
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
while(!stopping){await new Promise<void>(resolve=>{const child=spawn(process.execPath,['--import','tsx','scripts/backup.ts'],{env:process.env,stdio:'inherit',windowsHide:true});child.on('exit',()=>resolve());child.on('error',()=>resolve());});for(let i=0;i<1440&&!stopping;i++)await new Promise(resolve=>setTimeout(resolve,60_000));}
