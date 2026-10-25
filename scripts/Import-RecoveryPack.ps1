param([Parameter(Mandatory)][string]$File,[Parameter(Mandatory)][string]$Destination)
$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$pack=[IO.File]::ReadAllBytes([IO.Path]::GetFullPath($File))
if($pack.Length-lt 53-or $pack.Length-gt 2097152-or [Text.Encoding]::ASCII.GetString($pack,0,8)-ne 'AIOSKEY1'){throw 'Invalid portable recovery pack.'}
$secure=Read-Host 'Wiederherstellungspasswort' -AsSecureString;$pointer=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try{$password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer);$key=[Security.Cryptography.Rfc2898DeriveBytes]::Pbkdf2($password,[byte[]]$pack[8..23],600000,[Security.Cryptography.HashAlgorithmName]::SHA256,32);$plain=[byte[]]::new($pack.Length-52)
  $aes=[Security.Cryptography.AesGcm]::new($key,16);try{$aes.Decrypt([byte[]]$pack[24..35],[byte[]]$pack[52..($pack.Length-1)],[byte[]]$pack[36..51],$plain)}finally{$aes.Dispose()}
  $records=@([Text.Encoding]::UTF8.GetString($plain)|ConvertFrom-Json);$root=[IO.Path]::GetFullPath($Destination);New-Item -ItemType Directory -Path $root -Force|Out-Null
  foreach($record in $records){if($record.name-notmatch '^(assistant-recovery-key|recovery-key|server-config)-[a-f0-9]{12}\.dpapi$'){throw 'Invalid recovery filename.'};$target=Join-Path $root $record.name;if(Test-Path -LiteralPath $target){throw 'Recovery destination exists; select a new empty directory.'}}
  foreach($record in $records){$bytes=[Convert]::FromBase64String($record.data);try{$protected=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);$stream=[IO.File]::Open((Join-Path $root $record.name),[IO.FileMode]::CreateNew);try{$stream.Write($protected,0,$protected.Length)}finally{$stream.Dispose()}}finally{[Array]::Clear($bytes,0,$bytes.Length)}}
  Write-Output ('Recovered '+$records.Count+' entries into this Windows profile. No plaintext credentials were written.')
}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer);$password=$null;$records=$null;foreach($buffer in @($key,$plain)){if($buffer){[Array]::Clear($buffer,0,$buffer.Length)}};$secure.Dispose()}
