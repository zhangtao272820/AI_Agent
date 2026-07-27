# 生成 skills-catalog/remote-demo 演示 zip 包与 index.json
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
python (Join-Path $PSScriptRoot "build-registry-packages.py")
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "remote-demo registry ready under $root\skills-catalog\remote-demo"
