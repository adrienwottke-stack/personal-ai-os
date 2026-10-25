param([Parameter(Mandatory=$true)][string]$File,[Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$sourcePath=[System.IO.Path]::GetFullPath($File)
$destinationPath=[System.IO.Path]::GetFullPath($Destination)
if (Test-Path -LiteralPath $destinationPath) { throw 'Destination exists. Choose a new private file; nothing is overwritten.' }
if (-not (Test-Path -LiteralPath ([System.IO.Path]::GetDirectoryName($destinationPath)) -PathType Container)) { throw 'Create the intended private destination directory first.' }
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$decrypted=[System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($sourcePath),$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)
try {
  $stream=[System.IO.File]::Open($destinationPath,[System.IO.FileMode]::CreateNew,[System.IO.FileAccess]::Write,[System.IO.FileShare]::None)
  try { $stream.Write($decrypted,0,$decrypted.Length) } finally { $stream.Dispose() }
} finally { [System.Array]::Clear($decrypted,0,$decrypted.Length) }
Write-Output 'Private recovery file written. Its contents were not printed.'
