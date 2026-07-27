param(
  [int]$BackendPort = 8001
)

$ErrorActionPreference = "Stop"

$base = "http://127.0.0.1:" + $BackendPort
$username = "admin"
$password = "admin123"

Write-Host "== Login =="
$login = Invoke-RestMethod -Method Post -Uri ($base + "/api/auth/login") `
  -ContentType "application/json" `
  -Body (ConvertTo-Json @{ username = $username; password = $password })
$token = $login.access_token
$headers = @{ Authorization = ("Bearer " + $token) }

Write-Host "Token: " $token.Substring(0, 10) "..."

$root = "e:\Agent\test-skill"
Write-Host "== Import workspace skills from " $root "=="
$imp = Invoke-RestMethod -Method Post -Uri ($base + "/api/skills/import/workspace?root=" + [uri]::EscapeDataString($root)) -Headers $headers
Write-Host ("import_ok=" + $imp.ok + "; imported=" + $imp.imported_count + "; skipped=" + $imp.skipped_count)

Write-Host "== Fetch skills =="
$skills = Invoke-RestMethod -Method Get -Uri ($base + "/api/skills") -Headers $headers
$hit = $skills | Where-Object { $_.skill_id -eq "test.echo.skill" -and $_.version -eq "0.1.0" } | Select-Object -First 1
if (-not $hit) {
  throw "test skill not found in /api/skills"
}
Write-Host ("found=" + $hit.skill_id + "@" + $hit.version)

Write-Host "== Invoke #1 (success path) =="
$invoke1 = Invoke-RestMethod -Method Post -Uri ($base + "/api/skills/invoke") -Headers $headers -ContentType "application/json" -Body (
  ConvertTo-Json @{
    skill_id = "test.echo.skill"
    version = "0.1.0"
    agent_id = ""
    input_data = @{ text = "hello" }
    context = @{ tenant = "test" }
  }
)
Write-Host ("invoke1_ok=" + $invoke1.ok + "; status=" + $invoke1.run.status + "; run_id=" + $invoke1.run.run_id)

$run1Id = $invoke1.run.run_id
Write-Host "== Invoke #2 (network blocked path) =="
$invoke2 = Invoke-RestMethod -Method Post -Uri ($base + "/api/skills/invoke") -Headers $headers -ContentType "application/json" -Body (
  ConvertTo-Json @{
    skill_id = "test.echo.skill"
    version = "0.1.0"
    agent_id = ""
    input_data = @{ try_net = $true; host = "example.com"; port = 80 }
    context = @{ tenant = "test" }
  }
)
Write-Host ("invoke2_ok=" + $invoke2.ok + "; status=" + $invoke2.run.status + "; run_id=" + $invoke2.run.run_id)

$run2Id = $invoke2.run.run_id

Write-Host "== Fetch run detail #1 =="
$detail1 = Invoke-RestMethod -Method Get -Uri ($base + "/api/skills/runs/" + $run1Id) -Headers $headers
Write-Host ("run1 trace_id=" + $detail1.trace_id + "; input_summary=" + $detail1.input_summary)
Write-Host ("run1 error_code=" + $detail1.error_code + "; cost_tokens=" + $detail1.cost_tokens)
Write-Host ("run1 error_len=" + $detail1.error.Length + "; logs_len=" + $detail1.logs.Length)
Write-Host ("run1 error_head=" + ($detail1.error.Substring(0, [Math]::Min(200, $detail1.error.Length))))

Write-Host "== Fetch run detail #2 =="
$detail2 = Invoke-RestMethod -Method Get -Uri ($base + "/api/skills/runs/" + $run2Id) -Headers $headers
Write-Host ("run2 trace_id=" + $detail2.trace_id + "; error_code=" + $detail2.error_code)
Write-Host ("run2 duration_ms=" + $detail2.duration_ms)
Write-Host ("run2 error_len=" + $detail2.error.Length + "; logs_len=" + $detail2.logs.Length)
Write-Host ("run2 error_head=" + ($detail2.error.Substring(0, [Math]::Min(200, $detail2.error.Length))))

Write-Host "== Done =="

