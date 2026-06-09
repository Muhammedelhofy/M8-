# M8 partial-week / pace fix - PowerShell .NET-regex verification port
# Mirrors paceFraming() in lib/fleet.js (the gate that swaps the plain rollup
# packet for the PACE packet, which forces M8 to flag a partial-week-vs-full-week
# comparison instead of silently comparing totals). Targets the eval miss
# silentfail.partial_week. No local node (cloud build). Run:
#   powershell -File tests/pace-week-verify.ps1
# Pure-ASCII on purpose (PS 5.1 mangles multibyte in no-BOM UTF-8 .ps1).

$ErrorActionPreference = 'Stop'
$opts = [Text.RegularExpressions.RegexOptions]::IgnoreCase

# -- ported PACE_PATTERNS (keep in sync with lib/fleet.js) --
$PACE = @(
  '\bon\s+(?:track|pace)\b'
  '\bare\s+we\s+(?:going\s+to|gonna|on\s+(?:track|pace))'
  '\b(beat|beating|exceed|surpass|match|catch\s+up\s+to|keep(?:ing)?\s+up\s+with|ahead\s+of)\b[^.?!]{0,30}\b(last|previous|prior)\s+(week|month|quarter)\b'
  '\bso\s+far\s+(?:this|in)\b'
  '\b\d{1,2}\s+days?\s+(?:in|into)\b'
  '\bthis\s+(week|month|quarter)\s+so\s+far\b'
  '\b(projected?|projection|on\s+pace|pacing)\b'
)
function Pace([string]$m) {
  $s = $m.ToLower()
  foreach ($p in $PACE) { if ([regex]::IsMatch($s, $p, $opts)) { return $true } }
  return $false
}

# the two NEW FLEET_PATTERNS that route period/pace queries to the spine
$FLEET_PACE = @(
  '\b(compare|compared|vs\.?|versus|against|beat(?:ing)?|ahead\s+of|behind|better\s+than|worse\s+than|on\s+track|keep(?:ing)?\s+up|out\s?pac\w*|are\s+we|how\s+(?:are|''?re|r)\s+we)\b[^.?!]{0,40}\b(this|last|previous|prior|next)\s+(week|month|quarter)\b'
  '\b(this|last|previous|prior)\s+(week|month|quarter)\b[^.?!]{0,30}\b(vs\.?|versus|compared|than\s+(?:last|this|the)|or\s+(?:last|this)|beat|ahead|behind)\b'
)
function RoutesToSpine([string]$m) {
  $s = $m.ToLower()
  foreach ($p in $FLEET_PACE) { if ([regex]::IsMatch($s, $p, $opts)) { return $true } }
  return $false
}

$pass = 0; $fail = 0
function Check($name, $cond, $expected) {
  $ok = ($cond -eq $expected)
  if ($ok) { $script:pass++ } else { $script:fail++; Write-Host "  FAIL: $name (got $cond, expected $expected)" -ForegroundColor Red }
}

Write-Host "`n-- THE PROBE: must route to spine AND trigger pace packet --"
$probe = "We're 3 days into this week. Are we on track to beat last week's total net?"
Check "probe routes to spine"  (RoutesToSpine $probe) $true
Check "probe triggers pace"    (Pace $probe) $true

Write-Host "`n-- pace framing fires --"
Check "on track to beat last week"   (Pace "are we on track to beat last week") $true
Check "on pace to beat last month"   (Pace "are we on pace to beat last month") $true
Check "so far this week"             (Pace "how's the fleet doing so far this week") $true
Check "projected net"                (Pace "what's our projected net this week") $true
Check "are we beating last week"     (Pace "are we beating last week") $true
Check "2 days in + ahead of last wk" (Pace "2 days in, are we ahead of last week") $true
Check "this week so far"             (Pace "this week so far how are we") $true

Write-Host "`n-- NOT pace: plain comparison keeps the normal rollup packet --"
Check "compare this week to last"  (Pace "compare this week to last") $false
Check "this month vs last month"   (Pace "this month vs last month") $false
Check "morning brief"              (Pace "give me the morning brief") $false
Check "net yesterday"              (Pace "what was our net yesterday") $false
Check "fleet today"                (Pace "how's the fleet today") $false

Write-Host "`n===================================================="
$col = if ($fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("RESULT: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $col
if ($fail -gt 0) { exit 1 }
