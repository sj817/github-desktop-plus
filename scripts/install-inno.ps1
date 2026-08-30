$ErrorActionPreference = 'Stop'

$version = '7.1.0'
$expectedSha256 = '0362a383ed217d4c4239b5933866dd96d3eb2102737da92f80f6057a4b40df2f'
$download = "https://github.com/jrsoftware/issrc/releases/download/is-7_1_0/innosetup-$version-x64.exe"
$installer = Join-Path ([IO.Path]::GetTempPath()) "innosetup-$version-x64.exe"

try {
  Invoke-WebRequest -Uri $download -OutFile $installer
  $actualSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "Inno Setup SHA-256 mismatch: expected $expectedSha256, got $actualSha256"
  }

  $process = Start-Process -FilePath $installer `
    -ArgumentList @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', '/CURRENTUSER') `
    -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    throw "Inno Setup installation failed with exit code $($process.ExitCode)"
  }
} finally {
  Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
}
