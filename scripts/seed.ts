import 'dotenv/config';
import { db } from '../lib/db';
import { seedDemo } from '../lib/demo';
import { config } from '../lib/config';
if(!config().demo)throw new Error('Demo fixtures require APP_MODE=demo and a dedicated demo database.');
const client=await db();await seedDemo(client);console.log('Fictional demo fixtures are ready. No external actions performed.');await client.$disconnect();process.exit(0);
