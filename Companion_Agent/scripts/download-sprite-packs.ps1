# 下载 Companion Agent 立绘素材包（OpenGameArt 直链 + itch.io 需浏览器）
# 用法: powershell -ExecutionPolicy Bypass -File scripts/download-sprite-packs.ps1

param(
    [switch]$IncludeItchHelp = $true
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PacksDir = Join-Path $Root "data\sprites\_packs"
New-Item -ItemType Directory -Force -Path $PacksDir | Out-Null

$OgaDownloads = @(
    @{
        Name     = "kuudere"
        Url      = "https://opengameart.org/sites/default/files/kuudere_lisadikaprio.zip"
        Zip      = "kuudere_lisadikaprio.zip"
        Extract  = "kuudere"
        MinBytes = 15MB
    },
    @{
        Name     = "codel"
        Url      = "https://opengameart.org/sites/default/files/Codel%20sprite.zip"
        Zip      = "codel_sprite.zip"
        Extract  = "codel"
        MinBytes = 10MB
    },
    @{
        Name     = "falling_air"
        Url      = "https://opengameart.org/sites/default/files/character_5.zip"
        Zip      = "falling_air_character.zip"
        Extract  = "falling_air"
        MinBytes = 20MB
    },
    @{
        Name     = "cabbit_vn"
        Url      = "https://opengameart.org/sites/default/files/VN%20Characters%20%28by%20cabbit%20KusSv%29.zip"
        Zip      = "cabbit_vn_characters.zip"
        Extract  = "cabbit_vn"
        MinBytes = 40MB
    },
    @{
        Name     = "doom_girl"
        Url      = "https://opengameart.org/sites/default/files/sprites_8.zip"
        Zip      = "doom_girl_sprites.zip"
        Extract  = "doom_girl"
        MinBytes = 10MB
    }
)

function Download-IfNeeded {
    param($Item)
    $zipPath = Join-Path $PacksDir $Item.Zip
    $need = $true
    if (Test-Path $zipPath) {
        $len = (Get-Item $zipPath).Length
        if ($len -ge $Item.MinBytes) {
            Write-Host "[skip] $($Item.Name) already downloaded ($len bytes)"
            $need = $false
        } else {
            Write-Host "[retry] $($Item.Name) incomplete ($len bytes), re-downloading..."
        }
    }
    if ($need) {
        Write-Host "[download] $($Item.Name) from OpenGameArt..."
        & curl.exe -L --retry 3 --retry-delay 2 -o $zipPath $Item.Url
        if ($LASTEXITCODE -ne 0) { throw "curl failed for $($Item.Name)" }
        $len = (Get-Item $zipPath).Length
        if ($len -lt $Item.MinBytes) {
            throw "Download too small for $($Item.Name): $len bytes (expected >= $($Item.MinBytes))"
        }
        Write-Host "[ok] $($Item.Name) -> $len bytes"
    }
    $dest = Join-Path $PacksDir $Item.Extract
    $hasPng = (Test-Path $dest) -and (@(Get-ChildItem $dest -Recurse -Filter *.png -EA SilentlyContinue).Count -gt 0)
    if (-not $hasPng) {
        Write-Host "[extract] $($Item.Zip) -> $($Item.Extract)/ (python sanitize)"
        $env:PYTHONIOENCODING = "utf-8"
        python -c @"
import zipfile, pathlib, re, shutil
packs = pathlib.Path(r'$PacksDir')
zpath = packs / '$($Item.Zip)'
dest = packs / '$($Item.Extract)'
if dest.exists():
    shutil.rmtree(dest)
dest.mkdir(parents=True)
# doom_girl: index-based ascii names (zip has non-ascii)
if '$($Item.Extract)' == 'doom_girl':
    with zipfile.ZipFile(zpath) as zf:
        infos = [i for i in zf.infolist() if not i.is_dir() and i.filename.lower().endswith('.png')]
        for i, info in enumerate(infos):
            out = dest / f'sprite_{i:02d}.png'
            with zf.open(info) as src, open(out, 'wb') as dst:
                dst.write(src.read())
else:
    with zipfile.ZipFile(zpath) as zf:
        for info in zf.infolist():
            raw = info.filename.replace('\\\\','/').lstrip('/')
            parts=[]
            for p in raw.split('/'):
                safe = re.sub(r'[^A-Za-z0-9._+\-()\[\] ]+', '_', p).strip(' ._')
                if safe in ('', '.', '..'): continue
                parts.append(safe)
            if not parts: continue
            out = dest.joinpath(*parts)
            if info.is_dir() or raw.endswith('/'):
                out.mkdir(parents=True, exist_ok=True)
            else:
                out.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(info) as src, open(out, 'wb') as dst:
                    dst.write(src.read())
print('extracted', len(list(dest.rglob('*.png'))), 'pngs')
"@
    } else {
        Write-Host "[skip] extract $($Item.Extract)/ exists"
    }
}

foreach ($d in $OgaDownloads) {
    Download-IfNeeded -Item $d
}

Write-Host ""
Write-Host "=== OpenGameArt packs done ==="
Write-Host "Next: python scripts/stage-sprite-previews.py"
Write-Host ""

if ($IncludeItchHelp) {
    Write-Host "=== itch.io 可选升级包（更精美 · 需浏览器登录后 Download）==="
    Write-Host "Potat0Master（Royalty-Free）:"
    @(
        "https://potat0master.itch.io/free-character-sprite-for-visual-novels-hiyori",
        "https://potat0master.itch.io/free-character-sprite-for-visua-novel-nozomi",
        "https://potat0master.itch.io/free-character-sprite-for-visual-novels-ryoko-madoka",
        "https://potat0master.itch.io/character-sprites-for-visual-novels-starter-bundle",
        "https://potat0master.itch.io/free-characters-for-visual-novels-set-a01",
        "https://potat0master.itch.io/free-character-sprites-for-visual-novels-sensei-pack"
    ) | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
    Write-Host "LisadiKaprio Vivian:"
    Write-Host "  https://lisadikaprio.itch.io/vivian-visual-novel-sprite"
    Write-Host ""
    Write-Host "下载后 zip 放入: data/sprites/_packs/itch/"
    Write-Host "然后: powershell -File scripts/extract-itch-packs.ps1"
    Write-Host "再把 sprite_catalog.json 中角色 pack_id 改为 upgrade_itch.pack_id 后重新 stage"
}
