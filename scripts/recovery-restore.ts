import 'dotenv/config';
import {readFile,mkdir,writeFile,chown} from 'node:fs/promises';
import path from 'node:path';
import {Client} from 'pg';
import {backupHash,decryptBackup,postgresProcess,unpackRecovery} from '../lib/backups';
import {hash} from '../lib/util';

// This recovery path uses only the offsite archive and its metadata, not the lost application database.
const file=process.argv[process.argv.indexOf('--file')+1];
const source=process.env.DATABASE_URL,target=process.env.RESTORE_DATABASE_URL;
if(!process.argv.includes('--confirm-isolated')||!source||!target||!file||!/^ai-os-[\w-]+\.aios\.enc$/.test(file))throw new Error('Use a backup filename, dedicated DATABASE_URL, fresh RESTORE_DATABASE_URL and --confirm-isolated.');
const src=new URL(source),dst=new URL(target),name=decodeURIComponent(dst.pathname.slice(1));
if(!/^ai_os_restore_[a-z0-9_]+$/.test(name)||src.pathname===dst.pathname||src.hostname!==dst.hostname||src.port!==dst.port)throw new Error('Recovery needs a fresh ai_os_restore_* database on the configured dedicated database server.');
const root=path.resolve(process.env.BACKUP_DIR||'private/backups');
const encrypted=await readFile(path.join(root,file));
const metadata=JSON.parse(await readFile(path.join(root,file+'.json'),'utf8')) as {file:string;hash:string;size:number;counts:Record<string,number>};
if(metadata.file!==file||metadata.hash!==backupHash(encrypted)||metadata.size!==encrypted.length||!metadata.counts||!Object.keys(metadata.counts).length||Object.entries(metadata.counts).some(([table,count])=>!/^[_a-zA-Z0-9]+$/.test(table)||!Number.isSafeInteger(count)||count<0))throw new Error('Recovery archive or table metadata is invalid.');
const recovered=unpackRecovery(decryptBackup(encrypted,process.env.BACKUP_SECRET||'')),archive=recovered.database;
const filesRoot=path.join(root,name+'-files','attachments');await mkdir(filesRoot,{recursive:true,mode:0o700});for(const f of recovered.files)await writeFile(path.join(filesRoot,f.storageKey),f.bytes,{mode:0o600,flag:'wx'});
if(process.platform==='linux'&&process.getuid?.()===0){await chown(path.dirname(filesRoot),10001,10001);await chown(filesRoot,10001,10001);for(const f of recovered.files)await chown(path.join(filesRoot,f.storageKey),10001,10001);}
const admin=new Client({connectionString:source});await admin.connect();
try{if((await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[name])).rowCount)throw new Error('Recovery target exists; choose a new target. No existing database is overwritten.');await admin.query(`CREATE DATABASE "${name}"`);}finally{await admin.end();}
await postgresProcess(process.env.PG_RESTORE_BINARY||'pg_restore',['--no-owner','--no-acl','--exit-on-error','--dbname',name],target,archive);
const verify=new Client({connectionString:target});await verify.connect();
try{const tableCount=(await verify.query("SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")).rows[0].count;if(tableCount!==Object.keys(metadata.counts).length)throw new Error('Recovery table count differs.');for(const [table,count] of Object.entries(metadata.counts)){const actual=(await verify.query(`SELECT COUNT(*)::int AS count FROM "${table}"`)).rows[0].count;if(actual!==count)throw new Error(`Recovery row count differs for ${table}`);}const attachments=(await verify.query('SELECT "storageKey", "hash", "size" FROM "Attachment"')).rows;if(attachments.length!==recovered.files.length)throw new Error('Recovery attachment count differs');for(const f of attachments){if(!/^[a-f0-9-]{36}$/i.test(f.storageKey))throw new Error('Invalid recovery attachment key');const bytes=await readFile(path.join(filesRoot,f.storageKey));if(bytes.length!==f.size||hash(bytes.toString('base64'))!==f.hash)throw new Error('Recovery attachment differs');}console.log(JSON.stringify({restoredTo:name,tables:tableCount,rowCountsChecked:Object.keys(metadata.counts).length,attachmentsChecked:attachments.length,filesRoot:path.dirname(filesRoot),verified:true,requiresOriginalDatabase:false}));}finally{await verify.end();}
