$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $root "docker-compose.agents-lan.yml"
$envFile = Join-Path $root ".env.agents-lan"

Write-Host "Stopping agent stack..." -ForegroundColor Cyan
docker compose --env-file "$envFile" -f "$composeFile" down
Write-Host "Done." -ForegroundColor Green
