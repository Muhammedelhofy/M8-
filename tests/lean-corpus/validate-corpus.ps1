# Golden Corpus Validator -- tests/lean-corpus/validate-corpus.ps1
#
# Posts every pair in golden.json to the LIVE Cloud Run /check endpoint and
# asserts the verdict matches the pair's `expect`:
#   verified       -> verified=true, 0 errors, 0 sorries
#   stated         -> 0 errors, >=1 sorry (statement type-checks, proof open)
#   rejected       -> >=1 error (the false/broken claim is caught)
#   unformalizable -> NOT sent to /check; format-checked locally (UNFORMALIZABLE: ...)
#
# Every `embed:true` pair MUST behave as expected before it is allowed into the
# Gemini few-shot directive (S4 contract: no unvalidated exemplar ships).
#
#   powershell -File tests/lean-corpus/validate-corpus.ps1
#   powershell -File tests/lean-corpus/validate-corpus.ps1 -Id g12
#
# Cold start note: first call after idle can 503 for ~10 min (Mathlib import).
# The script retries 503s with a long backoff on the FIRST pair only.

param(
  [string]$Id = "",
  [string]$CheckUrl = "https://m8-lean-check-vbhba5tbgq-ue.a.run.app/check",
  [string]$TokenFile = "$env:USERPROFILE\.m8-lean-token.txt"
)
$ErrorActionPreference = 'Stop'

$tok = (Get-Content $TokenFile -Raw).Trim()
$hdr = @{ Authorization = "Bearer $tok" }

# -Encoding UTF8 is REQUIRED: golden.json has no BOM, and PS 5.1 defaults to
# ANSI — Lean's ℕ/≤/∀ would be mojibake'd before they ever reach the wire.
$corpus = Get-Content (Join-Path $PSScriptRoot 'golden.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$corpus = @($corpus)   # PS 5.1: assign-then-wrap (ConvertFrom-Json emits arrays un-enumerated)
if ($Id) { $sel = $Id -split '[,\s]+' | Where-Object { $_ }; $corpus = @($corpus | Where-Object { $sel -contains $_.id }) }

function CheckOne([string]$code, [bool]$firstCall) {
  $body = @{ code = $code; timeout_s = 90 } | ConvertTo-Json
  # PS 5.1 trap: a STRING body is sent Latin-1, mangling Lean's unicode (ℕ ≤ ∀ …)
  # into invalid UTF-8 → 400 from the JSON parser. Send UTF-8 BYTES explicitly.
  $bodyBytes = [Text.Encoding]::UTF8.GetBytes($body)
  $tries = if ($firstCall) { 8 } else { 2 }
  for ($t = 0; $t -lt $tries; $t++) {
    try {
      return Invoke-RestMethod -Uri $CheckUrl -Method Post -ContentType 'application/json; charset=utf-8' -Headers $hdr -Body $bodyBytes -TimeoutSec 150
    } catch {
      $is503 = $_.Exception.Message -match '503'
      if (-not $is503 -or $t -eq ($tries - 1)) { throw }
      Write-Host "    (503 - checker warming, waiting 90s...)" -ForegroundColor DarkGray
      Start-Sleep -Seconds 90
    }
  }
}

$pass = 0; $fail = 0; $failures = @(); $first = $true
foreach ($p in $corpus) {
  if ($p.expect -eq 'unformalizable') {
    $ok = $p.lean -match '^\s*UNFORMALIZABLE\s*:'
    if ($ok) { $pass++; Write-Host ("  {0,-6} {1,-22} UNFORMALIZABLE format OK" -f $p.id, $p.class) -ForegroundColor Green }
    else { $fail++; $failures += $p.id; Write-Host ("  {0,-6} {1,-22} BAD UNFORMALIZABLE format" -f $p.id, $p.class) -ForegroundColor Red }
    continue
  }
  try { $r = CheckOne $p.lean $first } catch {
    $fail++; $failures += $p.id
    Write-Host ("  {0,-6} {1,-22} CALL FAILED: {2}" -f $p.id, $p.class, $_.Exception.Message) -ForegroundColor Red
    continue
  }
  $first = $false
  $nErr = @($r.errors).Count; $nSorry = @($r.sorries).Count
  $verdict =
    if ($nErr -gt 0) { 'rejected' }
    elseif ($nSorry -gt 0) { 'stated' }
    elseif ($r.verified) { 'verified' }
    else { 'rejected' }
  $ok = ($verdict -eq $p.expect)
  if ($ok) { $pass++; $col = 'Green' } else { $fail++; $failures += $p.id; $col = 'Red' }
  Write-Host ("  {0,-6} {1,-22} want={2,-14} got={3,-10} ({4}ms, err={5} sorry={6})" -f `
    $p.id, $p.class, $p.expect, $verdict, $r.elapsed_ms, $nErr, $nSorry) -ForegroundColor $col
  if (-not $ok -and $nErr -gt 0) {
    $e0 = @($r.errors)[0]; $etxt = if ($e0 -is [string]) { $e0 } else { ($e0 | ConvertTo-Json -Compress -Depth 3) }
    Write-Host ("         first error: " + $etxt.Substring(0, [Math]::Min(220, $etxt.Length))) -ForegroundColor DarkYellow
  }
}

Write-Host ("`n{0} passed / {1} failed of {2}" -f $pass, $fail, $corpus.Count)
if ($failures.Count) { Write-Host ("failures: " + ($failures -join ', ')) -ForegroundColor Red; exit 1 }
Write-Host "Corpus fully validated against the live checker." -ForegroundColor Green
