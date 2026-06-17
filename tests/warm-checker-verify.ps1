# Build-51 -- Warm-Checker Verify
# PS mirror of the VERIFY_NOW_RE regex, narrateWarmPending structure,
# and the warm-gate decision logic.
# Pure ASCII. Run from anywhere; no Node, no network.
# Usage: powershell -ExecutionPolicy Bypass -File warm-checker-verify.ps1

$pass = 0; $fail = 0
function Check($label, $got, $want) {
  if ($got -eq $want) { $script:pass++; Write-Host "  PASS $label" }
  else { $script:fail++; Write-Host "  FAIL $label  got='$got'  want='$want'" }
}
function CheckTrue($label, $got) { Check $label $got $true }
function CheckFalse($label, $got) { Check $label $got $false }

# ---- mirror of VERIFY_NOW_RE ------------------------------------------------
$RE = [regex]'(?i)\b(?:verify\s+(?:now|lea(?:f|ves?)|it|them)|check\s+lea(?:f|ves?)|recheck|re-?verify|go\s+ahead(?:\s+(?:with\s+lean|lean))?|lean\s+(?:now|ready|go)|run\s+(?:the\s+)?(?:lean|lea(?:f|ves?)))\b'

function vnow($s) { return $RE.IsMatch($s) }

Write-Host "`n=== VERIFY_NOW_RE positives ==="
CheckTrue  "verify now"             (vnow "verify now")
CheckTrue  "verify leaves"          (vnow "verify leaves")
CheckTrue  "verify it"              (vnow "verify it")
CheckTrue  "verify them"            (vnow "verify them")
CheckTrue  "check leaves"           (vnow "check leaves")
CheckTrue  "check leaf"             (vnow "check leaf")
CheckTrue  "recheck"                (vnow "recheck")
CheckTrue  "re-verify"              (vnow "re-verify")
CheckTrue  "reverify"               (vnow "reverify")
CheckTrue  "go ahead with lean"     (vnow "go ahead with lean")
CheckTrue  "go ahead lean"          (vnow "go ahead lean")
CheckTrue  "go ahead"               (vnow "go ahead")
CheckTrue  "lean now"               (vnow "lean now")
CheckTrue  "lean ready"             (vnow "lean ready")
CheckTrue  "lean go"                (vnow "lean go")
CheckTrue  "run the lean"           (vnow "run the lean")
CheckTrue  "run lean"               (vnow "run lean")
CheckTrue  "run the leaves"         (vnow "run the leaves")
CheckTrue  "run leaves"             (vnow "run leaves")
CheckTrue  "OK verify leaves now"   (vnow "OK verify leaves now")

Write-Host "`n=== VERIFY_NOW_RE negatives (must NOT match) ==="
CheckFalse "bare verify"            (vnow "verify")
CheckFalse "verify today earnings"  (vnow "verify today's earnings")
CheckFalse "verify in lean: X"      (vnow "verify in lean: 2+2=4")
CheckFalse "check the fleet"        (vnow "check the fleet")
CheckFalse "please check drivers"   (vnow "please check the drivers")
CheckFalse "fleet earnings"         (vnow "run the fleet earnings report")
CheckFalse "go"                     (vnow "go")
CheckFalse "ready for shift"        (vnow "ready for shift")
CheckFalse "lean on something"      (vnow "lean on something")

# ---- narrateWarmPending structure ------------------------------------------
Write-Host "`n=== narrateWarmPending structure ==="
# Mirrors: returns multi-line string with these required substrings
$id = 7
$lines = @(
  "The Lean checker is starting up from cold",
  "wake-up ping",
  "60 seconds",
  'Decomposition #${id}',
  "nothing has been formalized",
  "verify now"
)
# We can't run JS, so we verify the EXPECTED strings are present
# in the authoritative source as a sanity check on the file itself.
$src = Get-Content "$PSScriptRoot\..\lib\decomp-proposer.js" -Raw
foreach ($line in $lines) {
  $found = $src.Contains($line)
  Check "narrateWarmPending contains '$line'" $found $true
}

# ---- warm-gate decision logic ----------------------------------------------
Write-Host "`n=== warm-gate logic (mock) ==="
# mirrors approveProposal's warm gate:
#   warm=true  -> proceeds to scaffold
#   warm=false -> returns narrateWarmPending

function mockApprove($warmReady, $id) {
  # row assumed found + not approved
  if (-not $warmReady) {
    return "cold:$id"   # stands in for narrateWarmPending(id)
  }
  return "scaffold:$id" # stands in for scaffoldProof call
}

Check "warm=true  -> scaffold" (mockApprove $true  3) "scaffold:3"
Check "warm=false -> cold msg" (mockApprove $false 3) "cold:3"
Check "warm=true  -> scaffold" (mockApprove $true  9) "scaffold:9"
Check "warm=false -> cold msg" (mockApprove $false 9) "cold:9"

# ---- verify_now detection integration ------------------------------------
Write-Host "`n=== verify_now detection integration ==="
# mirrors detectDecompProposal order:
#   APPROVE_RE fires first, then VERIFY_NOW_RE, then PROPOSE_RE

$APPROVE = [regex]'(?i)\bapprove\b[^?.!]{0,40}\b(?:decomposition|attack(?:\s+plan)?|plan|lemma[- ]?dag|proposal)\b[^?.!#\d]{0,12}#?\s*(\d+)'
$PROPOSE_VERB = "(?i)(?:propose|draft|suggest|sketch|outline|plan|decompose|break\s+(?:down|up))"
$PROPOSE_OBJ  = "(?i)(?:decomposition|attack(?:\s+plan)?|lemma[- ]?dag|sub-?lemmas|proof\s+(?:plan|sketch|strategy|outline|attack)|into\s+(?:sub-?)?lemmas)"

function detectMode($s) {
  if ($APPROVE.IsMatch($s)) { return "approve" }
  if ($RE.IsMatch($s))       { return "verify_now" }
  if ($s -match $PROPOSE_VERB -and $s -match $PROPOSE_OBJ) { return "propose" }
  return "null"
}

Check "approve decomp #3"      (detectMode "approve decomposition #3")   "approve"
Check "approve attack plan #1" (detectMode "approve attack plan #1")     "approve"
Check "verify now"             (detectMode "verify now")                 "verify_now"
Check "check leaves"           (detectMode "check leaves")               "verify_now"
Check "propose a decomp for X" (detectMode "propose a decomposition for: Collatz") "propose"
Check "fleet earnings"         (detectMode "run the fleet earnings")     "null"
Check "bare hello"             (detectMode "hello")                      "null"

# ---- summary ---------------------------------------------------------------
Write-Host "`n=== SUMMARY: $pass passed, $fail failed ==="
if ($fail -gt 0) { exit 1 } else { exit 0 }
