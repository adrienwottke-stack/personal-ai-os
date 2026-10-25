import 'dotenv/config';
import { readFile,mkdir,writeFile,chown } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { db,audit } from '../lib/db';
import { config } from '../lib/config';
import { decryptBackup,backupHash,postgresProcess,unpackRecovery } from '../lib/backups';
import { hash } from '../lib/util';
const file=process.argv[process.argv.indexOf('--file')+1];
const source=process.env.DATABASE_URL,target=process.env.RESTORE_DATABASE_URL;
if(!process.argv.includes('--confirm-isolated')||!source||!target||!file)throw new Error('Use --file FILENAME --confirm-isolated with a separate RESTORE_DATABASE_URL.');
const src=new URL(source),dst=new URL(target),name=decodeURIComponent(dst.pathname.slice(1));
if(!/^ai_os_restore_[a-z0-9_]+$/.test(name)||src.href===dst.href||src.pathname===dst.pathname||src.hostname!==dst.hostname||src.port!==dst.port)throw new Error('Restore requires a separate ai_os_restore_* database on this dedicated OS database server.');
if(path.basename(file)!==file)throw new Error('Backup filename only; no arbitrary path.');
const client=await db();const record=await client.backup.findFirstOrThrow({where:{file},orderBy:{createdAt:'desc'}});
const bytes=await readFile(path.join(process.env.BACKUP_DIR||path.join(config().dataDir,'backups'),file));if(backupHash(bytes)!==record.hash)throw new Error('Encrypted backup hash mismatch');
const metadata=JSON.parse(await readFile(path.join(process.env.BACKUP_DIR||path.join(config().dataDir,'backups'),file+'.json'),'utf8')) as {counts:Record<string,number>};
const recovered=unpackRecovery(decryptBackup(bytes,process.env.BACKUP_SECRET||'')),archive=recovered.database;
const filesRoot=path.join(process.env.BACKUP_DIR||path.join(config().dataDir,'backups'),name+'-files');
const admin=new Client({connectionString:source});await admin.connect();const existing=await admin.query('SELECT datname FROM pg_database WHERE datname=$1',[name]);if(existing.rows.length)throw new Error('Restore target already exists. Choose a fresh target; this script never overwrites a database.');
await admin.query(`CREATE DATABASE "${name}"`);await admin.end();
await postgresProcess(process.env.PG_RESTORE_BINARY||'pg_restore',['--no-owner','--no-acl','--exit-on-error','--dbname',name],target,archive);
const verify=new Client({connectionString:target});await verify.connect();const tables=await verify.query('SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema=$1',['public']);const opportunities=await verify.query('SELECT COUNT(*)::int AS count FROM "Opportunity"');const profiles=await verify.query('SELECT COUNT(*)::int AS count FROM "Profile"');for(const [table,count] of Object.entries(metadata.counts)){if(!/^[_a-zA-Z0-9]+$/.test(table))throw new Error('Invalid table identifier');const actual=(await verify.query(`SELECT COUNT(*)::int AS count FROM "${table}"`)).rows[0].count;if(actual!==count)throw new Error(`Restore row-count mismatch for ${table}`);}await verify.end();
if(tables.rows[0].count!==Object.keys(metadata.counts).length)throw new Error('Restore table verification failed');
await mkdir(path.join(filesRoot,'attachments'),{recursive:true,mode:0o700});for(const f of recovered.files)await writeFile(path.join(filesRoot,'attachments',f.storageKey),f.bytes,{mode:0o600,flag:'wx'});
if(process.platform==='linux'&&process.getuid?.()===0){await chown(filesRoot,10001,10001);await chown(path.join(filesRoot,'attachments'),10001,10001);for(const f of recovered.files)await chown(path.join(filesRoot,'attachments',f.storageKey),10001,10001);}
const filesCheck=new Client({connectionString:target});await filesCheck.connect();const expected=(await filesCheck.query('SELECT "storageKey", "hash", "size" FROM "Attachment"')).rows;await filesCheck.end();if(expected.length!==recovered.files.length)throw new Error('Full restore requires every recorded attachment');for(const f of expected){if(!/^[a-f0-9-]{36}$/i.test(f.storageKey))throw new Error('Invalid restored attachment key');const bytes=await readFile(path.join(filesRoot,'attachments',f.storageKey));if(bytes.length!==f.size||hash(bytes.toString('base64'))!==f.hash)throw new Error('Restored attachment mismatch');}
await client.backup.update({where:{id:record.id},data:{verifiedAt:new Date()}});await audit(client,'backup.restore_verified','backup',record.id,{database:name,tables:tables.rows[0].count,opportunities:opportunities.rows[0].count,profiles:profiles.rows[0].count});console.log(JSON.stringify({restoredTo:name,tables:tables.rows[0].count,rowCountsChecked:Object.keys(metadata.counts).length,opportunities:opportunities.rows[0].count,profiles:profiles.rows[0].count,verified:true}));await client.$disconnect();
