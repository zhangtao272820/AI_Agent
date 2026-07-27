$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $root ".local\runtime"
$backendPidFile = Join-Path $runtimeDir "clawhive-backend.pid"
$frontendPidFile = Join-Path $runtimeDir "clawhive-frontend.pid"

function Stop-ByPidFile($pidFile, $name) {
    if (!(Test-Path $pidFile)) {
        Write-Host "$name is not running (pid file missing)." -ForegroundColor Yellow
        return
    }

    $pidValue = [int](Get-Content $pidFile -ErrorAction SilentlyContinue)
    if (!$pidValue) {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
        Write-Host "$name pid file is invalid, cleaned." -ForegroundColor Yellow
        return
    }

    try {
        Stop-Process -Id $pidValue -Force -ErrorAction Stop
        Write-Host "Stopped $name (PID=$pidValue)." -ForegroundColor Green
    } catch {
        Write-Host "$name process not found (PID=$pidValue)." -ForegroundColor Yellow
    } finally {
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Stopping local ClawHive services..." -ForegroundColor Cyan
Stop-ByPidFile $backendPidFile "ClawHive backend"
Stop-ByPidFile $frontendPidFile "ClawHive frontend"
Write-Host "Done." -ForegroundColor Green
