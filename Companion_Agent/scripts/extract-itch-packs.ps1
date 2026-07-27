# 解压 data/sprites/_packs/itch/ 下手动下载的 itch.io zip
# 用法: 把 zip 放进 itch/ 后运行本脚本

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ItchDir = Join-Path $Root "data\sprites\_packs\itch"
New-Item -ItemType Directory -Force -Path $ItchDir | Out-Null

$zips = Get-ChildItem -Path $ItchDir -Filter "*.zip" -File -ErrorAction SilentlyContinue
if (-not $zips) {
    Write-Host "No zip files in $ItchDir"
    Write-Host "Download from links in doc/立绘资源清单.md and place zips here."
    exit 0
}

foreach ($z in $zips) {
    $dest = Join-Path $ItchDir ($z.BaseName)
    if (Test-Path $dest) {
        Write-Host "[skip] $($z.Name) -> $($z.BaseName)/ exists"
        continue
    }
    Write-Host "[extract] $($z.Name) -> $($z.BaseName)/"
    Expand-Archive -Force -Path $z.FullName -DestinationPath $dest
}

Write-Host "Done. See data/sprite_catalog.json for character mapping."
