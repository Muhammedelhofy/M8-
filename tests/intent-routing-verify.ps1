# ============================================================================
# M8 Build-40 -- Self-status search-routing guard: PS mirror of SELF_STATUS_RE
# in lib/intentClassifier.js. No local Node, so the regex is mirrored here and
# asserted against the SAME pattern (keep them in lockstep). Pure ASCII.
#   powershell -File tests/intent-routing-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- MIRROR of SELF_STATUS_RE (lib/intentClassifier.js) --------------------
# .NET regex; PowerShell -match is case-insensitive by default.
$SELF_STATUS = '\b(?:(?:most\s+recent|latest|last|current|newest|which|what|your)\s+(?:build|version)\b|what\s+build\s+(?:are|is|was|am)\b|build\s+number\b|(?:your|you''?re|are\s+you)\b[^?.!]{0,30}\b(?:version|capabilit|architecture|trained|knowledge\s+cutoff|able\s+to)\b|what\s+(?:can|do)\s+you\s+(?:do|support|handle)\b|did\s+(?:you|we)\s+(?:build|ship|add|implement|finish)\b)'

function IsSelfStatus([string]$m) { return ($m -match $SELF_STATUS) }

Write-Host "`nM8 Build-40 -- self-status search-routing guard (classifier mirror)`n"

# ---- 1. SELF-STATUS queries MUST match (route to NONE, no web search) ------
$selfStatus = @(
  "what's your most recent build",
  "what is the latest build",
  "which build are you on",
  "what build am i running",
  "what version are you running",
  "which version is this",
  "what can you do",
  "what do you support",
  "are you able to read images",
  "what is your knowledge cutoff",
  "did we ship the search routing fix",
  "did you build the trust tiers",
  "build number please"
)
foreach ($q in $selfStatus) { Ok (IsSelfStatus $q) ("self-status -> match: '$q'") }

# ---- 2. External NEWS/LOOKUP queries MUST NOT match (stay searchable) ------
$external = @(
  "latest keeta news",
  "recent updates from bolt ksa",
  "what happened in the saudi logistics sector this week",
  "best school near munsiyah riyadh",
  "did keeta launch in bahrain",
  "has noon food expanded to north riyadh",
  "price of iphone 16 in saudi arabia",
  "explain rider utilization metrics",
  "summarize atomic habits book",
  "build me a plan for next quarter",
  "latest exchange rate sar to egp"
)
foreach ($q in $external) { Ok (-not (IsSelfStatus $q)) ("external -> NO match: '$q'") }

# ---- 3. the canonical documented misroute ----------------------------------
Ok (IsSelfStatus "what's your most recent build?") "REGRESSION: the documented 'most recent build' misroute is now guarded"
Ok (-not (IsSelfStatus "latest keeta news"))       "REGRESSION: 'latest keeta news' still routes to NEWS (not stolen)"

Write-Host ("`n==== intent-routing-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
