import 'dotenv/config';
import { db } from '../lib/db';
import { workOnce } from '../lib/jobs';
import { config } from '../lib/config';
const once=process.argv.includes('--once');
if(!config().aiEnabled){console.log('AI_ENABLED=false: queue retained, worker disabled.');process.exit(0);}
const client=await db();let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
do{const result=await workOnce(client);console.log(JSON.stringify({at:new Date().toISOString(),...result}));if(once)break;await new Promise(resolve=>setTimeout(resolve,5000));}while(!stopping);
await client.$disconnect();process.exit(0);
