param(
  [string]$SshTarget='root@127.0.0.1',
  [string]$Destination=(Join-Path $PSScriptRoot '..\..\..\work\backup-cache'),
  [ValidateSet('/srv/personal-ai-os','/srv/personal-ai-os-live')][string]$RemoteRoot='/srv/personal-ai-os',
  [ValidateSet('personal-ai-os','personal-ai-os-live')][string]$ComposeProject='personal-ai-os',
  [ValidateSet('.env','.env.live')][string]$EnvironmentFile='.env',
  [string]$TaskName='Personal AI OS - Encrypted Backup Sync'
)
$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot 'Sync-Backups.ps1'
$destinationPath=[System.IO.Path]::GetFullPath($Destination)
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$' -or $destinationPath.Contains('"') -or $scriptPath.Contains('"')) { throw 'Invalid scheduler arguments.' }
if ($TaskName -notmatch '^Personal AI OS(?: Live)? - Encrypted Backup Sync$') { throw 'Invalid backup task name.' }
if (($RemoteRoot -eq '/srv/personal-ai-os-live') -ne ($ComposeProject -eq 'personal-ai-os-live') -or ($ComposeProject -eq 'personal-ai-os-live') -ne ($EnvironmentFile -eq '.env.live')) { throw 'Backup root, project and environment must identify the same installation.' }
$shellPath=(Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $shellPath) { $shellPath=(Get-Command powershell).Source }
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$scriptPath+'" -SshTarget "'+$SshTarget+'" -Destination "'+$destinationPath+'" -RemoteRoot "'+$RemoteRoot+'" -ComposeProject "'+$ComposeProject+'" -EnvironmentFile "'+$EnvironmentFile+'"'
$action=New-ScheduledTaskAction -Execute $shellPath -Argument $arguments
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Copy and verify encrypted AI OS backups while this user is signed in. No mail or AI calls.' -Force | Select-Object TaskName,State
