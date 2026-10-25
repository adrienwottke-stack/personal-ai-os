"""Encrypted Hermes recovery, including coherent SQLite snapshots. No secrets in diagnostics."""
from pathlib import Path
import argparse, base64, datetime, hashlib, io, json, os, sqlite3, tarfile, tempfile
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path('/srv/personal-assistant')
MAGIC = b'HERMESB1'

def files():
    for path in sorted((ROOT/'state').rglob('*')):
        if path.is_file() and not path.is_symlink():
            relative = path.relative_to(ROOT).as_posix()
            if '/cache/' in relative or '/logs/' in relative or relative.endswith(('-wal','-shm','.lock','.pid')) or path.name in ('gateway.lock','gateway_state.json') or relative.startswith('state/state/gateway.'):
                continue
            yield path, relative
    for name in ('.env','compose.yaml'):
        yield ROOT/name, name

def private_key():
    keyfile=ROOT/'backup.key'
    if not keyfile.exists():
        with keyfile.open('xb') as target:target.write(os.urandom(32))
        os.chmod(keyfile,0o600)
    key=keyfile.read_bytes()
    if len(key)!=32:raise RuntimeError('Invalid recovery key')
    return key

def backups():
    directory=ROOT/'backups';directory.mkdir(mode=0o700,exist_ok=True)
    for metadata in sorted(directory.glob('hermes-*.enc.json')):
        record=json.loads(metadata.read_text())
        path=directory/record['file']
        if path.parent!=directory or not path.is_file():raise RuntimeError('Invalid backup record')
        if record['hash']!=hashlib.sha256(path.read_bytes()).hexdigest():raise RuntimeError('Backup checksum mismatch')
        yield record

def create():
    key=private_key();buffer=io.BytesIO();counts={}
    with tempfile.TemporaryDirectory(dir=ROOT) as temporary, tarfile.open(fileobj=buffer,mode='w:gz') as archive:
        for path,name in files():
            source=path
            if path.suffix in ('.db','.sqlite','.sqlite3'):
                source=Path(temporary)/hashlib.sha256(name.encode()).hexdigest()
                with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as incoming, sqlite3.connect(source) as copy:
                    incoming.backup(copy)
                    if copy.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('SQLite recovery check failed')
            content=source.read_bytes()
            info=tarfile.TarInfo(name);info.size=len(content);info.mode=0o600;info.uid=info.gid=10000
            archive.addfile(info,io.BytesIO(content));counts[name]=hashlib.sha256(content).hexdigest()
    plaintext=buffer.getvalue();nonce=os.urandom(12)
    encrypted=MAGIC+nonce+AESGCM(key).encrypt(nonce,plaintext,MAGIC)
    # Verify decryption and every archive entry before retaining the encrypted file.
    decoded=AESGCM(key).decrypt(nonce,encrypted[20:],MAGIC)
    with tarfile.open(fileobj=io.BytesIO(decoded)) as archive:
        actual={member.name:hashlib.sha256(archive.extractfile(member).read()).hexdigest() for member in archive.getmembers() if member.isfile()}
    if actual!=counts:raise RuntimeError('Encrypted recovery roundtrip failed')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    name='hermes-'+stamp+'.enc';directory=ROOT/'backups';directory.mkdir(mode=0o700,exist_ok=True)
    target=directory/name;target.write_bytes(encrypted);os.chmod(target,0o600)
    record={'file':name,'hash':hashlib.sha256(encrypted).hexdigest(),'size':len(encrypted),'files':len(counts),'encrypted':True,'roundtripVerified':True}
    metadata=directory/(name+'.json');metadata.write_text(json.dumps(record));os.chmod(metadata,0o600)
    print(json.dumps(record))

parser=argparse.ArgumentParser();parser.add_argument('--list',action='store_true');parser.add_argument('--recovery-key',action='store_true');args=parser.parse_args()
if args.recovery_key:print(base64.b64encode(private_key()).decode())
elif args.list:print(json.dumps(list(backups())))
else:create()
