# M8 Research Notebook — detection + routing port verification (no-node, project standard)
# Faithfully ports the load-bearing logic of lib/notebook.js (detectNotebook ->
# mode + kind) and the orchestrator gate ladders updated for the notebook slot, so
# the INTEGRITY-CRITICAL behaviour is verified before deploy (a syntax error only
# shows up as a Vercel build failure; this catches the LOGIC).
#
#   (1) detection: a "log a conjecture/dead-end/..." or "where are we on the
#       research notebook" message classifies as the right (mode, kind); ordinary
#       chat ("note: buy milk", "give me the morning brief") classifies as neither.
#   (2) gate ladders: a notebook turn is a HARD-ROUTE — the LLM router + web search
#       never fire on it, and the toolDecision label credits 'notebook' (fleet/state
#       still win above it).
# Pure ASCII on purpose (PowerShell 5.1 mangles multibyte in a no-BOM .ps1).
#   Run:  powershell -File tests/notebook-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}

$IC  = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
$ICS = [System.Text.RegularExpressions.RegexOptions]'IgnoreCase, Singleline'

# ---- ported regex constants (mirror lib/notebook.js; em-dash dropped for ASCII) ----
$KIND_ALT = '(conjecture|hypothesis|evidence(?:\s+(?:for|against|supporting|refuting))?|counter\s*-?\s*example|dead[\s-]?end|next[\s-]?step|status(?:\s+update)?|finding|observation|result|lead|idea|note)'
$WRITE_COLON   = '^' + $KIND_ALT + '\s*[:\-]\s*(.+)$'
$WRITE_VERB    = '\b(?:log|record|note|jot(?:\s+down)?|capture|save|add|write\s+down|put\s+(?:in|into)(?:\s+the\s+notebook)?)\s+(?:a\s+|an\s+|the\s+|this\s+|that\s+|new\s+|down\s+)*' + $KIND_ALT + '\b\s*(?:[:\-]\s*|that\s+)?(.*)$'
$WRITE_STATUS  = '\bmark\b[\s\S]*?\b(?:as\s+)?(resolved|solved|proven?|proved|completed?|refuted|disproved|disproven|false|parked|on\s*hold|shelved|stuck|paused|open|active|reopen(?:ed)?|supported|promising|holding)\b'
$STATUS_CONTEXT   = '\b(thread|conjecture|problem|research|notebook|inquir|investigation|line\s+of\s+inquiry|hypothesis)\b'
$RESEARCH_CONTEXT = '\b(research|notebook|conjectur|hypothes|theorem|proof|lemma|inquir|investigat|experiment|finding|evidence|counter\s*-?\s*example|dead[\s-]?end|next\s+step|prime|sequence|series|axiom|proble)\b'
$READ_DIRECT  = '\bresearch\s+(?:notebook|ledger|memory|notes?|threads?|status|log|progress)\b|\b(?:the\s+|my\s+|our\s+)?notebook\b|\b(?:what|which)\s+(?:dead\s*ends?|conjectures?|counter\s*-?\s*examples?|findings?|evidence|threads?|next\s+steps?)\s+(?:have|did|do|are|were)\b'
$READ_STEM    = '\b(where\s+(?:are|do|did|were)\s+we|what''?s\s+(?:our|the)\s+(?:status|progress|state|latest|standing)|catch\s+me\s+up|pick\s+up\s+where|recap|review|pull\s+up|status\s+of|update\s+me)\b'
$READ_CONTEXT = '\b(research|notebook|ledger|conjectures?|inquir|investigation|dead[\s-]?ends?|line\s+of\s+inquiry|next\s+steps?|findings?|threads?)\b'
$PREFIX       = '^\s*(?:research\s+)?notebook\b[\s:,\-]+'

function CanonKind($raw) {
  $k = ($raw -replace '\s+',' ').ToLower()
  if ([regex]::IsMatch($k,'^(conjecture|hypothesis)',$IC)) { return 'conjecture' }
  if ([regex]::IsMatch($k,'^counter\s*-?\s*example',$IC))  { return 'counterexample' }
  if ([regex]::IsMatch($k,'^dead[\s-]?end',$IC))           { return 'dead_end' }
  if ([regex]::IsMatch($k,'^next[\s-]?step',$IC))          { return 'next_step' }
  if ([regex]::IsMatch($k,'^status',$IC))                  { return 'status' }
  if ([regex]::IsMatch($k,'^evidence',$IC))                { return 'evidence' }
  return 'note'
}
# Build-4 2C port: kind inference for a notebook: statement with no explicit kind
# word. Order mirrors lib/notebook.js INFER_RULES (specific outcomes first).
function InferKind($body) {
  if ([regex]::IsMatch($body,'\bcounter\s*-?\s*examples?\b|\bfound\s+a\s+case\s+where\b|\bbreaks\s+down\s+at\b',$IC)) { return 'counterexample' }
  if ([regex]::IsMatch($body,'\bdead[\s-]?end\b|\bdoesn''?t\s+work\b|\bfailed\b|\btried\s+and\b|\bruled\s+out\b|\bno\s+pattern\b',$IC)) { return 'dead_end' }
  if ([regex]::IsMatch($body,'\bnext\s+step\b|\bshould\s+try\b|\bplan\s+to\b|\bwant\s+to\s+check\b',$IC)) { return 'next_step' }
  if ([regex]::IsMatch($body,'\bi\s+think\b|\bi\s+believe\b|\bhypothes\w*\b|\bconjectur\w*\b|\bpropose\b',$IC)) { return 'conjecture' }
  if ([regex]::IsMatch($body,'\bfound\s+that\b|\bshows\b|\bconfirms\b|\bevidence\s+that\b|\bsupports\b|\bverified\b',$IC)) { return 'evidence' }
  if ([regex]::IsMatch($body,'\bstatus\s+is\b|\bupdate\b|\bcurrently\b',$IC)) { return 'status' }
  return 'note'
}
function GenericBlocked($kind, $body, $forced) {
  return ($kind -eq 'note' -and -not $forced -and -not [regex]::IsMatch($body,$RESEARCH_CONTEXT,$IC))
}
function ParseWrite($body, $forced) {
  $m = [regex]::Match($body,$WRITE_COLON,$ICS)
  if ($m.Success) { $k = CanonKind $m.Groups[1].Value; if (-not (GenericBlocked $k $body $forced)) { return $k } }
  $m = [regex]::Match($body,$WRITE_VERB,$ICS)
  if ($m.Success -and $m.Groups[2].Value.Trim()) { $k = CanonKind $m.Groups[1].Value; if (-not (GenericBlocked $k $body $forced)) { return $k } }
  $m = [regex]::Match($body,$WRITE_STATUS,$IC)
  if ($m.Success -and ($forced -or [regex]::IsMatch($body,$STATUS_CONTEXT,$IC))) { return 'status' }
  return $null
}
function IsRead($body) {
  if ([regex]::IsMatch($body,$READ_DIRECT,$IC)) { return $true }
  if ([regex]::IsMatch($body,$READ_STEM,$IC) -and [regex]::IsMatch($body,$READ_CONTEXT,$IC)) { return $true }
  return $false
}
# Returns "<mode>/<kind>" e.g. "write/conjecture", "read/-", or "none/-".
function DetectMode($msg) {
  $raw = "$msg".Trim()
  if ($raw.Length -lt 2) { return 'none/-' }
  $body = $raw; $forced = $false
  $p = [regex]::Match($raw,$PREFIX,$IC)
  if ($p.Success) { $body = $raw.Substring($p.Length).Trim(); $forced = $true }
  $k = ParseWrite $body $forced
  if ($k) { return "write/$k" }
  if (IsRead $body) { return 'read/-' }
  if ($forced) {
    $looksQuery = (($body -replace '\s','').Length -lt 4) `
      -or [regex]::IsMatch($body,'[?]\s*$') `
      -or [regex]::IsMatch($body,$READ_STEM,$IC) `
      -or [regex]::IsMatch($body,'^(show|list|what|which|where|recap|review|status|open|display|give)\b',$IC)
    if (-not $looksQuery) { return "write/$(InferKind $body)" }
    return 'read/-'
  }
  return 'none/-'
}

Write-Host "== (1) detection: mode + kind classification ==" -ForegroundColor Cyan
# WRITE — research-specific kinds always route
Check "conjecture (verb+on+colon)" (DetectMode "log a conjecture on collatz: every sequence terminates") "write/conjecture"
Check "conjecture (bare colon)"     (DetectMode "conjecture: twin primes are infinite")                  "write/conjecture"
Check "evidence for (verb)"         (DetectMode "record evidence for goldbach: verified to 10^9")          "write/evidence"
Check "evidence against (colon)"    (DetectMode "evidence against: n=27 breaks the pattern")              "write/evidence"
Check "dead end (bare colon)"       (DetectMode "dead end: the sieve approach is too slow")               "write/dead_end"
Check "dead end (verb+on)"          (DetectMode "log a dead end on primes - tried the sieve, too slow")   "write/dead_end"
Check "counterexample (colon)"      (DetectMode "counterexample: 5777 is not a sum of three squares")     "write/counterexample"
Check "next step (colon)"           (DetectMode "next step: extend the search to 10^12")                  "write/next_step"
Check "status (mark + context)"     (DetectMode "mark the collatz thread as resolved")                    "write/status"
# WRITE — under the notebook: prefix
Check "prefix + verb kind"          (DetectMode "notebook: log a counterexample: n=4 fails")              "write/counterexample"
Check "prefix freeform -> note"     (DetectMode "notebook: tried induction on the bound, still stuck")    "write/note"
# WRITE — generic note allowed only with research context / prefix
Check "generic note + research ctx" (DetectMode "note a finding about the prime sequence: gaps widen")     "write/note"
# WRITE — Build-4 2C kind inference (notebook: statement, no explicit kind word)
Check "infer conjecture (I think)"  (DetectMode "notebook: I think every Collatz orbit eventually hits a power of 2") "write/conjecture"
Check "infer dead end (tried+DE)"   (DetectMode "notebook: tried the parity-sequence approach on goldbach, complete dead end") "write/dead_end"
Check "infer evidence (found that)" (DetectMode "notebook: found that all even numbers up to 10^6 split into two primes") "write/evidence"
Check "infer next step (should try)"(DetectMode "notebook: should try a segmented sieve next")             "write/next_step"
Check "infer counterexample"        (DetectMode "notebook: found a case where the bound breaks, n equals 27") "write/counterexample"

Write-Host "== (2) detection: READ classification ==" -ForegroundColor Cyan
Check "read research notebook"      (DetectMode "show me the research notebook")                          "read/-"
Check "read where-are-we + ctx"     (DetectMode "where are we on the conjecture?")                        "read/-"
Check "read what-dead-ends"         (DetectMode "what dead ends have we hit on this problem?")            "read/-"
Check "read catch-me-up + research" (DetectMode "catch me up on our research")                            "read/-"
Check "read prefix + query"         (DetectMode "notebook: where are we on prime gaps")                   "read/-"
Check "read bare prefix"            (DetectMode "notebook:")                                              "read/-"

Write-Host "== (3) detection: NON-notebook turns must NOT route (no false positives) ==" -ForegroundColor Cyan
Check "grocery note not hijacked"   (DetectMode "note: buy milk")                                         "none/-"
Check "take-a-note not hijacked"    (DetectMode "take a note of that for later")                          "none/-"
Check "log into account"            (DetectMode "log into my account please")                            "none/-"
Check "opinion question"            (DetectMode "what do you think about hiring 20 drivers?")             "none/-"
Check "fleet brief"                 (DetectMode "give me the morning brief")                              "none/-"
Check "compute prefix"              (DetectMode "compute: 2 to the power of 50")                          "none/-"
Check "mark w/o research ctx"       (DetectMode "mark the delivery as paused")                            "none/-"
Check "plain chat"                  (DetectMode "the weather in riyadh is nice today")                    "none/-"

# ---- (4) router-eligibility ladder (orchestrator.js): the LLM tool-decision
#         layer only fires in the slice no deterministic hard-route claimed. ----
function RouterEligible($intentNone,$compute,$personal,$conv,$fleet,$state,$notebook,$open,$build) {
  return ($intentNone -and -not $compute -and -not $personal -and -not $conv `
    -and -not $fleet -and -not $state -and -not $notebook -and -not $open -and -not $build)
}
# ---- (5) SEARCH-slot eligibility: a notebook turn suppresses web search. ----
function SearchEligible($intentNone,$compute,$fleet,$fleetLike,$state,$notebook) {
  return ((-not $intentNone) -and -not $compute -and -not $fleet -and -not $fleetLike -and -not $state -and -not $notebook)
}
# ---- (6) toolDecision precedence (fleet/state win above notebook; notebook above compute/search). ----
function ToolDecision($fleet,$state,$notebook,$compute,$routerCompute,$search,$open,$build) {
  if ($fleet)                              { return 'fleet' }
  elseif ($state)                          { return 'state' }
  elseif ($notebook)                       { return 'notebook' }
  elseif ($compute -or $routerCompute)     { return 'compute' }
  elseif ($search)                         { return 'search' }
  elseif ($open)                           { return 'open_problem' }
  elseif ($build)                          { return 'build_state' }
  else                                     { return 'answer' }
}

Write-Host "== (4) router eligibility (notebook is a hard-route the LLM can't override) ==" -ForegroundColor Cyan
Check "knowledge-Q eligible"  (RouterEligible $true  $false $false $false $false $false $false $false $false) $true
Check "notebook not eligible" (RouterEligible $true  $false $false $false $false $false $true  $false $false) $false

Write-Host "== (5) search-slot gate (a notebook turn suppresses web search) ==" -ForegroundColor Cyan
Check "research query searches"   (SearchEligible $false $false $false $false $false $false) $true
Check "notebook suppresses search"(SearchEligible $false $false $false $false $false $true ) $false

Write-Host "== (6) toolDecision precedence ==" -ForegroundColor Cyan
Check "notebook label"        (ToolDecision $false $false $true  $false $false $false $false $false) "notebook"
Check "fleet beats notebook"  (ToolDecision $true  $false $true  $false $false $false $false $false) "fleet"
Check "state beats notebook"  (ToolDecision $false $true  $true  $false $false $false $false $false) "state"
Check "notebook beats compute"(ToolDecision $false $false $true  $true  $false $false $false $false) "notebook"
Check "notebook beats search" (ToolDecision $false $false $true  $false $false $true  $false $false) "notebook"
Check "answer (no tool)"      (ToolDecision $false $false $false $false $false $false $false $false) "answer"

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
