# 启动本地对口型服务（需先 pip install -r requirements.txt）
$Root = $PSScriptRoot
if (-not $Root) {
  $Root = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $Root) {
  $Root = (Get-Location).Path
}
Set-Location $Root

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
  Write-Host "创建 venv..."
  python -m venv .venv
}

Write-Host "安装/更新依赖（含 Wav2Lip: librosa/torch）..."
.\.venv\Scripts\pip install -r requirements.txt -q

$env:LIPSYNC_FACE_VIDEO = if ($env:LIPSYNC_FACE_VIDEO) { $env:LIPSYNC_FACE_VIDEO } else { (Resolve-Path "..\..\video\ai.mp4").Path }
$env:LIPSYNC_PORT = if ($env:LIPSYNC_PORT) { $env:LIPSYNC_PORT } else { "8091" }
$env:LIPSYNC_BACKEND = if ($env:LIPSYNC_BACKEND) { $env:LIPSYNC_BACKEND } else { "ultralight" }

Write-Host "LIPSYNC_FACE_VIDEO=$($env:LIPSYNC_FACE_VIDEO)"
Write-Host "ULTRALIGHT_DATA_PATH=$($env:ULTRALIGHT_DATA_PATH)"
Write-Host "WAV2LIP_ROOT=$($env:WAV2LIP_ROOT)"
Write-Host "http://127.0.0.1:$($env:LIPSYNC_PORT)/health"

.\.venv\Scripts\python.exe server.py
