param(
  [string]$Vault='C:\Users\demo\Desktop\Business\Brain\Main',
  [string]$SshTarget='root@127.0.0.1',
  [string]$StatusDirectory=(Join-Path $PSScriptRoot '..\..\..\work\obsidian-context-sync')
)
$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot 'Sync-ObsidianContext.ps1'
$vaultPath=[System.IO.Path]::GetFullPath($Vault)
$statusPath=[System.IO.Path]::GetFullPath($StatusDirectory)
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$' -or $vaultPath.Contains('"') -or $scriptPath.Contains('"') -or $statusPath.Contains('"')) { throw 'Invalid task arguments.' }
$shellPath=(Get-Command pwsh -ErrorAction Stop).Source
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$scriptPath+'" -Vault "'+$vaultPath+'" -SshTarget "'+$SshTarget+'" -StatusDirectory "'+$statusPath+'"'
$action=New-ScheduledTaskAction -Execute $shellPath -Argument $arguments
$triggers=@((New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)),(New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)))
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Personal AI OS - Obsidian Kontext Sync' -Action $action -Trigger $triggers -Principal $principal -Settings $settings -Description 'Selected Obsidian notes to Hermes; sourced conversation insights back to two managed vault folders. No mail or model calls.' -Force | Select-Object TaskName,State
