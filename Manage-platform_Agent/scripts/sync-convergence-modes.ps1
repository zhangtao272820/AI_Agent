# 将收敛 MODE 从 SSOT 同步到各 Agent .env
# 用法：
#   .\sync-convergence-modes.ps1
#   .\sync-convergence-modes.ps1 -DryRun
#   .\sync-convergence-modes.ps1 -Check

param(
    [switch]$DryRun,
    [switch]$Check,
    [switch]$SkipAgentsLan,
    [string[]]$Agents = @(),
    [string]$Workspace = "",
    [string]$Ssot = ""
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PyScript = Join-Path $ScriptDir "sync-convergence-modes.py"

if (-not (Test-Path $PyScript)) { Write-Error "找不到 $PyScript" }

$pyArgs = @($PyScript)
if ($Workspace) { $pyArgs += @("--workspace", $Workspace) }
if ($Ssot) { $pyArgs += @("--ssot", $Ssot) }
if ($DryRun) { $pyArgs += "--dry-run" }
if ($Check) { $pyArgs += "--check" }
if ($SkipAgentsLan) { $pyArgs += "--skip-agents-lan" }
if ($Agents.Count -gt 0) { $pyArgs += @("--agents", ($Agents -join ",")) }

$python = $null
foreach ($candidate in @("python", "python3", "py")) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) { $python = $candidate; break }
}
if (-not $python) { Write-Error "未找到 Python" }

& $python @pyArgs
exit $LASTEXITCODE
