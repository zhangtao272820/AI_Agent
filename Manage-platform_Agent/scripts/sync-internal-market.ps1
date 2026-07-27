# 同步内部免费技能市场 index.json（扫描各 Agent/skills + skills-starter）
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
python (Join-Path $PSScriptRoot "sync-internal-market.py") @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
