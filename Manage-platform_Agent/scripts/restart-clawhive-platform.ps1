# 重建并重启 ClawHive 管理平台前后端（改过 frontend/ 或 backend/app/ 后执行）
param(
    [switch]$BuildOnly,
    [switch]$NoCache
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$compose = @(
    "compose", "--env-file", ".env.agents-lan",
    "-f", "docker-compose.agents-lan.yml"
)

function Invoke-ClawhiveBuild {
    param([switch]$ForceNoCache)
    $buildArgs = @("build")
    if ($ForceNoCache -or $NoCache) { $buildArgs += "--no-cache" }
    $buildArgs += "clawhive_frontend", "clawhive_backend"
    docker @compose @buildArgs
    return $LASTEXITCODE
}

Write-Host ">> build clawhive_frontend + clawhive_backend ..."
$exit = Invoke-ClawhiveBuild
if ($exit -ne 0) {
    Write-Host ">> build failed (常见原因: BuildKit 缓存 snapshot 损坏)，清理 builder 缓存后 --no-cache 重试 ..."
    docker builder prune -af | Out-Host
    $exit = Invoke-ClawhiveBuild -ForceNoCache
    if ($exit -ne 0) { exit $exit }
}

if ($BuildOnly) { exit 0 }

Write-Host ">> up -d clawhive_frontend clawhive_backend ..."
docker @compose up -d clawhive_backend clawhive_frontend

Write-Host ">> done. 打开 http://<LAN>:18073 并 Ctrl+F5 强刷"
