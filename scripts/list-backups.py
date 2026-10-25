import json,pathlib,sys
installation=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/srv/personal-ai-os').resolve()
if str(installation) not in ('/srv/personal-ai-os','/srv/personal-ai-os-live'):
    raise SystemExit('Unexpected backup installation')
root=installation/'private'/'backups'
records=[]
for file in sorted(root.glob('*.aios.enc.json'))[-7:]:
    record=json.loads(file.read_text())
    records.append({key:record[key] for key in ('file','hash','size')})
print(json.dumps(records))
