"""Install a downloaded Google web OAuth client without printing credentials."""
import datetime
import json
import os
import pathlib
import re
import subprocess
import sys

root = pathlib.Path('/srv/personal-ai-os-live').resolve()
environment = root / '.env.live'
payload = root / 'private' / 'google-oauth-client.json'
if root != pathlib.Path('/srv/personal-ai-os-live') or not environment.is_file():
    raise SystemExit('The dedicated live installation must exist first.')
if environment.stat().st_mode & 0o077:
    raise SystemExit('The live environment must be private (0600).')
values = dict(line.split('=', 1) for line in environment.read_text().splitlines() if '=' in line and not line.startswith('#'))
try:
    web = json.loads(payload.read_text()).get('web', {})
except (OSError, json.JSONDecodeError):
    raise SystemExit('A private downloaded web OAuth client JSON is required.') from None
identifier = web.get('client_id', '')
secret = web.get('client_secret', '')
callback = values['APP_URL'].rstrip('/') + '/api/auth/callback'
if not isinstance(identifier, str) or not re.fullmatch(r'[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com', identifier):
    raise SystemExit('A Google web OAuth client identifier is required.')
if not isinstance(secret, str) or len(secret) < 20 or any(character in secret for character in '\r\n'):
    raise SystemExit('A valid client secret is required.')
if callback not in web.get('redirect_uris', []):
    raise SystemExit('The downloaded client must authorize the exact live /api/auth/callback URL.')
if values.get('GOOGLE_CLIENT_ID') and values['GOOGLE_CLIENT_ID'] != identifier:
    raise SystemExit('An existing different Google client needs explicit review before replacement.')
values.update({'GOOGLE_CLIENT_ID': identifier, 'GOOGLE_CLIENT_SECRET': secret})
temporary = root / 'private' / ('google-env-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S') + '.tmp')
descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(descriptor, 'w') as output:
    output.write('\n'.join(key + '=' + value for key, value in values.items()) + '\n')
os.replace(temporary, environment)
payload.unlink()
result = subprocess.run(['docker', 'compose', '--env-file', '.env.live', '-p', 'personal-ai-os-live', 'up', '-d', '--force-recreate', 'app'], cwd=root, capture_output=True, text=True, timeout=90)
if result.returncode:
    raise SystemExit('Google client installed privately; the live app restart needs attention.')
print(json.dumps({'googleClientInstalled': True, 'callback': callback, 'privateCredentials': True, 'ownerLogin': 'pending', 'gmailAuthorization': 'pending', 'calendarAuthorization': 'pending'}))
