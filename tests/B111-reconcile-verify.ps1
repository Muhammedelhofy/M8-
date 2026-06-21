# ════════════════════════════════════════════════════════════════════════════
# B111 — verified-outcome reconciliation  ·  PS-5.1 MIRROR of the pure decision
# logic in lib/conjecture-memory.js (reconcileVerifiedOutcomes, isFailedOutcome)
# and lib/lemma-dag.js (fetchVerifiedScaffolds sketch shaping).
#
# Node is absent on this host, so this mirrors the JS byte-for-byte in PowerShell.
# A PS-only failure means the MIRROR is wrong, not the JS (see feedback-ps-test
# -mirror-gotchas): we use an ORDINAL HashSet to match JS `new Set()` case-sensitivity
# and suppress ArrayList.Add() output to avoid stream-return pollution.
#
# What it proves:
#   - empty table + verified scaffolds  -> one success row each (the 0 -> >0 fix)
#   - re-run with rows present          -> 0 inserted (idempotent; flip-flop safe)
#   - a prior SORRY row                 -> does NOT suppress the verified success
#   - sketch shaping                    -> verified-leaf code only; sibling `sorry` excluded
#   - degenerate verified leaf (no code)-> coerced to a non-failed success sketch
#   - within-batch dup targets / blanks -> deduped / skipped
# ════════════════════════════════════════════════════════════════════════════
$ErrorActionPreference = "Stop"
$fail = 0
function Assert($name, $cond) {
  if ($cond) { Write-Host "  PASS  $name" -ForegroundColor Green }
  else       { Write-Host "  FAIL  $name" -ForegroundColor Red; $script:fail++ }
}

# ── mirror: isFailedOutcome(sketch) ─────────────────────────────────────────
# JS: null -> true; "".trim()=="" -> true; /\bsorry\b/i.test(str) -> true
function Test-FailedOutcome($sketch) {
  if ($null -eq $sketch) { return $true }
  $t = ([string]$sketch).Trim()
  if ($t -eq "") { return $true }
  return ($t -match '\bsorry\b')          # PS -match is case-insensitive => mirrors /i
}

# ── mirror: fetchVerifiedScaffolds sketch shaping ───────────────────────────
# verified = leaves where is_leaf && lean_status=="lean_verified"
# sketch   = (code||prose||name||"") joined by "\n", truncated 1000, "" -> $null
function Get-VerifiedSketch($lemmas) {
  $parts = @()
  foreach ($l in $lemmas) {
    if ($l.is_leaf -and $l.lean_status -eq "lean_verified") {
      $v = ""
      if ($l.code)  { $v = [string]$l.code }
      elseif ($l.prose) { $v = [string]$l.prose }
      elseif ($l.name)  { $v = [string]$l.name }
      if ($v -ne "") { $parts += $v }
    }
  }
  if ($parts.Count -eq 0) { return $null }
  $s = ($parts -join "`n")
  if ($s.Length -gt 1000) { $s = $s.Substring(0,1000) }
  return $s
}

# ── mirror: reconcileVerifiedOutcomes(existingRows, scaffolds) ───────────────
# returns @{ inserted = N; rows = @( @{ target; sketch } ... ) }
function Invoke-Reconcile($existing, $scaffolds) {
  function _norm($t) { return (([string]$t) -replace '\s+', ' ').Trim() }
  # have = ordinal set of normalized conjecture_text among NON-failed existing rows
  $have = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
  foreach ($r in $existing) {
    if (-not (Test-FailedOutcome $r.lean_proof_sketch)) {
      [void]$have.Add((_norm $r.conjecture_text))
    }
  }
  $rows = New-Object System.Collections.ArrayList
  foreach ($s in $scaffolds) {
    if ($null -eq $s -or -not $s.target) { continue }
    $key = _norm $s.target
    if ($key -eq "" -or $have.Contains($key)) { continue }
    $raw = ""
    if ($null -ne $s.sketch) { $raw = [string]$s.sketch }
    if (($raw -match '\S') -and -not ($raw -match '\bsorry\b')) { $sketch = $raw } else { $sketch = "lean_verified" }
    [void]$rows.Add([pscustomobject]@{ target = $s.target; sketch = $sketch })
    [void]$have.Add($key)
  }
  return [pscustomobject]@{ inserted = $rows.Count; rows = $rows }
}

Write-Host "`n=== B111 reconcileVerifiedOutcomes mirror ===" -ForegroundColor Cyan

# real data shapes (id=3 single verified leaf, id=6 four verified leaves)
$T3 = "for every natural number n, 2 times the sum of i for i from 0 to n equals n times (n+1)"
$T6 = "the product of two odd integers is odd"
$s3 = [pscustomobject]@{ target = $T3; sketch = "theorem two_mul_sum_range_eq_mul : ..." }
$s6 = [pscustomobject]@{ target = $T6; sketch = "theorem int_odd_iff ...`ntheorem product_of_odd ..." }

# A — backfill from empty -> 2 success rows  (THE 0 -> >0 FIX)
$A = Invoke-Reconcile @() @($s3, $s6)
Assert "A: empty table backfills both verified scaffolds (inserted=2)" ($A.inserted -eq 2)
Assert "A: T3 row classifies as SUCCESS (not failed)" (-not (Test-FailedOutcome $A.rows[0].sketch))
Assert "A: T6 row classifies as SUCCESS (not failed)" (-not (Test-FailedOutcome $A.rows[1].sketch))

# B — idempotent: rows already present -> 0 inserted
$existB = @(
  [pscustomobject]@{ conjecture_text = $T3; lean_proof_sketch = "theorem two_mul_sum_range_eq_mul : ..." },
  [pscustomobject]@{ conjecture_text = $T6; lean_proof_sketch = "theorem product_of_odd ..." }
)
$B = Invoke-Reconcile $existB @($s3, $s6)
Assert "B: re-run with both present is a no-op (inserted=0)" ($B.inserted -eq 0)

# C — partial present (flip-flop safe): only the missing one inserts
$existC = @([pscustomobject]@{ conjecture_text = $T6; lean_proof_sketch = "theorem product_of_odd ..." })
$C = Invoke-Reconcile $existC @($s3, $s6)
Assert "C: only the missing verified scaffold inserts (inserted=1)" ($C.inserted -eq 1)
Assert "C: the inserted one is T3" ($C.rows[0].target -eq $T3)

# D — a prior SORRY (failed) row must NOT suppress the verified success
$existD = @([pscustomobject]@{ conjecture_text = $T3; lean_proof_sketch = "theorem two_mul_sum := by sorry" })
$D = Invoke-Reconcile $existD @($s3)
Assert "D: failed/sorry row does not count as 'recorded' -> verified still inserts (inserted=1)" ($D.inserted -eq 1)

# E — fetchVerifiedScaffolds shaping: verified leaf only; sibling sorry excluded
$lemmasE = @(
  [pscustomobject]@{ is_leaf = $true; lean_status = "lean_verified"; code = "theorem good_leaf : True := by trivial" },
  [pscustomobject]@{ is_leaf = $true; lean_status = "lean_stated";   code = "theorem bad_leaf : P := by sorry" },
  [pscustomobject]@{ is_leaf = $false; lean_status = "scaffolded";   code = $null }
)
$sketchE = Get-VerifiedSketch $lemmasE
Assert "E: shaped sketch keeps the verified leaf code" ($sketchE -like "*good_leaf*")
Assert "E: shaped sketch EXCLUDES the sibling sorry leaf" (-not ($sketchE -match '\bsorry\b'))
Assert "E: shaped sketch classifies as SUCCESS" (-not (Test-FailedOutcome $sketchE))

# F — degenerate verified leaf with no code -> reconcile coerces to non-failed success
$F = Invoke-Reconcile @() @([pscustomobject]@{ target = "T-nocode"; sketch = $null })
Assert "F: null-sketch verified scaffold still inserts (inserted=1)" ($F.inserted -eq 1)
Assert "F: coerced sketch is the non-failed 'lean_verified' marker" ($F.rows[0].sketch -eq "lean_verified")
Assert "F: coerced row classifies as SUCCESS" (-not (Test-FailedOutcome $F.rows[0].sketch))

# G — within-batch duplicate targets dedupe to one
$G = Invoke-Reconcile @() @(
  [pscustomobject]@{ target = "Tdup"; sketch = "theorem a := by trivial" },
  [pscustomobject]@{ target = "Tdup"; sketch = "theorem b := by trivial" }
)
Assert "G: duplicate targets within one batch insert once (inserted=1)" ($G.inserted -eq 1)

# H — blank / whitespace targets are skipped
$H = Invoke-Reconcile @() @(
  [pscustomobject]@{ target = "   "; sketch = "x" },
  [pscustomobject]@{ target = "";    sketch = "y" }
)
Assert "H: blank/whitespace targets are skipped (inserted=0)" ($H.inserted -eq 0)

# I — isFailedOutcome classification table
Assert "I: null sketch -> failed"            (Test-FailedOutcome $null)
Assert "I: empty sketch -> failed"           (Test-FailedOutcome "")
Assert "I: whitespace sketch -> failed"      (Test-FailedOutcome "   ")
Assert "I: real proof code -> success"       (-not (Test-FailedOutcome "theorem x : True := by trivial"))
Assert "I: 'by sorry' -> failed"             (Test-FailedOutcome "theorem y : P := by sorry")
Assert "I: uppercase SORRY -> failed (ci)"   (Test-FailedOutcome "-- SORRY left here")

Write-Host ""
if ($fail -eq 0) { Write-Host "B111 MIRROR: ALL PASS" -ForegroundColor Green; exit 0 }
else             { Write-Host "B111 MIRROR: $fail FAILED" -ForegroundColor Red; exit 1 }
