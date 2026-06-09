# M8 Fleet-routing fix - PowerShell .NET-regex verification port
# Mirrors isFleetQuery() FLEET_PATTERNS in lib/fleet.js (the gate that feeds
# looksFleet -> directFleet -> the orchestrator's fleetLike search-suppression).
# Verifies the period-over-period / pace patterns route "compare this week to
# last" / "on track to beat last week" to the deterministic spine instead of a
# web search, WITHOUT grabbing generic chat. No local node (cloud build). Run:
#   powershell -File tests/fleet-routing-verify.ps1
# Pure-ASCII (PS 5.1 mangles the Arabic FLEET pattern; ASCII inputs exercise the
# same English logic; the Arabic alternation is dropped from this port).

$ErrorActionPreference = 'Stop'
$opts = [Text.RegularExpressions.RegexOptions]::IgnoreCase

# -- ported FLEET_PATTERNS (English subset; keep in sync with lib/fleet.js) --
$FLEET = @(
  '\bfleet\b'
  '\bdrivers?\b'
  '\bcaptains?\b'
  '\bcouriers?\b'
  '\briders?\b'
  '\bbikes?\b'
  '\b(top|best|worst|bottom|lowest|highest)\s+(earner|driver|performer|captain|courier|rider)'
  '\b(utilis|utiliz)ation\b'
  '\bacceptance rate\b'
  '\bfinish rate\b'
  '\b(net|gross|my|our|fleet|daily|weekly|monthly|today''?s?|yesterday''?s?)\s+earnings?\b'
  '\bpayout\b'
  '\bhow much\b.*\b(make|made|earn|earned)\b'
  '\b(morning|fleet|daily)\s+brief\b'
  '\bmission control\b'
  '\brevenue\b'
  '\bcash\s+collect(?:ion|ed)?\b'
  '\bonline\s+hours\b'
  '\b(net|gross)\b[^.?!]{0,40}\b(yesterday|today|this\s+week|this\s+month|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|sar|so\s+far)\b'
  # NEW: period-over-period / pace
  '\b(compare|compared|vs\.?|versus|against|beat(?:ing)?|ahead\s+of|behind|better\s+than|worse\s+than|on\s+track|keep(?:ing)?\s+up|out\s?pac\w*|are\s+we|how\s+(?:are|''?re|r)\s+we)\b[^.?!]{0,40}\b(this|last|previous|prior|next)\s+(week|month|quarter)\b'
  '\b(this|last|previous|prior)\s+(week|month|quarter)\b[^.?!]{0,30}\b(vs\.?|versus|compared|than\s+(?:last|this|the)|or\s+(?:last|this)|beat|ahead|behind)\b'
)
function IsFleet([string]$m) {
  $s = $m.ToLower()
  foreach ($p in $FLEET) { if ([regex]::IsMatch($s, $p, $opts)) { return $true } }
  return $false
}

$pass = 0; $fail = 0
function Check($name, $cond, $expected) {
  $ok = ($cond -eq $expected)
  if ($ok) { $script:pass++ } else { $script:fail++; Write-Host "  FAIL: $name (got $cond, expected $expected)" -ForegroundColor Red }
}

Write-Host "`n-- THE BUG: period-comparison / pace now routes to the spine --"
Check "compare this week to last"        (IsFleet "compare this week to last") $true
Check "on track to beat last week"       (IsFleet "are we on track to beat last week") $true
Check "this month vs last month"         (IsFleet "this month vs last month") $true
Check "are we ahead of last week"        (IsFleet "are we ahead of last week") $true
Check "how are we doing this week vs last" (IsFleet "how are we doing this week vs last") $true
Check "did we beat last week"            (IsFleet "did we beat last week") $true
Check "compare this month to last month" (IsFleet "compare this month to last month") $true
Check "behind last week"                 (IsFleet "are we behind last week") $true

Write-Host "`n-- NEGATIVES: generic chat must NOT be captured (still web-search) --"
Check "latest news this week"   (IsFleet "what's the latest news this week") $false
Check "weather this week"       (IsFleet "what's the weather this week") $false
Check "iPhone vs Samsung"       (IsFleet "compare iPhone vs Samsung") $false
Check "do it this week or next" (IsFleet "I'll do it this week or next") $false
Check "plan this month"         (IsFleet "what should I plan this month") $false
Check "tell me a joke"          (IsFleet "tell me a joke") $false

Write-Host "`n-- REGRESSION: existing fleet triggers still fire --"
Check "how's the fleet"         (IsFleet "how's the fleet today") $true
Check "how much did X make"     (IsFleet "how much did Mansour make") $true
Check "our net yesterday"       (IsFleet "what's our net yesterday") $true
Check "morning brief"           (IsFleet "give me the morning brief") $true
Check "cash collection"         (IsFleet "who owes cash collection") $true

Write-Host "`n===================================================="
$col = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("RESULT: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $col
if ($fail -gt 0) { exit 1 }
