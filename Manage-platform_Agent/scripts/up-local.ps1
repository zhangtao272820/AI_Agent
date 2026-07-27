param(
    [int]$BackendPort = 8001,
    [int]$FrontendPort = 5174,
    [ValidateSet("local", "docker")]
    [string]$ControlMode
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $root "backend"
$frontendDir = Join-Path $root "frontend"
$runtimeDir = Join-Path $root ".local\runtime"
$deployMode = $env:DEPLOY_MODE
if ([string]::IsNullOrWhiteSpace($deployMode)) {
    $deployMode = "local"
}
$deployMode = $deployMode.ToLower()
if ($deployMode -ne "local" -and $deployMode -ne "docker") {
    throw "Invalid DEPLOY_MODE '$deployMode'. Allowed values: local, docker."
}
if ([string]::IsNullOrWhiteSpace($ControlMode)) {
    $ControlMode = $deployMode
}

if (!(Test-Path $runtimeDir)) {
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
}

$backendPidFile = Join-Path $runtimeDir "clawhive-backend.pid"
$frontendPidFile = Join-Path $runtimeDir "clawhive-frontend.pid"
$backendLog = Join-Path $runtimeDir "clawhive-backend.log"
$backendErrLog = Join-Path $runtimeDir "clawhive-backend.err.log"
$frontendLog = Join-Path $runtimeDir "clawhive-frontend.log"
$frontendErrLog = Join-Path $runtimeDir "clawhive-frontend.err.log"

function Test-ProcessAlive($pidValue) {
    try {
        $p = Get-Process -Id $pidValue -ErrorAction Stop
        return $null -ne $p
    } catch {
        return $false
    }
}

if (Test-Path $backendPidFile) {
    $oldPid = [int](Get-Content $backendPidFile -ErrorAction SilentlyContinue)
    if ($oldPid -and (Test-ProcessAlive $oldPid)) {
        Write-Host "Backend already running. PID=$oldPid" -ForegroundColor Yellow
    }
}

if (Test-Path $frontendPidFile) {
    $oldPid = [int](Get-Content $frontendPidFile -ErrorAction SilentlyContinue)
    if ($oldPid -and (Test-ProcessAlive $oldPid)) {
        Write-Host "Frontend already running. PID=$oldPid" -ForegroundColor Yellow
    }
}

$pythonExe = Join-Path $backendDir ".venv\Scripts\python.exe"
if (!(Test-Path $pythonExe)) {
    throw "Backend virtualenv not found: $pythonExe"
}

if (!(Test-Path (Join-Path $frontendDir "node_modules"))) {
    Write-Host "Frontend node_modules not found. Running npm install..." -ForegroundColor Cyan
    npm --prefix "$frontendDir" install
}

Write-Host "Starting local ClawHive backend..." -ForegroundColor Cyan
$allowOrigins = "http://localhost:$FrontendPort,http://127.0.0.1:$FrontendPort"
# 本地开发默认使用 SQLite，避免因为本机未启动 PostgreSQL 导致后端秒退
$sqlitePath = (Join-Path $runtimeDir "clawhive-local.db").Replace("\", "/")
$sqliteUrl = "sqlite:///$sqlitePath"
if ($deployMode -eq "local") {
    $backendCmd = "set DEPLOY_MODE=$deployMode&& set AGENT_CONTROL_MODE=$ControlMode&& set ALLOW_ORIGINS=$allowOrigins&& set DATABASE_URL=$sqliteUrl&& `"$pythonExe`" -m uvicorn app.main:app --host 0.0.0.0 --port $BackendPort"
} else {
    $backendCmd = "set DEPLOY_MODE=$deployMode&& set AGENT_CONTROL_MODE=$ControlMode&& set ALLOW_ORIGINS=$allowOrigins&& `"$pythonExe`" -m uvicorn app.main:app --host 0.0.0.0 --port $BackendPort"
}
$backendProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", $backendCmd `
    -WorkingDirectory $backendDir `
    -RedirectStandardOutput $backendLog `
    -RedirectStandardError $backendErrLog `
    -PassThru
Set-Content -Path $backendPidFile -Value $backendProc.Id -Encoding ascii

Write-Host "Starting local ClawHive frontend..." -ForegroundColor Cyan
$frontendCmd = "set VITE_API_BASE_URL=http://localhost:$BackendPort&& set VITE_WS_BASE_URL=ws://localhost:$BackendPort&& npm run dev -- --host 0.0.0.0 --port $FrontendPort"
$frontendProc = Start-Process -FilePath "cmd.exe" `
    -ArgumentList "/c", $frontendCmd `
    -WorkingDirectory $frontendDir `
    -RedirectStandardOutput $frontendLog `
    -RedirectStandardError $frontendErrLog `
    -PassThru
Set-Content -Path $frontendPidFile -Value $frontendProc.Id -Encoding ascii

Write-Host ""
Write-Host "Local ClawHive started." -ForegroundColor Green
Write-Host "Backend:  http://127.0.0.1:$BackendPort/health"
Write-Host "Frontend: http://127.0.0.1:$FrontendPort"
Write-Host "DEPLOY_MODE: $deployMode"
Write-Host "AGENT_CONTROL_MODE: $ControlMode"
if ($deployMode -eq "local") {
    Write-Host "Backend DB: $sqliteUrl"
}
Write-Host "Backend log:  $backendLog"
Write-Host "Backend err:  $backendErrLog"
Write-Host "Frontend log: $frontendLog"
Write-Host "Frontend err: $frontendErrLog"
