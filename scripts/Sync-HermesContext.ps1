param(
  [string]$Vault='C:\Users\demo\Desktop\Business\Brain\Main',
  [string]$SshTarget='root@127.0.0.1',
  [string]$StatusDirectory=(Join-Path $PSScriptRoot '..\..\..\work\hermes-context-sync')
)
$ErrorActionPreference='Stop'
if ($SshTarget -notmatch '^[a-zA-Z0-9_.-]+@[a-zA-Z0-9_.:-]+$') { throw 'Invalid SSH target.' }
$utf8=[System.Text.UTF8Encoding]::new($false,$true)
$vaultPath=[IO.Path]::GetFullPath($Vault).TrimEnd('\')
if (-not (Test-Path -LiteralPath $vaultPath -PathType Container)) { throw 'Vault unavailable; nothing written.' }
function Assert-SafePath([string]$Path) {
  $full=[IO.Path]::GetFullPath($Path)
  if ($full -ne $vaultPath -and -not $full.StartsWith($vaultPath+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Target escaped vault.' }
  $cursor=$full
  while ($cursor.Length -ge $vaultPath.Length) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked vault path refused.' }
    if ($cursor -eq $vaultPath) { break }; $cursor=[IO.Path]::GetDirectoryName($cursor)
  }
}
function Digest([string]$Text) { [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($utf8.GetBytes($Text))).ToLowerInvariant() }
function Escape-Note([string]$Text) { [Net.WebUtility]::HtmlEncode($Text).Replace('[','&#91;').Replace(']','&#93;').Replace('!','&#33;').Replace('`','&#96;') }
function Transfer($Payload) {
  $prior=$OutputEncoding
  try {
    $OutputEncoding=[Text.UTF8Encoding]::new($false)
    $response=($Payload | ConvertTo-Json -Compress) | & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 $SshTarget 'python3 /srv/personal-ai-os-live/scripts/conversation-context-transfer.py'
    if ($LASTEXITCODE -ne 0) { throw 'Hermes return transfer failed.' }
    return ($response | ConvertFrom-Json)
  } finally { $OutputEncoding=$prior }
}
Assert-SafePath $vaultPath
$statusPath=[IO.Path]::GetFullPath($StatusDirectory)
New-Item -ItemType Directory -Path $statusPath -Force | Out-Null
$lock=[IO.File]::Open((Join-Path $statusPath 'sync.lock'),[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try {
  $manifestPath=Join-Path $statusPath 'managed-hashes.json'
  $known=if (Test-Path -LiteralPath $manifestPath) { Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
  $written=0; $unchanged=0; $conflicts=0; $after=$null; $pages=0; $paths=@()
  do {
    $page=Transfer @{action='export';after=$after}
    if ($page.version -ne 1 -or @($page.records).Count -gt 100) { throw 'Invalid return page.' }
    foreach ($row in $page.records) {
      if ($row.id -notmatch '^hermes-context:([a-f0-9]{40})$' -or $row.state -notin @('current','proposed','superseded')) { throw 'Invalid context identity.' }
      $fileId=$Matches[1]; $record=$row.record
      if ($record.version -ne 1 -or $record.topic -notmatch '^[a-z][a-z0-9-]{2,59}$' -or $record.turnId -notmatch '^[a-f0-9-]{36}$' -or $record.quote.Length -gt 600 -or $record.kind -notin @('user_statement','user_preference','proposal')) { throw 'Invalid context record.' }
      $folder=if ($record.kind -eq 'proposal') { '00-Eingang\Hermes-Vorschlaege' } else { 'Kontext\Hermes-Erkenntnisse' }
      $directory=Join-Path $vaultPath $folder
      Assert-SafePath $directory
      New-Item -ItemType Directory -Path $directory -Force | Out-Null
      Assert-SafePath $directory
      $fileName=$record.topic+'--'+$fileId+'.md'
      $path=Join-Path $directory $fileName; Assert-SafePath $path
      $relative=$folder.Replace('\','/')+'/'+$fileName
      $captured=if ($record.capturedAt -is [datetime]) { $record.capturedAt.ToUniversalTime() } else { [datetime]::Parse([string]$record.capturedAt,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime() }
      $capturedAt=$captured.ToString('o'); $date=$captured.ToString('yyyy-MM-dd')
      $label=switch ($row.state) { 'current' {'Aktuelle eigene Nutzerangabe'} 'proposed' {'Unbestätigter Vorschlag; kein gesicherter persönlicher Kontext'} 'superseded' {'Historie; durch eine neuere eigene Angabe abgelöst'} }
      $quote=Escape-Note $record.quote
      $replacement=if ($record.replacesId) { "`nErsetzt Quellenbeleg: $($record.replacesId).`n" } else { '' }
      $body="## Status`n`n$label.`n`n## Wörtliche Quelle`n`n> $($quote.Replace("`n","`n> "))`n`nQuelle: Hermes-Gespräch, Nachricht $($record.turnId), erfasst $capturedAt.`nKennung: $($row.id).$replacement`n`n## Grenze`n`nEigene Gesprächsangabe, keine unabhängig geprüfte Tatsache. Keine vollständige Chatkopie. Automatisch verwalteter Quellenbeleg; eigene Ergänzungen außerhalb der Marker bleiben erhalten.`n"
      $begin='<!-- HERMES CONTEXT START -->'; $end='<!-- HERMES CONTEXT END -->'
      $block=$begin+"`n"+$body+$end
      $digest=Digest $block
      $fresh="---`ntype: chat-learning`ncreated: $date`nupdated: $date`nstatus: quellenbeleg`nbereich: kontext`nsource: '$($record.turnId)'`n---`n`n# $($record.topic)`n`n$block`n`n## Eigene Ergänzungen`n`n"
      $stream=$null
      try {
        $existed=Test-Path -LiteralPath $path
        $stream=[IO.File]::Open($path,[IO.FileMode]::OpenOrCreate,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
        if ($stream.Length -gt 65536) { $conflicts++; continue }
        $bytes=[byte[]]::new($stream.Length); [void]$stream.ReadExactly($bytes,0,$bytes.Length); $old=$utf8.GetString($bytes)
        $found=[regex]::Matches($old,'(?s)<!-- HERMES CONTEXT START -->.*?<!-- HERMES CONTEXT END -->')
        $conflict=$existed -and ($found.Count -ne 1 -or -not $known.ContainsKey($relative) -or (Digest $found[0].Value) -ne $known[$relative])
        if ($conflict) {
          $incoming=Join-Path $directory ($record.topic+'--'+$fileId+'.incoming-'+$digest.Substring(0,12)+'.md'); Assert-SafePath $incoming
          if (-not (Test-Path -LiteralPath $incoming)) { [IO.File]::WriteAllText($incoming,$fresh,$utf8) }
          $conflicts++; continue
        }
        $next=if ($existed) { $old.Substring(0,$found[0].Index)+$block+$old.Substring($found[0].Index+$found[0].Length) } else { $fresh }
        if ($next -ceq $old) { $unchanged++ } else {
          if ($existed) {
            $backup=Join-Path $statusPath 'before-write'; New-Item -ItemType Directory -Path $backup -Force | Out-Null
            [IO.File]::WriteAllBytes((Join-Path $backup ($fileId+'-'+(Digest $old)+'.md')),$bytes)
          }
          $encoded=$utf8.GetBytes($next); $stream.Position=0; $stream.Write($encoded,0,$encoded.Length); $stream.SetLength($encoded.Length); $stream.Flush($true)
          $stream.Position=0; $check=[byte[]]::new($stream.Length); $stream.ReadExactly($check,0,$check.Length)
          if ($utf8.GetString($check) -cne $next) { throw 'Vault write readback failed.' }
          $written++
        }
        $known[$relative]=$digest; $paths+=$relative
        # Persist after each file so interruption cannot invalidate earlier writes.
        $temporary=$manifestPath+'.new'; $known | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $temporary -Encoding utf8
        [IO.File]::Move($temporary,$manifestPath,$true)
      } catch [System.IO.IOException] { $conflicts++ } finally { if ($stream) { $stream.Dispose() } }
    }
    $previous=$after; $after=$page.next; $pages++
    if (($after -and $after -cle $previous) -or $pages -gt 100) { throw 'Invalid or oversized export pagination.' }
  } while ($after)
  $receipt=Transfer @{action='receipt';written=$written;unchanged=$unchanged;conflicts=$conflicts}
  if (-not $receipt.completed) { throw 'Server did not confirm the return receipt.' }
  $report=@{completed=$true;written=$written;unchanged=$unchanged;conflicts=$conflicts;checkedAt=$receipt.checkedAt;paths=$paths}
  $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $statusPath 'last-success.json') -Encoding utf8
  $report | ConvertTo-Json -Depth 6
} finally { $lock.Dispose() }
