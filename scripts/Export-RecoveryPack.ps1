param(
  [string[]]$Sources=@('C:\Users\demo\Documents\Codex\2026-10-10\nim\work\backup-cache-live','C:\Users\demo\Documents\Codex\2026-10-11\ich-m-chte-ich-will-jetzt\work\assistant-backup-cache'),
  [string]$Destination='C:\Users\demo\Documents\Codex\2026-10-10\nim\work\backup-cache-live\portable-recovery.enc'
)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$records=@();foreach($source in $Sources){foreach($file in Get-ChildItem -LiteralPath $source -Filter '*.dpapi' -File){
  if($file.Name -notmatch '^(assistant-recovery-key|recovery-key|server-config)-[a-f0-9]{12}\.dpapi$'){throw 'Unexpected recovery filename.'}
  $bytes=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($file.FullName),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $records+=@{name=$file.Name;data=[Convert]::ToBase64String($bytes)};[Array]::Clear($bytes,0,$bytes.Length)
}}
if(-not $records.Count){throw 'No protected recovery material found.'}
if(Test-Path -LiteralPath $Destination){throw 'Destination already exists. Choose a new file; never overwrite your recovery pack.'}
$secure=Read-Host 'Eigenes starkes Wiederherstellungspasswort (getrennt vom Archiv aufbewahren)' -AsSecureString
$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);if($password.Length-lt 16){throw 'Use at least 16 characters.'}
  $salt=[Security.Cryptography.RandomNumberGenerator]::GetBytes(16);$iv=[Security.Cryptography.RandomNumberGenerator]::GetBytes(12)
  $key=[Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($password,$salt,600000,[Security.Cryptography.HashAlgorithmName]::SHA256,32)
  $plain=[Text.Encoding]::UTF8.GetBytes((ConvertTo-Json -InputObject @($records) -Depth 4 -Compress));$cipher=[byte[]]::new($plain.Length);$tag=[byte[]]::new(16)
  $aes=[Security.Cryptography.AesGcm]::new($key,16);try{$aes.Encrypt($iv,$plain,$cipher,$tag);$check=[byte[]]::new($plain.Length);$aes.Decrypt($iv,$cipher,$tag,$check);if(-not [Security.Cryptography.CryptographicOperations]::FixedTimeEquals($plain,$check)){throw 'Recovery pack round trip failed.'}}finally{$aes.Dispose()}
  [byte[]]$payload=[Text.Encoding]::ASCII.GetBytes('AIOSKEY1')+$salt+$iv+$tag+$cipher
  $path=[IO.Path]::GetFullPath($Destination);$stream=[IO.File]::Open($path,[IO.FileMode]::CreateNew);try{$stream.Write($payload,0,$payload.Length)}finally{$stream.Dispose()}
  Write-Output ('Portable encrypted recovery pack created; '+$records.Count+' entries, encryption round trip verified.')
}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$password=$null;$records=$null;foreach($buffer in @($key,$plain,$check)){if($buffer){[Array]::Clear($buffer,0,$buffer.Length)}};$secure.Dispose()}
