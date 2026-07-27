# 备份 ClawHive PostgreSQL
param(
    [string]$OutDir = ""
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.agents-lan"
$composeFile = Join-Path $root "docker-compose.agents-lan.yml"
if (-not $OutDir) { $OutDir = Join-Path $root "backups" }
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$outSql = Join-Path $OutDir "clawhive-pg-$stamp.sql"

$services = @(docker compose --env-file $envFile -f $composeFile ps --services 2>$null)
$svc = $null
foreach ($c in @("clawhive_postgres", "postgres", "pgvector", "clawhive_pg")) {
    if ($services -contains $c) { $svc = $c; break }
}
if (-not $svc) {
    $names = docker ps --format "{{.Names}}"
    $cname = ($names | Select-String -Pattern "clawhive.*pg|postgres" | Select-Object -First 1).ToString()
    if (-not $cname) { throw "未找到 PostgreSQL 容器" }
    docker exec $cname pg_dump -U postgres clawhive | Set-Content -Path $outSql -Encoding utf8
    Write-Host "已备份: $outSql"
    exit 0
}
docker compose --env-file $envFile -f $composeFile exec -T $svc pg_dump -U postgres clawhive | Set-Content -Path $outSql -Encoding utf8
Write-Host "已备份: $outSql"
Write-Host "恢复: Get-Content $outSql | docker compose exec -T $svc psql -U postgres clawhive"
