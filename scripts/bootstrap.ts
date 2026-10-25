import 'dotenv/config';import {db} from '../lib/db';import {seedEvalCases} from '../lib/demo';
const client=await db();await seedEvalCases(client);await client.runtimeState.upsert({where:{id:'singleton'},create:{id:'singleton'},update:{}});console.log('Runtime and 30 synthetic eval cases initialized. No personal profile or business data invented.');await client.$disconnect();
