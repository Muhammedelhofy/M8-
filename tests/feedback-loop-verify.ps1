# Build-55 -- M4 Feedback Loop Verify
# PS mirror of shouldRetryLeaf() + the dischargeLeaf bounded-repair loop stop logic.
# Pure ASCII. Run from anywhere; no Node, no network.
# Usage: powershell -ExecutionPolicy Bypass -File feedback-loop-verify.ps1

$pass = 0; $fail = 0
function Check($label, $got, $want) {
  if ($got -eq $want) { $script:pass++; Write-Host "  PASS $label" }
  else { $script:fail++; Write-Host "  FAIL $label  got='$got'  want='$want'" }
}
function CheckTrue($label, $got) { Check $label $got $true }
function CheckFalse($label, $got) { Check $label $got $false }

# ---- mirror of shouldRetryLeaf(kind, repairsUsed) --------------------------
# JS: RETRYABLE_LEAN_KINDS = {"lean_rejected"};
#     shouldRetryLeaf = RETRYABLE.has(kind) && repairsUsed < maxRepairs
function ShouldRetry($kind, $repairsUsed, $maxRepairs) {
  if ($kind -ne "lean_rejected") { return $false }
  return ($repairsUsed -lt $maxRepairs)
}

Write-Host "`n=== shouldRetryLeaf truth table (maxRepairs=2) ==="
CheckTrue  "rejected, 0 used"          (ShouldRetry "lean_rejected" 0 2)
CheckTrue  "rejected, 1 used"          (ShouldRetry "lean_rejected" 1 2)
CheckFalse "rejected, 2 used (budget)" (ShouldRetry "lean_rejected" 2 2)
CheckFalse "verified never retries"    (ShouldRetry "lean_verified" 0 2)
CheckFalse "stated (sorry) never"      (ShouldRetry "lean_stated"   0 2)
CheckFalse "pending (cold) never"      (ShouldRetry "lean_pending"  0 2)
CheckFalse "error never"               (ShouldRetry "lean_error"    0 2)
CheckFalse "unformalizable never"      (ShouldRetry "lean_unformalizable" 0 2)

Write-Host "`n=== budget edges ==="
CheckFalse "maxRepairs=0 disables"     (ShouldRetry "lean_rejected" 0 0)
CheckTrue  "maxRepairs=1 allows first" (ShouldRetry "lean_rejected" 0 1)
CheckFalse "maxRepairs=1 stops after"  (ShouldRetry "lean_rejected" 1 1)
CheckTrue  "maxRepairs=4 deep"         (ShouldRetry "lean_rejected" 3 4)

# ---- mirror of the dischargeLeaf while-loop ---------------------------------
# Each attempt past the first is one redraft+recheck. Model the sequence of
# outcomes as a list. Each item: a kind, plus draftOk/screenOk/checkOk flags
# describing whether THAT redraft produced usable code that reached a verdict.
#   - draftFail : draftLeaf threw            -> break, keep prior verdict
#   - badRewrite: unformalizable/banned      -> break, keep prior verdict
#   - coldMiss  : recheck not ok (pending)   -> break, keep prior verdict
#   - ok        : recheck ok -> adopt this attempt's kind
# Returns "<finalKind>:<repairs>".
function SimulateDischarge($initialKind, $attempts, $maxRepairs) {
  $kind = $initialKind
  $repairs = 0
  foreach ($a in $attempts) {
    if (-not (ShouldRetry $kind $repairs $maxRepairs)) { break }
    $repairs++
    switch ($a.type) {
      "draftFail"  { return "$kind`:$repairs" }   # break w/ this repair counted
      "badRewrite" { return "$kind`:$repairs" }
      "coldMiss"   { return "$kind`:$repairs" }
      "ok"         { $kind = $a.kind }             # adopt new verdict, loop may continue
    }
  }
  return "$kind`:$repairs"
}

Write-Host "`n=== loop: converge to verified ==="
# rejected -> repair#1 verifies -> stop (verified is not retryable)
$r = SimulateDischarge "lean_rejected" @(@{type="ok";kind="lean_verified"}) 2
Check "1 repair -> verified" $r "lean_verified:1"

# rejected -> repair#1 still rejected -> repair#2 verifies -> stop
$r = SimulateDischarge "lean_rejected" @(@{type="ok";kind="lean_rejected"}, @{type="ok";kind="lean_verified"}) 2
Check "2 repairs -> verified" $r "lean_verified:2"

Write-Host "`n=== loop: exhaust budget ==="
# rejected the whole way; default 2 -> 2 repairs then stop, still rejected
$r = SimulateDischarge "lean_rejected" @(@{type="ok";kind="lean_rejected"}, @{type="ok";kind="lean_rejected"}, @{type="ok";kind="lean_verified"}) 2
Check "budget caps at 2 (verify on 3rd never reached)" $r "lean_rejected:2"

Write-Host "`n=== loop: fail-safe stops keep last verdict ==="
# first redraft hits a cold checker -> stop after 1 repair, verdict still rejected
$r = SimulateDischarge "lean_rejected" @(@{type="coldMiss"}) 2
Check "cold miss stops, keeps rejected" $r "lean_rejected:1"
# first redraft is a worse (banned) rewrite -> stop, keep rejected
$r = SimulateDischarge "lean_rejected" @(@{type="badRewrite"}) 2
Check "bad rewrite stops, keeps rejected" $r "lean_rejected:1"
# draft throws -> stop, keep rejected
$r = SimulateDischarge "lean_rejected" @(@{type="draftFail"}) 2
Check "draft fail stops, keeps rejected" $r "lean_rejected:1"
# adopted a stated (sorry) on repair#1 -> stated is not retryable -> stop
$r = SimulateDischarge "lean_rejected" @(@{type="ok";kind="lean_stated"}, @{type="ok";kind="lean_verified"}) 2
Check "redraft yields honest sorry -> stop (no retry of stated)" $r "lean_stated:1"

Write-Host "`n=== loop: never enters for non-rejected initial verdict ==="
$r = SimulateDischarge "lean_verified" @(@{type="ok";kind="lean_rejected"}) 2
Check "initial verified -> 0 repairs" $r "lean_verified:0"
$r = SimulateDischarge "lean_stated" @(@{type="ok";kind="lean_verified"}) 2
Check "initial stated (sorry) -> 0 repairs" $r "lean_stated:0"
$r = SimulateDischarge "lean_pending" @(@{type="ok";kind="lean_verified"}) 2
Check "initial pending -> 0 repairs" $r "lean_pending:0"

Write-Host "`n=== legacy parity: maxRepairs=1 == old single repair ==="
$r = SimulateDischarge "lean_rejected" @(@{type="ok";kind="lean_verified"}) 1
Check "legacy: 1 repair to verified" $r "lean_verified:1"
$r = SimulateDischarge "lean_rejected" @(@{type="ok";kind="lean_rejected"}, @{type="ok";kind="lean_verified"}) 1
Check "legacy: stops after 1 (2nd never reached)" $r "lean_rejected:1"

Write-Host "`n=== disabled: maxRepairs=0 ==="
$r = SimulateDischarge "lean_rejected" @(@{type="ok";kind="lean_verified"}) 0
Check "disabled: 0 repairs, keeps rejected" $r "lean_rejected:0"

# ---- source sanity: the helper + loop exist in lib/lemma-dag.js -------------
Write-Host "`n=== source sanity (lib/lemma-dag.js) ==="
$src = Get-Content "$PSScriptRoot\..\lib\lemma-dag.js" -Raw
Check "exports shouldRetryLeaf"        ($src.Contains("shouldRetryLeaf")) $true
Check "has MAX_LEAF_REPAIRS"           ($src.Contains("MAX_LEAF_REPAIRS")) $true
Check "reads M4_MAX_LEAF_REPAIRS env"  ($src.Contains("M4_MAX_LEAF_REPAIRS")) $true
Check "only lean_rejected retryable"   ($src.Contains('RETRYABLE_LEAN_KINDS = new Set(["lean_rejected"])')) $true
Check "while-loop on shouldRetryLeaf"  ($src.Contains("while (shouldRetryLeaf(result.kind, repairs))")) $true
Check "logs repairs count"             ($src.Contains("leanKind: result.kind, repairs")) $true

# ---- summary ---------------------------------------------------------------
Write-Host "`n=== SUMMARY: $pass passed, $fail failed ==="
if ($fail -gt 0) { exit 1 } else { exit 0 }
