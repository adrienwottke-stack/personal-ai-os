"""SSH-only bounded conversation-context export/receipt. Prints content only to the SSH pipe."""
from pathlib import Path
import fcntl,json,subprocess,sys
ROOT=Path('/srv/personal-ai-os-live')
def main():
    request=json.loads(sys.stdin.buffer.read(4097).decode('utf-8-sig'))
    if set(request)-{'action','after','written','unchanged','conflicts'}:raise ValueError('Unexpected transfer fields')
    lock=(ROOT/'private/conversation-context-transfer.lock').open('w')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if request.get('action')=='export':
        script='export-conversation-context.ts'
        payload={'after':request.get('after')}
    elif request.get('action')=='receipt':
        script='receipt-conversation-context.ts'
        payload={key:request.get(key) for key in ['written','unchanged','conflicts']}
        if any(type(v) is not int or v<0 or v>10000 for v in payload.values()):raise ValueError('Invalid receipt')
    else:raise ValueError('Invalid action')
    target='/app/scripts/'+script
    subprocess.run(['docker','cp',str(ROOT/'scripts'/script),'personal-ai-os-live-worker-1:'+target],check=True,stdout=subprocess.DEVNULL)
    result=subprocess.run(['docker','exec','-i','-w','/app','personal-ai-os-live-worker-1','node','--import','tsx','scripts/'+script],input=json.dumps(payload).encode(),capture_output=True,check=True,timeout=45)
    data=json.loads(result.stdout)
    print(json.dumps(data,ensure_ascii=False))
if __name__=='__main__':
    try:main()
    except Exception:
        print('Conversation context transfer failed; no successful receipt.',file=sys.stderr);sys.exit(1)
