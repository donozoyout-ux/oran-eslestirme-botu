$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$launcher = Join-Path $repoRoot "run-local.cmd"
$envFile = Join-Path $repoRoot ".env"

if (-not (Test-Path $launcher)) {
  throw "run-local.cmd bulunamadi: $launcher"
}
if (-not (Test-Path $envFile)) {
  throw ".env bulunamadi. Once .env.example dosyasini .env olarak kopyalayip API/Telegram/Google Sheets degerlerini gir."
}

$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Oran Eslestirme Botu.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcher
$shortcut.WorkingDirectory = $repoRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "Oran Eslestirme Botu - yerel 7/24 worker"
$shortcut.Save()

Write-Host "Baslangic kisayolu kuruldu:" -ForegroundColor Green
Write-Host $shortcutPath
Write-Host "Windows oturum acilisinda bot otomatik baslayacak."
Write-Host "Panel: http://127.0.0.1:3000"
