param(
    [string]$Service = "",
    [switch]$Build
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$composeFile = Join-Path $root "docker-compose.agents-lan.yml"
$envFile = Join-Path $root ".env.agents-lan"

$validServices = @(
    "clawhive_postgres",
    "clawhive_redis",
    "clawhive_backend",
    "clawhive_frontend",
    "prometheus",
    "grafana",
    "alertmanager",
    "tempo",
    "loki",
    "promtail",
    "langfuse",
    "litellm",
    "db_agent",
    "rag_agent",
    "code_assistent_agent",
    "extractor_agent",
    "ai_admin_agent",
    "manager_agent",
    "multimodal_agent",
    "lobster_agent",
    "tavern_agent",
    "music_agent",
    "video_agent"
)

if ([string]::IsNullOrWhiteSpace($Service)) {
    Write-Host "Restarting all agent services..." -ForegroundColor Cyan
    if ($Build) {
        docker compose --env-file "$envFile" -f "$composeFile" up -d --build
    } else {
        docker compose --env-file "$envFile" -f "$composeFile" restart
    }
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

if ($validServices -notcontains $Service) {
    Write-Host "Invalid service: $Service" -ForegroundColor Red
    Write-Host "Valid services: $($validServices -join ', ')" -ForegroundColor Yellow
    exit 1
}

Write-Host "Restarting service: $Service" -ForegroundColor Cyan
if ($Build) {
    docker compose --env-file "$envFile" -f "$composeFile" up -d --build $Service
} else {
    docker compose --env-file "$envFile" -f "$composeFile" restart $Service
}
Write-Host "Done." -ForegroundColor Green
