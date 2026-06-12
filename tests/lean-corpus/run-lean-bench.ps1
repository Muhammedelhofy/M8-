# Lean Formalization Benchmark -- tests/lean-corpus/run-lean-bench.ps1
#
# Measures the END-TO-END formalization pass-rate of the LIVE chat lane on the
# fixed held-out claim set in benchmark.json (disjoint from the few-shot
# exemplars embedded in the directive -- improvement must be generalization,
# not memorization). Run BEFORE and AFTER a directive change; compare runs.
#
# Scoring per claim (from the deterministic narration markers in lib/lean.js):
#   verified                 1.0   (faithful statement, machine-proved)
#   stated (sorry)           0.5   (faithful statement type-checks, proof open - honest)
#   rejected / draft-fail    0.0
#   unformalizable           0.0   (every benchmark claim IS formalizable)
#
#   powershell -File tests/lean-corpus/run-lean-bench.ps1 -Label before
#   powershell -File tests/lean-corpus/run-lean-bench.ps1 -Label after
#
# Hits live /api/chat + Gemini + the Lean checker = quota; ~8s spacing for the
# free-tier RPM. Lean cold "ask again in a moment" replies are retried once
# after 90s (same convention as the main battery).

param(
  [string]$Base  = "https://m8-alpha.vercel.app",
  [string]$Label = "run"
)
$ErrorActionPreference = 'Stop'

$claims = Get-Content (Join-Path $PSScriptRoot 'benchmark.json') -Raw | ConvertFrom-Json
$claims = @($claims)

$PENDING = 'ask\s+again\s+in\s+a\s+moment|try\s+again\s+shortly'
function Ask($message, $sessionId) {
  $body = @{ message = $message; sessionId = $sessionId } | ConvertTo-Json
  $r = Invoke-RestMethod -Uri "$Base/api/chat" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 150
  return ($r.response + "")
}

$rows = @(); $total = 0.0
foreach ($c in $claims) {
  $sid = "eval_leanbench_$($c.id)_$([DateTimeOffset]::Now.ToUnixTimeMilliseconds())"
  $msg = "formalize and verify in Lean: $($c.claim)"
  $t0 = Get-Date
  try { $reply = Ask $msg $sid } catch { $reply = "CALL FAILED: $($_.Exception.Message)" }
  if ($reply -match $PENDING) {
    Start-Sleep -Seconds 90
    try { $reply = Ask $msg $sid } catch {}
  }
  $ms = [int]((Get-Date) - $t0).TotalMilliseconds

  $verdict =
    if ($reply -match '\*\*verified\*\*')                       { 'verified' }
    elseif ($reply -match 'statement\s+type-?checks')           { 'stated' }
    elseif ($reply -match '\*\*rejected\*\*|Lean\s+rejected')   { 'rejected' }
    elseif ($reply -match "can'?t\s+be\s+faithfully\s+formaliz"){ 'unformalizable' }
    elseif ($reply -match $PENDING)                             { 'pending' }
    else                                                        { 'other' }
  $score = switch ($verdict) { 'verified' { 1.0 } 'stated' { 0.5 } default { 0.0 } }
  $total += $score
  $col = if ($score -ge 1.0) { 'Green' } elseif ($score -gt 0) { 'Yellow' } else { 'Red' }
  Write-Host ("  {0,-5} {1,-14} {2,4}  {3,7}ms  {4}" -f $c.id, $verdict, $score, $ms, $c.claim.Substring(0, [Math]::Min(60, $c.claim.Length))) -ForegroundColor $col
  $rows += [pscustomobject]@{ id=$c.id; claim=$c.claim; verdict=$verdict; score=$score; ms=$ms; reply=$reply }
  Start-Sleep -Seconds 8
}

$rate = [math]::Round($total / $claims.Count, 3)
Write-Host ("`n[{0}] pass-rate: {1} / {2} = {3}" -f $Label, $total, $claims.Count, $rate)

$runId  = (Get-Date).ToString('yyyy-MM-ddTHH-mm-ss')
$resDir = Join-Path $PSScriptRoot 'results'
if (-not (Test-Path $resDir)) { New-Item -ItemType Directory -Path $resDir | Out-Null }
[pscustomobject]@{ runId=$runId; label=$Label; base=$Base; rate=$rate; total=$total; n=$claims.Count; rows=$rows } |
  ConvertTo-Json -Depth 5 | Out-File (Join-Path $resDir "bench-$Label-$runId.json") -Encoding utf8
Write-Host "-> tests/lean-corpus/results/bench-$Label-$runId.json"
