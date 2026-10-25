param(
  [Parameter(Mandatory=$true)][string]$ClientFile,
  [string]$SshTarget='root@127.0.0.1'
)
$ErrorActionPreference='Stop'
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$') { throw 'Invalid SSH target.' }
$source=[System.IO.Path]::GetFullPath($ClientFile)
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Downloaded OAuth client JSON not found.' }
$client=Get-Content -LiteralPath $source -Raw | ConvertFrom-Json
if (-not $client.web.client_id -or -not $client.web.client_secret) { throw 'Download a Google web application OAuth client JSON.' }
& scp -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $source ($SshTarget+':/srv/personal-ai-os-live/private/google-oauth-client.json')
if ($LASTEXITCODE -ne 0) { throw 'Private client transfer failed.' }
& ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget 'chmod 600 /srv/personal-ai-os-live/private/google-oauth-client.json && python3 /srv/personal-ai-os-live/scripts/install-google-oauth.py'
if ($LASTEXITCODE -ne 0) { throw 'The Google client could not be installed. No credential values were printed.' }
