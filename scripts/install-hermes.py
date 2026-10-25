"""Run on VPS via SSH. Secrets are generated there and never printed."""
from pathlib import Path
import os, secrets, subprocess, shutil

root=Path('/srv/personal-assistant')
root.mkdir(mode=0o700,parents=True,exist_ok=True)
state=root/'state';state.mkdir(mode=0o700,exist_ok=True)
source=Path('/srv/personal-ai-os-live/integrations/hermes')
for name in ['config.yaml','AGENTS.md']:
    shutil.copy2(source/name,state/name)
    os.chown(state/name,10000,10000);os.chmod(state/name,0o600)
shutil.copy2(source/'compose.yaml',root/'compose.yaml')
env=root/'.env'
if not env.exists():
    env.write_text('ASSISTANT_TOKEN='+secrets.token_urlsafe(48)+'\nAPI_SERVER_KEY='+secrets.token_urlsafe(48)+'\nAPI_SERVER_HOST=0.0.0.0\nHERMES_UID=10000\nHERMES_GID=10000\n',encoding='utf-8')
os.chmod(env,0o600);os.chown(state,10000,10000)
subprocess.run(['docker','compose','-f',str(root/'compose.yaml'),'up','-d'],cwd=root,check=True)
print('Hermes installed on private Docker network; no public port.')
