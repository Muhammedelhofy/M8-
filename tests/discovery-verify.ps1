# M8 Phase 4 — Computational Discovery Loop: detection + note-builder + routing port (no-node)
# Ports the LOAD-BEARING logic of lib/discovery.js + the orchestrator fuse so the
# integrity-critical behaviour is locked before deploy:
#   (1) detectDiscovery — fires on a bounded research check / log-intent run;
#       does NOT fire on plain compute, plain notebook writes/reads, fleet, chat.
#   (2) buildDiscoveryNote ladder — evidence vs counterexample from the COMPUTED
#       response; NOTHING logged on a fallback / no-execution response.
#   (3) routing — discovery suppresses the notebook slot + search; not streamable;
#       toolDecision ladder (fleet > finance > eosb > state > discovery > notebook).
#   (4) framing — the directive ships evidence-not-proof + ledger-ack lines.
# ASCII only (PowerShell 5.1 mangles multibyte in a no-BOM .ps1).
#   Run:  powershell -File tests/discovery-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}
$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---- ported regexes (lib/discovery.js) ----
$RUN_VERB  = '\b(verify|check|test|explore|search|scan|run|confirm|probe|compute)\b'
$TARGET    = '\b(conjecture|hypothesis|collatz|goldbach|twin\s+primes?|primes?|perfect\s+numbers?|abundant|amicable|fibonacci|oeis|sequence|riemann|mersenne|fermat|abc\s+conjecture|beal|counterexamples?|digit\s+sums?|happy\s+numbers?|palindrom)\b'
$BOUND     = '\b(?:up\s+to|below|under|first|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|k|m))?|10\s*\^\s*\d+|1e\d+|2\s*\^\s*\d+)\b'
$LOG_INTENT= '\b(?:log|record|save|capture|note|write)\b[^.?!]{0,40}\b(?:notebook|ledger|finding|result|outcome|evidence)\b|\bnotebook\b'
function DetectDiscovery($s) {
  if ($s.Trim().Length -lt 8) { return $false }
  if (-not [regex]::IsMatch($s, $RUN_VERB, $IC)) { return $false }
  if (-not [regex]::IsMatch($s, $TARGET, $IC))   { return $false }
  $hasBound = [regex]::IsMatch($s, $BOUND, $IC)
  $hasLog   = [regex]::IsMatch($s, $LOG_INTENT, $IC)
  return ($hasBound -or $hasLog)
}

Write-Host "== (1) detectDiscovery: bounded research checks fire; everything else doesn't ==" -ForegroundColor Cyan
Check "verify collatz up to 100000"          (DetectDiscovery "verify the Collatz conjecture up to 100000")                       $true
Check "check goldbach below 10^6"            (DetectDiscovery "check Goldbach holds for every even number below 10^6")            $true
Check "explore twin primes 1e7 + log"        (DetectDiscovery "explore twin primes up to 1e7 and log what you find")              $true
Check "scan first 50000 + notebook"          (DetectDiscovery "scan the first 50000 integers for abundant numbers, notebook it")  $true
Check "verify collatz + log (no bound)"      (DetectDiscovery "verify the collatz conjecture and log the result to the notebook") $true
# negatives — each missing a leg of the AND
Check "plain compute (7^13) -> no"           (DetectDiscovery "what is 7 to the power of 13?")                  $false
Check "notebook write -> no"                 (DetectDiscovery "log a conjecture on collatz: every sequence reaches 1") $false
Check "notebook read -> no"                  (DetectDiscovery "where are we on the collatz research?")          $false
Check "fleet -> no"                          (DetectDiscovery "verify the fleet net for June 6")                $false
Check "chat -> no"                           (DetectDiscovery "what do you think about hiring 20 drivers?")     $false
Check "unbounded discuss -> no"              (DetectDiscovery "tell me about the collatz conjecture")           $false

# ---- (2) buildDiscoveryNote ladder ----
$EXEC   = '\bcomput|python|ran\s+(?:the\s+)?code|execut|sandbox|code\s+execution'
$CE     = '\bcounter\s*-?\s*examples?\s+(?:found|at|exists?|discovered)|\bfails?\s+(?:at|for)\s+n?\s*=?\s*\d|\bfound\s+a\s+counter\s*-?\s*example\b|\brefuted\b'
$NO_CE  = '\bno\s+counter\s*-?\s*examples?\b|\bholds?\s+(?:for|up\s+to|through)\b|\ball\s+(?:cases|values|numbers)\s+(?:checked|verified|passed)|\bverified\s+(?:up\s+to|through|for)\b'
function NoteKind($resp) {
  if ($resp.Trim().Length -lt 40) { return '' }
  if (-not [regex]::IsMatch($resp, $EXEC, $IC)) { return '' }
  $foundCe = ([regex]::IsMatch($resp, $CE, $IC)) -and (-not [regex]::IsMatch($resp, $NO_CE, $IC))
  if ($foundCe) { return 'counterexample' } else { return 'evidence' }
}
Write-Host "== (2) buildDiscoveryNote: evidence vs counterexample; nothing on a failed run ==" -ForegroundColor Cyan
Check "clean run -> evidence" (NoteKind "I ran the code in Python and verified the conjecture holds for all n up to 100,000 - no counterexamples were found in the run.") "evidence"
Check "counterexample -> counterexample" (NoteKind "Ran the code: a counterexample found at n = 8424432925592889329288197322308900672459420460792433 - the conjecture is refuted at that value.") "counterexample"
Check "'no counterexamples' NOT misread"  (NoteKind "Executed the check in the sandbox: no counterexamples up to 1e6; it holds for every n tested.") "evidence"
Check "no exec marker -> NOT logged"      (NoteKind "The Collatz conjecture is a famous open problem; I believe it holds for small numbers based on what I recall reading.") ""
Check "fallback/short -> NOT logged"      (NoteKind "I'm having trouble connecting right now.") ""

# ---- (3) routing: discovery owns the fused turn ----
# (a) notebook slot is SKIPPED when discovery fires: if (!discoveryMode) { buildNotebookContext() }
function NotebookComputed($discovery) { return (-not $discovery) }
# (b) search slot: intent!=NONE && !computeMode && !discoveryMode && ... -> fires
function SearchEligible($intentNone, $computeMode, $discovery) {
  return ((-not $intentNone) -and (-not $computeMode) -and (-not $discovery))
}
# (c) streamable excludes discovery even when openProblem co-fires
function Streamable($discovery, $openProblem) { return ((-not $discovery) -and $openProblem) }
# (d) toolDecision ladder
function ToolDecision($fleet, $finance, $eosb, $state, $discovery, $notebook, $compute) {
  if ($fleet) { return 'fleet' } elseif ($finance) { return 'finance' } elseif ($eosb) { return 'eosb' }
  elseif ($state) { return 'state' } elseif ($discovery) { return 'discovery' } elseif ($notebook) { return 'notebook' }
  elseif ($compute) { return 'compute' } else { return 'answer' }
}
Write-Host "== (3) routing precedence: discovery suppresses notebook/search; not streamable ==" -ForegroundColor Cyan
Check "discovery -> notebook slot skipped"   (NotebookComputed $true)  $false
Check "no discovery -> notebook runs"        (NotebookComputed $false) $true
Check "discovery suppresses search"          (SearchEligible $false $false $true)  $false
Check "plain research query still searches"  (SearchEligible $false $false $false) $true
Check "discovery+openProblem NOT streamable" (Streamable $true $true)  $false
Check "openProblem alone streamable"         (Streamable $false $true) $true
Check "toolDecision discovery"               (ToolDecision $false $false $false $false $true $false $true) "discovery"
Check "fleet beats discovery"                (ToolDecision $true  $false $false $false $true $false $false) "fleet"
Check "discovery beats notebook"             (ToolDecision $false $false $false $false $true $true  $false) "discovery"
Check "discovery beats compute"              (ToolDecision $false $false $false $false $true $false $true) "discovery"

# ---- (4) framing shipped in the source ----
Write-Host "== (4) load-bearing framing present in lib/discovery.js + orchestrator ==" -ForegroundColor Cyan
$src = Get-Content -Raw "$PSScriptRoot/../lib/discovery.js"
$orc = Get-Content -Raw "$PSScriptRoot/../lib/orchestrator.js"
function SrcHas($name, $hay, $needle) { if ($hay.Contains($needle)) { $script:pass++ } else { $script:fail++; Write-Host "  FAIL: $name (missing '$needle')" -ForegroundColor Red } }
SrcHas "evidence-not-proof rule"  $src 'EVIDENCE, never a proof'
SrcHas "never-proven wording ban" $src 'NEVER "proven"'
SrcHas "ledger ack line"          $src 'recorded to the research notebook thread'
SrcHas "provenance marker"        $src 'auto-logged from a code-execution run'
SrcHas "failed-run logs nothing"  $src 'no evidence a run actually happened'
SrcHas "orch: post-LLM staging"   $orc 'buildDiscoveryNote({ message, response'
SrcHas "orch: openProblem skip"   $orc 'openProblem && !discoveryMode'

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
