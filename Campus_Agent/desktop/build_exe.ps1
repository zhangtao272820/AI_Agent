# Build Windows onedir package for Campus Agent
# Usage (from Campus_Agent):  powershell -File desktop/build_exe.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "frontend"))) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

Set-Location $Root
Write-Host "==> Frontend build" -ForegroundColor Cyan
Push-Location frontend
if (-not (Test-Path "node_modules")) {
  npm install
}
npm run build
Pop-Location

Write-Host "==> Python desktop deps" -ForegroundColor Cyan
python -m pip install -q -r backend/requirements.txt
python -m pip install -q pywebview pyinstaller

Write-Host "==> PyInstaller" -ForegroundColor Cyan
$Out = Join-Path $Root "desktop_dist"
if (Test-Path $Out) {
  Remove-Item -Recurse -Force $Out
}
python -m PyInstaller `
  --noconfirm `
  --clean `
  --distpath $Out `
  --workpath (Join-Path $Out "_work") `
  (Join-Path $Root "desktop\campus.spec")

$AppDir = Join-Path $Out "CampusAgent"
$internal = Join-Path $AppDir "_internal"
if (Test-Path $internal) {
  Get-ChildItem $internal | Where-Object {
    $_.Name -match '^(torch|torchvision|torchaudio|scipy|sklearn|scikit|opencv|cv2|transformers|accelerate|librosa|huggingface|tokenizers|safetensors|hf_xet|numba|llvmlite|matplotlib|pandas|sympy)'
  } | ForEach-Object {
    Write-Host "Strip $($_.Name)"
    Remove-Item -Recurse -Force $_.FullName -ErrorAction SilentlyContinue
  }
}

Write-Host ""
Write-Host "Done. Launch:" -ForegroundColor Green
Write-Host "  $AppDir\CampusAgent.exe"

$LocalDir = Join-Path $env:LOCALAPPDATA "CampusAgent"
$LocalEnv = Join-Path $LocalDir ".env"
$SrcEnv = Join-Path $Root ".env"
if (-not (Test-Path $LocalDir)) {
  New-Item -ItemType Directory -Force $LocalDir | Out-Null
}
if ((Test-Path $SrcEnv) -and -not (Test-Path $LocalEnv)) {
  Copy-Item $SrcEnv $LocalEnv
  Write-Host "Seeded $LocalEnv"
}
