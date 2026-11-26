$ErrorActionPreference = 'Stop'
$nativeSource = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../Antigravity-Cat-Widget/src/native/ForegroundHost.cs')).Path
$sha256 = [Security.Cryptography.SHA256]::Create()
$sourceStream = [IO.File]::OpenRead($nativeSource)
try {
    $nativeVersion = [BitConverter]::ToString($sha256.ComputeHash($sourceStream)).Replace('-', '').Substring(0, 12).ToLowerInvariant()
} finally {
    $sourceStream.Dispose()
    $sha256.Dispose()
}
$nativeDirectory = Split-Path -Parent $nativeSource
$nativeOutput = Join-Path $nativeDirectory ('ForegroundHost.' + $nativeVersion + '.exe')
if ([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($nativeOutput)) -ne $nativeDirectory) { throw 'Unexpected native output directory' }
if (Test-Path -LiteralPath $nativeOutput) { Write-Output ('Native helper already built: ' + $nativeOutput); return }
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
& $compiler '/nologo' '/target:exe' '/optimize+' ('/out:' + $nativeOutput) $nativeSource
if ($LASTEXITCODE -ne 0) { throw 'Native helper compilation failed' }
Write-Output ('Native helper built for the next desktop start: ' + $nativeOutput)
