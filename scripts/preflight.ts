import 'dotenv/config';
import { config } from '../lib/config';
import { oauthReady } from '../lib/google';
import { spawnSync } from 'node:child_process';
import { isolatedEnvironment } from '../lib/jobs';
const cfg=config();const login=spawnSync(process.env.AI_CODEX_BINARY||'codex',['login','status'],{env:isolatedEnvironment(),windowsHide:true,timeout:10_000,encoding:'utf8'});
console.log(JSON.stringify({mode:cfg.demo?'demo':'live',dedicatedPostgres:!!process.env.DATABASE_URL,ownerConfigured:!!cfg.owner,googleOAuth:oauthReady(),sessionKey:(process.env.SESSION_SECRET?.length||0)>=32,integrationToken:(process.env.INTEGRATION_TOKEN?.length||0)>=32,codexChatGPT:login.status===0&&/ChatGPT/i.test(login.stdout+login.stderr),model:cfg.model,reasoning:cfg.reasoning,aiEnabled:cfg.aiEnabled,mailEnabled:cfg.mailEnabled,schedulerEnabled:cfg.scheduler,encryptedBackupKey:(process.env.BACKUP_SECRET?.length||0)>=32},null,2));
