param(
  [string]$Vault='C:\Users\demo\Desktop\Business\Brain\Main',
  [string]$SshTarget='root@127.0.0.1',
  [string]$StatusDirectory=(Join-Path $PSScriptRoot '..\..\..\work\obsidian-context-sync'),
  [switch]$Preview
)
$ErrorActionPreference='Stop'
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\integrations\obsidian\allowlist.json') -Raw | ConvertFrom-Json
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$') { throw 'Invalid SSH target.' }
$vaultPath=[System.IO.Path]::GetFullPath($Vault).TrimEnd('\')
if (-not (Test-Path -LiteralPath $vaultPath -PathType Container)) { throw 'Obsidian vault unavailable; no snapshot sent.' }
$notes=@(); $excluded=@(); $totalBytes=0
foreach ($relative in $manifest.notes) {
  if ($relative -notmatch '^(Kontext|Projekte|Studium|Wissenspflege)/[^:]+\.md$' -or $relative -match '(^|/)\.\.?(/|$)|(^|/)Privat(/|$)') { throw 'Invalid allowlisted note.' }
  $notePath=[System.IO.Path]::GetFullPath((Join-Path $vaultPath $relative))
  if (-not $notePath.StartsWith($vaultPath+'\',[System.StringComparison]::OrdinalIgnoreCase)) { throw 'Note escaped the vault.' }
  if (-not (Test-Path -LiteralPath $notePath -PathType Leaf)) { $excluded+=@{path=$relative;reason='missing'}; continue }
  $item=Get-Item -LiteralPath $notePath
  $cursor=$item; $linked=$false
  while ($cursor -and $cursor.FullName.Length -ge $vaultPath.Length) {
    if ($cursor.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { $linked=$true; break }
    $cursor=if ($cursor -is [System.IO.FileInfo]) { $cursor.Directory } else { $cursor.Parent }
  }
  if ($linked -or $item.Length -gt 65536) { $excluded+=@{path=$relative;reason='linked_or_oversized'}; continue }
  $bytes=[System.IO.File]::ReadAllBytes($notePath)
  $strictUtf8=[System.Text.UTF8Encoding]::new($false,$true)
  $content=$strictUtf8.GetString($bytes).TrimStart([char]0xFEFF)
  if ($content -match '(?im)^sensitivity:\s*["'']?(privat|private|confidential)\b') { $excluded+=@{path=$relative;reason='private'}; continue }
  if ($content -match '(?i)-----BEGIN[^\r\n]*PRIVATE KEY-----|\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}|\bGOCSPX-[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{24,}|(?:api[_-]?key|client[_-]?secret|password|authorization|access[_-]?token|refresh[_-]?token|session[_-]?secret)\s*[:=]\s*["'']?[A-Za-z0-9_+/=-]{20,}') { $excluded+=@{path=$relative;reason='possible_secret'}; continue }
  # Detect edits during the read; never send a mixed snapshot of one file.
  $digest=[System.Convert]::ToHexString([System.Security.Cryptography.SHA256]::HashData([System.Text.Encoding]::UTF8.GetBytes($content))).ToLowerInvariant()
  $readBack=[System.IO.File]::ReadAllText($notePath,$strictUtf8).TrimStart([char]0xFEFF)
  if ($readBack -cne $content) { throw 'A selected note changed during reading; retry on the next sync.' }
  $notes+=@{path=$relative;content=$content;hash=$digest;modifiedAt=$item.LastWriteTimeUtc.ToString('o')}
  $totalBytes+=[System.Text.Encoding]::UTF8.GetByteCount($content)
}
if ($totalBytes -gt 262144) { throw 'Selected context exceeds 256 KiB.' }
$payload=@{version=1;capturedAt=(Get-Date).ToUniversalTime().ToString('o');notes=@($notes);excluded=@($excluded)}
if ($Preview) {
  @{preview=$true;notes=@($notes|ForEach-Object {@{path=$_.path;bytes=[System.Text.Encoding]::UTF8.GetByteCount($_.content);hash=$_.hash}});excluded=@($excluded);bytes=$totalBytes} | ConvertTo-Json -Depth 6
  return
}
$previousEncoding=$OutputEncoding
try {
  $OutputEncoding=[System.Text.UTF8Encoding]::new($false)
  $response=($payload | ConvertTo-Json -Depth 7 -Compress) | & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget 'python3 /srv/personal-ai-os-live/scripts/import-obsidian.py'
  if ($LASTEXITCODE -ne 0) { throw 'Obsidian context sync did not complete; no successful sync recorded.' }
  $report=$response | ConvertFrom-Json
  if (-not $report.completed -or $report.noteCount -ne $notes.Count) { throw 'Server did not confirm the complete selected snapshot.' }
} finally { $OutputEncoding=$previousEncoding }
$statusPath=[System.IO.Path]::GetFullPath($StatusDirectory)
New-Item -ItemType Directory -Path $statusPath -Force | Out-Null
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $statusPath 'last-success.json') -Encoding utf8
$report | ConvertTo-Json -Depth 8
& (Join-Path $PSScriptRoot 'Sync-HermesContext.ps1') -Vault $Vault -SshTarget $SshTarget -StatusDirectory (Join-Path $statusPath 'hermes-return')
