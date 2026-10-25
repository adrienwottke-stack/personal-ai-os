import 'dotenv/config';
import { mkdir,writeFile,readFile } from 'node:fs/promises';
import path from 'node:path';
import { db,audit } from '../lib/db';
import { config } from '../lib/config';
import { backupHash,encryptBackup,postgresProcess,packRecovery } from '../lib/backups';
import { hash } from '../lib/util';
import {Client} from 'pg';
if(!process.env.DATABASE_URL)throw new Error('PostgreSQL DATABASE_URL required. Local demo is not a production backup.');
const snapshotClient=new Client({connectionString:process.env.DATABASE_URL});await snapshotClient.connect();await snapshotClient.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
const snapshot=(await snapshotClient.query('SELECT pg_export_snapshot() AS id')).rows[0].id as string;
const tableNames=(await snapshotClient.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name")).rows.map(r=>String(r.table_name));
const counts:Record<string,number>={};for(const table of tableNames){if(!/^[_a-zA-Z0-9]+$/.test(table))throw new Error('Invalid table identifier');counts[table]=(await snapshotClient.query(`SELECT COUNT(*)::int AS count FROM "${table}"`)).rows[0].count;}
let archive:Buffer;const files=[];try{
const fileRows=(await snapshotClient.query('SELECT "storageKey", "hash", "size" FROM "Attachment"')).rows;
for(const row of fileRows){if(!/^[a-f0-9-]{36}$/i.test(row.storageKey))throw new Error('Invalid attachment key');const bytes=await readFile(path.join(config().dataDir,'attachments',row.storageKey));if(bytes.length!==row.size||hash(bytes.toString('base64'))!==row.hash)throw new Error('Source attachment verification failed');files.push({storageKey:row.storageKey,bytes});}
archive=packRecovery(await postgresProcess(process.env.PG_DUMP_BINARY||'pg_dump',['--format=custom','--no-owner','--no-acl','--snapshot',snapshot],process.env.DATABASE_URL),files);}finally{await snapshotClient.query('ROLLBACK');await snapshotClient.end();}
const encrypted=encryptBackup(archive,process.env.BACKUP_SECRET||'');const dir=path.resolve(process.env.BACKUP_DIR||path.join(config().dataDir,'backups'));await mkdir(dir,{recursive:true,mode:0o700});
const file=`ai-os-${new Date().toISOString().replace(/[:.]/g,'-')}.aios.enc`;await writeFile(path.join(dir,file),encrypted,{mode:0o600,flag:'wx'});
const client=await db();const record=await client.backup.create({data:{file,hash:backupHash(encrypted),size:encrypted.length}});await writeFile(path.join(dir,file+'.json'),JSON.stringify({id:record.id,file,hash:record.hash,size:record.size,counts,includesFiles:true,attachmentCount:files.length}),{mode:0o600});await audit(client,'backup.created','backup',record.id,{file,size:record.size,includesFiles:true,attachmentCount:files.length});console.log(JSON.stringify({id:record.id,file,size:record.size,encrypted:true,includesFiles:true,attachmentCount:files.length,restoreVerified:false}));await client.$disconnect();
