param(
    [int]$BackendPort = 8001,
    [int]$FrontendPort = 5174,
    [ValidateSet("local", "docker")]
    [string]$ControlMode
)

$ErrorActionPreference = "Stop"

$downScript = Join-Path $PSScriptRoot "down-local.ps1"
$upScript = Join-Path $PSScriptRoot "up-local.ps1"

Write-Host "Restarting local ClawHive services..." -ForegroundColor Cyan
powershell -ExecutionPolicy Bypass -File "$downScript"
if ([string]::IsNullOrWhiteSpace($ControlMode)) {
    powershell -ExecutionPolicy Bypass -File "$upScript" -BackendPort $BackendPort -FrontendPort $FrontendPort
} else {
    powershell -ExecutionPolicy Bypass -File "$upScript" -BackendPort $BackendPort -FrontendPort $FrontendPort -ControlMode $ControlMode
}
Write-Host "Done." -ForegroundColor Green
