# 将能力层模型从 SSOT 同步到各 Agent .env
# 用法：
#   .\sync-capability-models.ps1                  # 同步
#   .\sync-capability-models.ps1 -DryRun          # 预览
#   .\sync-capability-models.ps1 -Check           # 检查漂移
#   .\sync-capability-models.ps1 -Set "route=qwen-flash-xxx","reason=qwen-plus-xxx"
#   .\sync-capability-models.ps1 -Agents "DB_Agent","RAG_Agent"
#
# 同步后需让 Docker 重新加载 .env 时，请用一键脚本（含 force-recreate）：
#   .\apply-capability-models.ps1

param(
    [switch]$DryRun,
    [switch]$Check,
    [switch]$WriteSsot,
    [switch]$SkipAgentsLan,
    [string[]]$Set = @(),
    [string[]]$Agents = @(),
    [string]$Workspace = "",
    [string]$Ssot = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PyScript = Join-Path $ScriptDir "sync-capability-models.py"

if (-not (Test-Path $PyScript)) {
    Write-Error "找不到脚本: $PyScript"
}

$pyArgs = @($PyScript)
if ($Workspace) { $pyArgs += @("--workspace", $Workspace) }
if ($Ssot) { $pyArgs += @("--ssot", $Ssot) }
if ($DryRun) { $pyArgs += "--dry-run" }
if ($Check) { $pyArgs += "--check" }
if ($WriteSsot) { $pyArgs += "--write-ssot" }
if ($SkipAgentsLan) { $pyArgs += "--skip-agents-lan" }
foreach ($s in $Set) { $pyArgs += @("--set", $s) }
if ($Agents.Count -gt 0) { $pyArgs += @("--agents", ($Agents -join ",")) }

$python = $null
foreach ($candidate in @("python", "python3", "py")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $python = $candidate
        break
    }
}
if (-not $python) {
    Write-Error "未找到 Python，请安装 Python 3.9+"
}

& $python @pyArgs
exit $LASTEXITCODE
