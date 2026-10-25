param(
  [string]$SshTarget='root@127.0.0.1',
  [string]$Destination=(Join-Path $PSScriptRoot '..\..\..\work\backup-cache'),
  [ValidateSet('/srv/personal-ai-os','/srv/personal-ai-os-live')][string]$RemoteRoot='/srv/personal-ai-os',
  [ValidateSet('personal-ai-os','personal-ai-os-live')][string]$ComposeProject='personal-ai-os',
  [ValidateSet('.env','.env.live')][string]$EnvironmentFile='.env'
)
$ErrorActionPreference='Stop'
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$') { throw 'Invalid SSH target.' }
if (($RemoteRoot -eq '/srv/personal-ai-os-live') -ne ($ComposeProject -eq 'personal-ai-os-live') -or ($ComposeProject -eq 'personal-ai-os-live') -ne ($EnvironmentFile -eq '.env.live')) { throw 'Backup root, project and environment must identify the same installation.' }
$destinationPath=[System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$recoveryKey=(& ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget ('python3 '+$RemoteRoot+'/scripts/read-backup-key.py '+$RemoteRoot+' '+$EnvironmentFile) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $recoveryKey.Length -lt 32) { throw 'Backup recovery key could not be secured locally.' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$keyBytes=[System.Text.Encoding]::UTF8.GetBytes($recoveryKey)
$keyHash=[System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($keyBytes)).Substring(0,12).ToLowerInvariant()
$keyFile=Join-Path $destinationPath ('recovery-key-'+$keyHash+'.dpapi')
if (-not (Test-Path -LiteralPath $keyFile)) { [System.IO.File]::WriteAllBytes($keyFile,[System.Security.Cryptography.ProtectedData]::Protect($keyBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)) }
$recoveryKey=$null
[System.Array]::Clear($keyBytes,0,$keyBytes.Length)
$recoveryConfiguration=(& ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget ('python3 '+$RemoteRoot+'/scripts/read-recovery-config.py '+$RemoteRoot+' '+$EnvironmentFile) | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $recoveryConfiguration.Length -lt 100) { throw 'Private server recovery configuration could not be secured locally.' }
$configurationBytes=[System.Text.Encoding]::UTF8.GetBytes($recoveryConfiguration)
$configurationHash=[System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($configurationBytes)).Substring(0,12).ToLowerInvariant()
$configurationFile=Join-Path $destinationPath ('server-config-'+$configurationHash+'.dpapi')
if (-not (Test-Path -LiteralPath $configurationFile)) { [System.IO.File]::WriteAllBytes($configurationFile,[System.Security.Cryptography.ProtectedData]::Protect($configurationBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)) }
$recoveryConfiguration=$null
[System.Array]::Clear($configurationBytes,0,$configurationBytes.Length)
$listing=& ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget ('python3 '+$RemoteRoot+'/scripts/list-backups.py '+$RemoteRoot)
if ($LASTEXITCODE -ne 0) { throw 'Backup server unavailable; the next run will try again.' }
$records=@($listing | ConvertFrom-Json)
foreach ($record in $records) {
  if ($record.file -notmatch '^ai-os-[\w-]+\.aios\.enc$' -or $record.hash -notmatch '^[a-f0-9]{64}$') { throw 'Invalid backup metadata.' }
  $target=[System.IO.Path]::GetFullPath((Join-Path $destinationPath $record.file))
  if (-not $target.StartsWith($destinationPath+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Destination escaped backup directory.' }
  if (-not (Test-Path -LiteralPath $target)) {
    $temporary=$target+'.download'
    & scp -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 ($SshTarget+':'+$RemoteRoot+'/private/backups/'+$record.file) $temporary
    if ($LASTEXITCODE -ne 0) { throw 'Encrypted backup download failed.' }
    if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.hash) { throw 'Backup checksum mismatch; incomplete file retained for inspection.' }
    Move-Item -LiteralPath $temporary -Destination $target
  }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.hash) { throw 'Local backup checksum mismatch.' }
  $metadataTarget=$target+'.json'
  $metadataTemporary=$metadataTarget+'.download'
  & scp -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 ($SshTarget+':'+$RemoteRoot+'/private/backups/'+$record.file+'.json') $metadataTemporary
  if ($LASTEXITCODE -ne 0) { throw 'Backup metadata download failed.' }
  $metadata=Get-Content -LiteralPath $metadataTemporary -Raw | ConvertFrom-Json
  if ($metadata.file -ne $record.file -or $metadata.hash -ne $record.hash -or [long]$metadata.size -ne [long]$record.size -or -not $metadata.counts) { throw 'Backup metadata does not match the encrypted archive.' }
  Move-Item -LiteralPath $metadataTemporary -Destination $metadataTarget -Force
  $remoteCommand='cd '+$RemoteRoot+' && docker compose --env-file '+$EnvironmentFile+' -p '+$ComposeProject+' run --rm --no-deps operations node --import tsx scripts/offsite-ack.ts '+$record.file+' '+$record.hash+' '+([long]$record.size)
  $ack=& ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget $remoteCommand
  if ($LASTEXITCODE -ne 0) { throw 'Backup copied; server acknowledgment is still pending.' }
  Write-Output $ack
}
@{checkedAt=(Get-Date).ToUniversalTime().ToString('o');copies=$records.Count;destination=$destinationPath;remoteRoot=$RemoteRoot;project=$ComposeProject} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destinationPath 'sync-status.json') -Encoding utf8
Write-Output "Encrypted backups verified locally: $($records.Count)"
