param(
  [string]$SshTarget='root@127.0.0.1',
  [string]$Destination=(Join-Path $PSScriptRoot '..\..\..\work\assistant-backup-cache')
)
$ErrorActionPreference='Stop'
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$') { throw 'Invalid SSH target.' }
$destinationPath=[System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $destinationPath -Force | Out-Null
$remoteScript='/srv/personal-ai-os-live/integrations/hermes/backup.py'
# Capture directly into memory; never echo private recovery material.
$recoveryKey=(& ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget ('python3 '+$remoteScript+' --recovery-key') | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $recoveryKey.Length -ne 44) { throw 'Assistant recovery key unavailable.' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$keyBytes=[System.Text.Encoding]::UTF8.GetBytes($recoveryKey)
$keyHash=[System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData($keyBytes)).Substring(0,12).ToLowerInvariant()
$keyFile=Join-Path $destinationPath ('assistant-recovery-key-'+$keyHash+'.dpapi')
if (-not (Test-Path -LiteralPath $keyFile)) { [System.IO.File]::WriteAllBytes($keyFile,[System.Security.Cryptography.ProtectedData]::Protect($keyBytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)) }
$verified=[System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($keyFile),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
if ([System.Convert]::ToBase64String($verified) -ne [System.Convert]::ToBase64String($keyBytes)) { throw 'Protected assistant key readback failed.' }
$recoveryKey=$null
[System.Array]::Clear($keyBytes,0,$keyBytes.Length)
[System.Array]::Clear($verified,0,$verified.Length)
$listing=& ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget ('python3 '+$remoteScript+' --list')
if ($LASTEXITCODE -ne 0) { throw 'Assistant backup listing unavailable.' }
$records=@($listing | ConvertFrom-Json)
foreach ($record in $records) {
  if ($record.file -notmatch '^hermes-[0-9TZ]+\.enc$' -or $record.hash -notmatch '^[a-f0-9]{64}$' -or -not $record.roundtripVerified) { throw 'Invalid assistant backup metadata.' }
  $target=[System.IO.Path]::GetFullPath((Join-Path $destinationPath $record.file))
  if (-not $target.StartsWith($destinationPath+[System.IO.Path]::DirectorySeparatorChar,[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Assistant backup escaped destination.' }
  if (-not (Test-Path -LiteralPath $target)) {
    $temporary=$target+'.download'
    & scp -q -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 ($SshTarget+':/srv/personal-assistant/backups/'+$record.file) $temporary
    if ($LASTEXITCODE -ne 0) { throw 'Encrypted assistant backup download failed.' }
    if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.hash) { throw 'Assistant backup download checksum mismatch.' }
    Move-Item -LiteralPath $temporary -Destination $target
  }
  if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.hash) { throw 'Local assistant backup checksum mismatch.' }
  $record | ConvertTo-Json | Set-Content -LiteralPath ($target+'.json') -Encoding utf8
}
@{checkedAt=(Get-Date).ToUniversalTime().ToString('o');copies=$records.Count;encrypted=$true;keyReadbackVerified=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $destinationPath 'sync-status.json') -Encoding utf8
Write-Output "Encrypted assistant backups verified locally: $($records.Count)"
