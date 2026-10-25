param([string]$Destination=(Join-Path $PSScriptRoot '..\..\..\work\assistant-backup-cache'))
$ErrorActionPreference='Stop'
$scriptPath=Join-Path $PSScriptRoot 'Sync-AssistantBackup.ps1'
$destinationPath=[System.IO.Path]::GetFullPath($Destination)
if ($destinationPath.Contains('"') -or $scriptPath.Contains('"')) { throw 'Invalid assistant scheduler arguments.' }
$shellPath=(Get-Command pwsh -ErrorAction Stop).Source
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$scriptPath+'" -Destination "'+$destinationPath+'"'
$action=New-ScheduledTaskAction -Execute $shellPath -Argument $arguments
$trigger=New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) -RepetitionInterval (New-TimeSpan -Hours 1)
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'Personal AI OS Live - Encrypted Assistant Backup Sync' -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Verify and copy encrypted Hermes backups while the owner is signed in.' -Force | Select-Object TaskName,State
