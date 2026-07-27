# apply-capability-models.ps1
# Sync .env.capability-models (SSOT) to Agent .env files, then force-recreate Docker containers.
#
# Why force-recreate:
#   - sync-capability-models writes host .env files (SSOT: .env.capability-models)
#   - docker compose restart does NOT reload env_file
#   - compose services.environment 不覆盖模型键；recreate 后容器读取各 Agent/.env
#
# Usage:
#   .\scripts\apply-capability-models.ps1
#   .\scripts\apply-capability-models.ps1 -DryRun
#   .\scripts\apply-capability-models.ps1 -All
#   .\scripts\apply-capability-models.ps1 -Extended
#   .\scripts\apply-capability-models.ps1 -SyncOnly
#   .\scripts\apply-capability-models.ps1 -Check
#   .\scripts\apply-capability-models.ps1 -Agents "DB_Agent","RAG_Agent"
#   .\scripts\apply-capability-models.ps1 -LayerSet "route=qwen-flash-xxx"
#   .\scripts\apply-capability-models.ps1 -Build

param(
    [switch]$DryRun,
    [switch]$SyncOnly,
    [switch]$Check,
    [switch]$All,
    [switch]$Extended,
    [switch]$Build,
    [string[]]$LayerSet = @(),
    [string[]]$Agents = @()
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "_agents-lan-common.ps1")

Set-Location $Script:AgentsLanRoot

if (-not (Test-Path (Join-Path $Script:AgentsLanRoot ".env.capability-models"))) {
    Write-Host "Missing SSOT: .env.capability-models" -ForegroundColor Red
    Write-Host "Copy: Copy-Item .env.capability-models.example .env.capability-models" -ForegroundColor Yellow
    exit 1
}

if ($Check) {
    Invoke-SyncCapabilityModels -Check -LayerSet $LayerSet -Agents $Agents
    exit 0
}

Invoke-SyncCapabilityModels -DryRun:$DryRun -LayerSet $LayerSet -Agents $Agents
Invoke-SyncConvergenceModes -DryRun:$DryRun -Agents $Agents

if ($DryRun -or $SyncOnly) {
    Write-Host ""
    if ($DryRun) {
        Write-Host "Dry-run done (no files written, no docker). Re-run without -DryRun to apply." -ForegroundColor Yellow
    } else {
        Write-Host "Sync-only done (docker not restarted). Re-run without -SyncOnly to force-recreate." -ForegroundColor Yellow
    }
    exit 0
}

$services = Resolve-CapabilityDockerServices -All:$All -Extended:$Extended -Agents $Agents
$scopeLabel = if ($Agents.Count -gt 0) { "selected agents" } elseif ($All) { "all capability agents" } elseif ($Extended) { "manager stack + extended" } else { "manager stack" }

Write-Host ""
Write-Host "Recreating Docker services ($scopeLabel) so env_file / mounted .env reload..." -ForegroundColor Cyan
Write-Host ("  " + ($services -join ", ")) -ForegroundColor DarkGray
Write-Host "  Note: compose restart does not reload env; using up -d --force-recreate" -ForegroundColor DarkYellow

Stop-LegacyOlderAgent

Invoke-AgentsLanCompose -Action up -ForceRecreate -Build:$Build -Extended:$Extended -Services $services
if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed (exit $LASTEXITCODE)"
}

$lan = Get-AgentsLanLanHost
Write-Host ""
Write-Host "Done. Capability models synced and containers recreated." -ForegroundColor Green
Write-Host ("  Manager    http://{0}:13106" -f $lan)
Write-Host ("  DB         http://{0}:13101" -f $lan)
Write-Host ("  RAG        http://{0}:13102" -f $lan)
Write-Host ("  AI Admin   http://{0}:13105" -f $lan)
if ($All -or $Extended) {
    Write-Host ("  Multimodal http://{0}:13107" -f $lan)
    Write-Host ("  Lobster    http://{0}:13108" -f $lan)
    Write-Host ("  Music      http://{0}:13110" -f $lan)
    Write-Host ("  Video      http://{0}:13111" -f $lan)
    Write-Host ("  AI Agent   http://{0}:13112" -f $lan)
}

# 打印容器内联网搜索生效值（便于排障；apply 本身不改 SearXNG）
$mgrRunning = docker ps --filter "name=^manager_agent$" --format "{{.Names}}" 2>$null
if ($mgrRunning -eq "manager_agent") {
    Write-Host ""
    Write-Host "Manager web_search env (runtime):" -ForegroundColor Cyan
    $searchEnv = docker exec manager_agent sh -c "echo SEARXNG_BASE_URL=`$SEARXNG_BASE_URL; echo WEB_SEARCH_PROVIDER=`$WEB_SEARCH_PROVIDER; echo MANAGER_WEB_SEARCH_MODE=`$MANAGER_WEB_SEARCH_MODE; echo SEARXNG_TIMEOUT_MS=`$SEARXNG_TIMEOUT_MS" 2>$null
    if ($searchEnv) {
        foreach ($line in ($searchEnv -split "`n")) {
            if ($line.Trim()) { Write-Host ("  " + $line.Trim()) }
        }
    }
}
