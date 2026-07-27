# 从 backups/*.sql.gz 或 .sql 恢复 ClawHive PostgreSQL
# 用法:
#   .\scripts\restore-postgres.ps1 -Backup .\backups\clawhive-pg-xxx.sql.gz -Yes
param(
    [Parameter(Mandatory = $true)]
    [string]$Backup,
    [switch]$Yes
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.agents-lan"
$composeFile = Join-Path $root "docker-compose.agents-lan.yml"

if (-not (Test-Path $Backup)) { throw "文件不存在: $Backup" }
if (-not $Yes) {
    Write-Host "将用 $Backup 覆盖数据库。确认请加 -Yes"
    exit 1
}

$pgUser = "postgres"
$pgDb = "clawhive"
$backendPort = "18000"
if (Test-Path $envFile) {
    $u = Select-String -Path $envFile -Pattern "^CLAWHIVE_PG_USER=(.+)$" | Select-Object -First 1
    $d = Select-String -Path $envFile -Pattern "^CLAWHIVE_PG_DB=(.+)$" | Select-Object -First 1
    $p = Select-String -Path $envFile -Pattern "^CLAWHIVE_BACKEND_PORT=(.+)$" | Select-Object -First 1
    if ($u) { $pgUser = $u.Matches.Groups[1].Value.Trim() }
    if ($d) { $pgDb = $d.Matches.Groups[1].Value.Trim() }
    if ($p) { $backendPort = $p.Matches.Groups[1].Value.Trim() }
}

$svc = $null
$services = @(docker compose --env-file $envFile -f $composeFile config --services 2>$null)
foreach ($c in @("clawhive_postgres", "postgres")) {
    if ($services -contains $c) { $svc = $c; break }
}
if (-not $svc) { throw "未找到 PostgreSQL compose 服务" }

Write-Host "恢复 $Backup → $svc / $pgDb"
$tmpSql = $Backup
$cleanup = $false
if ($Backup -like "*.gz") {
    $tmpSql = Join-Path $env:TEMP ("clawhive-restore-" + [guid]::NewGuid().ToString() + ".sql")
    $in = [System.IO.File]::OpenRead((Resolve-Path $Backup))
    $gz = New-Object System.IO.Compression.GzipStream($in, [System.IO.Compression.CompressionMode]::Decompress)
    $out = [System.IO.File]::Create($tmpSql)
    $gz.CopyTo($out)
    $out.Close(); $gz.Close(); $in.Close()
    $cleanup = $true
}

try {
    Get-Content -Path $tmpSql -Raw -Encoding utf8 |
        docker compose --env-file $envFile -f $composeFile exec -T $svc `
            psql -U $pgUser -d $pgDb -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw "psql 恢复失败" }
} finally {
    if ($cleanup -and (Test-Path $tmpSql)) { Remove-Item -Force $tmpSql }
}

Write-Host "恢复完成。建议: Invoke-WebRequest http://127.0.0.1:${backendPort}/health/ready"
Write-Host "演练清单: 备份 → 改数据 → 恢复 → 登录控制台核对租户/审计 → /health/ready"
