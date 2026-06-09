# M8 L4 Build-4 — Tool Decision Layer: control-flow port verification
# No-node check (project standard). Mirrors the two boolean ladders added to
# lib/orchestrator.js so the INTEGRITY-CRITICAL precedence is verified before
# deploy:
#   (1) router eligibility — when does the LLM tool-decision layer get to run?
#       The LLM must NEVER reach a turn already claimed by a deterministic
#       hard-route (fleet/state/open-problem/build) or a conversational opener.
#   (2) toolDecision label — which truth-tool gets credited (fleet wins over
#       everything; compute over search; etc.).
# Pure ASCII on purpose (PowerShell 5.1 mangles multibyte in a no-BOM .ps1).
#   Run:  powershell -File tests/tool-decision-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ($got -eq $expected) { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}

# ---- (1) router-eligibility ladder (orchestrator.js ~L513) ----
# if (intent==NONE && !computeMode && !personal && !conversational
#     && !fleet && !state && !openProblem && !buildQuery)
function RouterEligible($intentNone, $computeMode, $personal, $conversational, $fleet, $state, $openProblem, $buildQuery) {
  return ($intentNone -and -not $computeMode -and -not $personal -and -not $conversational `
    -and -not $fleet -and -not $state -and -not $openProblem -and -not $buildQuery)
}

# ---- (2) toolDecision ladder (orchestrator.js ~L755) ----
function ToolDecision($fleet, $state, $computeMode, $routerCompute, $searchFired, $openProblem, $buildQuery) {
  if ($fleet)                          { return "fleet" }
  elseif ($state)                      { return "state" }
  elseif ($computeMode -or $routerCompute) { return "compute" }
  elseif ($searchFired)                { return "search" }
  elseif ($openProblem)                { return "open_problem" }
  elseif ($buildQuery)                 { return "build_state" }
  else                                 { return "answer" }
}

# ---- (3) SEARCH-slot eligibility (Build-6 compute/search gate, orchestrator.js ~L560) ----
# if (intent!=NONE && !computeMode && !fleet && !fleetLike && !state)  -> web search fires.
# The !computeMode term is the gate: a self-contained computation suppresses search
# so a computed number is never laundered with a phantom web citation.
function SearchEligible($intentNone, $computeMode, $fleet, $fleetLike, $state) {
  return ((-not $intentNone) -and -not $computeMode -and -not $fleet -and -not $fleetLike -and -not $state)
}

Write-Host "== (1) Router eligibility (the LLM tool-decision layer only fires in the safe slice) ==" -ForegroundColor Cyan
# plain knowledge question -> eligible
Check "knowledge-Q eligible"        (RouterEligible $true  $false $false $false $false $false $false $false) $true
# fleet hard-route -> NOT eligible (integrity moat: LLM can't route away from fleet)
Check "fleet not eligible"          (RouterEligible $true  $false $false $false $true  $false $false $false) $false
# conversational opener -> NOT eligible (must NOT be hijacked to a tool)
Check "conversational not eligible" (RouterEligible $true  $false $false $true  $false $false $false $false) $false
# personal -> NOT eligible (goes to memory)
Check "personal not eligible"       (RouterEligible $true  $false $true  $false $false $false $false $false) $false
# regex compute already fired -> NOT eligible (fast-path already chose the tool)
Check "computeMode skips router"    (RouterEligible $true  $true  $false $false $false $false $false $false) $false
# state engine claimed it -> NOT eligible
Check "state not eligible"          (RouterEligible $true  $false $false $false $false $true  $false $false) $false
# open problem -> NOT eligible (deterministic honesty hard-route)
Check "open-problem not eligible"   (RouterEligible $true  $false $false $false $false $false $true  $false) $false
# build/meta -> NOT eligible
Check "build-query not eligible"    (RouterEligible $true  $false $false $false $false $false $false $true ) $false
# a regex intent (not NONE) -> NOT eligible (deterministic search/clarify owns it)
Check "non-NONE intent not eligible"(RouterEligible $false $false $false $false $false $false $false $false) $false

Write-Host "== (2) toolDecision precedence (fleet wins; compute over search) ==" -ForegroundColor Cyan
Check "answer (no tool)"        (ToolDecision $false $false $false $false $false $false $false) "answer"
Check "fleet"                   (ToolDecision $true  $false $false $false $false $false $false) "fleet"
Check "state"                   (ToolDecision $false $true  $false $false $false $false $false) "state"
Check "compute via regex"       (ToolDecision $false $false $true  $false $false $false $false) "compute"
Check "compute via router"      (ToolDecision $false $false $false $true  $false $false $false) "compute"
Check "search"                  (ToolDecision $false $false $false $false $true  $false $false) "search"
Check "open_problem"            (ToolDecision $false $false $false $false $false $true  $false) "open_problem"
Check "build_state"             (ToolDecision $false $false $false $false $false $false $true ) "build_state"
# INTEGRITY precedence: fleet beats a stray compute/search flag on the same turn
Check "fleet beats compute"     (ToolDecision $true  $false $true  $false $false $false $false) "fleet"
Check "fleet beats search"      (ToolDecision $true  $false $false $false $true  $false $false) "fleet"
Check "compute beats search"    (ToolDecision $false $false $false $true  $true  $false $false) "compute"

Write-Host "== (3) compute/search gate (Build-6: compute owns its number -> search suppressed) ==" -ForegroundColor Cyan
# normal RESEARCH/LOOKUP query, no compute -> search fires
Check "research query searches"      (SearchEligible $false $false $false $false $false) $true
# THE FIX: a math query also tagged RESEARCH (computeMode true) -> search SUPPRESSED (no co-fire)
Check "compute suppresses search"    (SearchEligible $false $true  $false $false $false) $false
# fleet/state still own their turns (search never fires there)
Check "fleet no search"              (SearchEligible $false $false $true  $false $false) $false
Check "fleetLike no search"          (SearchEligible $false $false $false $true  $false) $false
Check "state no search"              (SearchEligible $false $false $false $false $true ) $false
# a NONE-intent query is the LLM router's slice, not the regex search slot
Check "NONE intent not regex-search" (SearchEligible $true  $false $false $false $false) $false
# compound 'search a live value then compute': primary signal is search, regex compute did NOT fire -> search still runs
Check "compound search+compute runs" (SearchEligible $false $false $false $false $false) $true

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
