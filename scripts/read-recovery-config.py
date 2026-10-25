import pathlib, sys
root=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/srv/personal-ai-os').resolve()
environment=sys.argv[2] if len(sys.argv)>2 else '.env'
if (str(root),environment) not in (('/srv/personal-ai-os','.env'),('/srv/personal-ai-os-live','.env.live')):
    raise SystemExit('Unexpected recovery installation')
print((root/environment).read_text(),end='')
