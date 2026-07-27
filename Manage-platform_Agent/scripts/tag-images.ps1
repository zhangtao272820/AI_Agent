# 写入 CLAWHIVE_IMAGE_TAG=0.1.0-<gitsha>
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root ".env.agents-lan"
$repo = Split-Path $root -Parent
$semver = if ($env:CLAWHIVE_IMAGE_SEMVER) { $env:CLAWHIVE_IMAGE_SEMVER } else { "0.1.0" }
$sha = "local"
try { $sha = (git -C $repo rev-parse --short HEAD).Trim() } catch {}
$tag = "$semver-$sha"
if (-not (Test-Path $envFile)) { New-Item -ItemType File -Path $envFile | Out-Null }
$content = @(Get-Content $envFile -ErrorAction SilentlyContinue)
if ($content -match "^CLAWHIVE_IMAGE_TAG=") {
    $content = $content | ForEach-Object { if ($_ -match "^CLAWHIVE_IMAGE_TAG=") { "CLAWHIVE_IMAGE_TAG=$tag" } else { $_ } }
    Set-Content -Path $envFile -Value $content
} else {
    Add-Content -Path $envFile -Value "CLAWHIVE_IMAGE_TAG=$tag"
}
Write-Output $tag
