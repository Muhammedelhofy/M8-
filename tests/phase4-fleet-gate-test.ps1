# Phase 4 — Fleet RESHAPE (make Fleet HARDER to enter).
# PowerShell 5.1 mirror of the deterministic gating in buildFleetContext() + looksFleet()
# in lib/fleet.js. Node is absent on this host, so this re-implements the ENGLISH
# keyword detection + the bare-name/registry gate and asserts the ENTRY DECISION each
# message resolves to. The LLM intent fallback, Arabic phrasing, and the live data
# packets are out of scope here (covered by PHASE4_FLEET_LIVE_TEST.md).
#
# Entry decisions:
#   driver      -> committed to a real KNOWN driver (proceeds to driver lookup)
#   notfound    -> an explicit verb-phrase ask naming an UNKNOWN driver (honest, read-only)
#   snapshot    -> a fleet-keyword turn with no driver target (mission-control default)
#   fallthrough -> NOT a fleet question -> returns empty -> Phase 0 / chat (NO driver loop)
$ErrorActionPreference = 'Stop'
$opt = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
function RX([string]$s, [string]$pat) { return [regex]::IsMatch($s, $pat, $opt) }

# ── looksFleet() mirror (representative ENGLISH subset; sufficient for these cases) ──
# The real detector ORs many more patterns (tier/cash/churn/brief/ranking) — this
# keyword set is enough to classify the fleet-vs-not cases the gate hinges on.
function Test-LooksFleet([string]$msg) {
  $m = if ($null -eq $msg) { '' } else { $msg }
  if (RX $m '\bfleet\b')                                  { return $true }
  if (RX $m '\bdrivers?\b|\bcaptains?\b|\bcouriers?\b|\briders?\b') { return $true }
  if (RX $m '\bpayout\b|\brevenue\b')                     { return $true }
  if (RX $m '\b(net|gross|daily|weekly|monthly|today''?s?|yesterday''?s?)\s+earnings?\b') { return $true }
  if (RX $m '\bhow much\b.*\b(make|made|earn|earned)\b')  { return $true }
  if (RX $m '\b(net|gross)\b[^.?!]{0,40}\b(yesterday|today|this\s+week|this\s+month|sar|so\s+far)\b') { return $true }
  if (RX $m '\bcash\s+collect(?:ion|ed)?\b|\bonline\s+hours\b')  { return $true }
  if (RX $m '\bmorning\s+brief\b|\bmission\s+control\b')  { return $true }
  # paceTargetRef: a pace/target pattern AND a real SAR target number present.
  if ((RX $m '\b(?:who|which\s+drivers?|all\s+drivers?|can|will|going\s+to)\b[^.?!]{0,50}\b(?:hit|reach|make|earn|achieve|get)\b[^.?!]{0,30}\b(?:\d{3,6}|target|sar|monthly)\b') `
      -and (RX $m '\b\d{3,7}\b')) { return $true }
  return $false
}

# ── driverCandidates() mirror — verb-phrase / possessive driver asks only ──
# Returns the candidate name span, or $null. (A bare name with no verb is NOT caught
# here — that is the low-confidence bareName path below.)
$DRIVER_NAME_STOP = '\b(net|gross|earnings?|earning|income|payout|numbers?|performance|stats?|score|rating|yesterday|today|tomorrow|tonight|this\s+week|last\s+week|this\s+month|so\s+far|as|did|do|done|make|made|earn|earned|get|got|the|driver|drivers|fleet|team|we|us|you|they|them|our|your|is|are|was|were|show|tell|me|what|that)\b'
$GENERIC_NON_NAME = '^(the|a|an|we|us|you|they|them|it|fleet|team|crew|everyone|everybody|driver|drivers|today|yesterday|money|stuff)$'
function Get-VerbCands([string]$msg) {
  $m = if ($null -eq $msg) { '' } else { $msg }
  $span = $null
  $rx = [regex]::Match($m, '\b(?:what|how)\s+about\s+([^?.!\n]+)|\bhow\s+did\s+([^?.!\n]+?)\s+do\b|\bhow\s+much\s+(?:did\s+)?([^?.!\n]+?)\s+(?:do|did|make|made|earn|earned|net|gross|get)\b|\bcompare\s+([^?.!\n]+)', $opt)
  if ($rx.Success) {
    for ($i = 1; $i -lt $rx.Groups.Count; $i++) { if ($rx.Groups[$i].Value) { $span = $rx.Groups[$i].Value; break } }
  }
  if (-not $span) {
    $p = [regex]::Match($m, '\b([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:''s|s'')\s+(?:net|gross|earnings?|numbers?|performance|stats?|rating)\b', $opt)
    if ($p.Success) { $span = $p.Groups[1].Value }
  }
  if (-not $span) { return $null }
  $span = $span.Trim()
  $out = @()
  foreach ($part in ($span -split '\s*(?:,|&|\band\b)\s*')) {
    $n = [regex]::Replace($part.Trim(), $DRIVER_NAME_STOP, ' ', $opt)
    $n = ($n -replace '\s+', ' ').Trim()
    if ($n.Length -lt 2) { continue }
    if ($n -match '\d') { continue }
    if (RX $n $GENERIC_NON_NAME) { continue }
    $out += $n
  }
  if ($out.Count -gt 0) { return $out } else { return $null }
}

# ── bareNameCandidate() mirror ──
function Get-BareName([string]$msg, [bool]$recentFleet) {
  if (-not $recentFleet) { return $null }
  $t = if ($null -eq $msg) { '' } else { $msg.Trim() }
  if (-not $t) { return $null }
  $wc = @($t -split '\s+' | Where-Object { $_ }).Count
  if ($wc -lt 2 -or $wc -gt 4) { return $null }
  # Encoding-safe stand-in for the JS [A-Za-z<arabic-range>] — \p{L} = any Unicode
  # letter (Latin or Arabic). Keeps this mirror ASCII-clean for PS 5.1 file reads.
  if (-not (RX $t '^[\p{L}\s''-]+$')) { return $null }
  return $t
}

# ── isKnownDriver() mirror — full-name OR >=3-char token (exact / registry-prefix) ──
function Test-KnownDriver([string]$cand, [string[]]$roster) {
  $c = ($cand).ToLower().Trim()
  if (-not $c) { return $false }
  $full = @(); $toks = @()
  foreach ($name in $roster) {
    $lo = $name.ToLower()
    $full += $lo
    foreach ($w in ($lo -split '\s+')) { if ($w.Length -ge 3 -and ($w -notmatch '\d')) { $toks += $w } }
  }
  if ($full -contains $c) { return $true }
  foreach ($w in ($c -split '\s+')) {
    if ($w.Length -lt 3 -or ($w -match '\d')) { continue }
    foreach ($t in $toks) { if ($t -eq $w -or $t.StartsWith($w)) { return $true } }
  }
  return $false
}

# ── Entry-gate decision (mirror of the reshaped buildFleetContext flow) ──
function Get-FleetGate([string]$msg, [bool]$recentFleet, [string[]]$roster) {
  $verb = Get-VerbCands $msg
  $driverCands = $verb
  $bareGuess = $false
  if (-not $verb) {
    $b = Get-BareName $msg $recentFleet
    if ($b) { $driverCands = @($b); $bareGuess = $true }
  }
  $hasVerb = [bool]$verb
  # followup uses ONLY verb-phrase cands (a bare guess must not force the path).
  $followup = $hasVerb -and $recentFleet
  $directFleet = (Test-LooksFleet $msg) -or $followup
  $maybeDriver = (-not $directFleet) -and [bool]$driverCands

  # Not a fleet question at all -> LLM-classify gate -> (for non-fleet) fall through.
  if (-not $directFleet -and -not $maybeDriver) { return 'fallthrough' }

  # Registry gate: a GUESSED driver must resolve to a real known driver.
  if ($bareGuess -or $maybeDriver) {
    $known = $false
    if ($driverCands) { foreach ($c in $driverCands) { if (Test-KnownDriver $c $roster) { $known = $true; break } } }
    if (-not $known) {
      if ($maybeDriver) { return 'fallthrough' }   # no fleet keyword -> chat
      $driverCands = $null                          # keyword present -> drop guess -> snapshot
    }
  }

  if ($driverCands) {
    $known = $false
    foreach ($c in $driverCands) { if (Test-KnownDriver $c $roster) { $known = $true; break } }
    if ($known) { return 'driver' } else { return 'notfound' }
  }
  return 'snapshot'
}

$ROSTER = @('ALI ALSHAHRANI', 'ALI MOHAMMED', 'ABDULRAHMAN ALSHAHRANI', 'MANSOUR ALMANSOUR', 'MARWAN', 'HABIB')

# ── Part 1: looksFleet classification ──
$lfCases = @(
  @{ msg = 'how did the fleet do this week';       want = $true  }
  @{ msg = 'who can hit 5000 sar this month';      want = $true  }
  @{ msg = 'what was net yesterday';               want = $true  }
  @{ msg = 'show me the morning brief';            want = $true  }
  @{ msg = "how much did mansour make";            want = $true  }
  @{ msg = 'make me rich';                         want = $false }   # the reported bug source
  @{ msg = 'make me money';                        want = $false }
  @{ msg = 'hello there';                          want = $false }
  @{ msg = 'what is the weather today';            want = $false }
  @{ msg = 'thank you so much';                    want = $false }
)

# ── Part 2: entry-gate decisions (the core of the reshape) ──
# recentFleet = was the prior turn a fleet turn? (enables the bare-name path)
$gateCases = @(
  # The reported bug: a non-fleet phrase mid-fleet-conversation must NOT loop.
  @{ msg = 'make me rich';            recent = $true;  want = 'fallthrough' }  # pre-fix: notfound loop
  @{ msg = 'make me money';           recent = $true;  want = 'fallthrough' }
  @{ msg = 'thank you so much';       recent = $true;  want = 'fallthrough' }
  @{ msg = 'purple monkey dishwasher';recent = $true;  want = 'fallthrough' }
  @{ msg = 'good morning';            recent = $true;  want = 'fallthrough' }  # mid-convo greeting -> chat
  # Same phrases with NO fleet context: never even a bare guess.
  @{ msg = 'make me rich';            recent = $false; want = 'fallthrough' }
  # A bare name reply that IS a real driver (answering "which Ali?") -> claimed.
  @{ msg = 'ali alshahrani';          recent = $true;  want = 'driver'      }
  @{ msg = 'mansour almansour';       recent = $true;  want = 'driver'      }
  # A fleet KEYWORD turn with a bare non-driver tail -> guess dropped -> snapshot.
  @{ msg = 'fleet money please';      recent = $true;  want = 'snapshot'    }
  @{ msg = 'how did the fleet do this week'; recent = $false; want = 'snapshot' }
  # Explicit verb-phrase ask, KNOWN driver -> driver; UNKNOWN driver -> honest not-found.
  @{ msg = 'how much did mansour make'; recent = $false; want = 'driver'    }
  @{ msg = 'how much did zorblax make'; recent = $false; want = 'notfound'  }
  # Fresh-session comparison: real drivers -> claim; non-drivers -> fall through to search.
  @{ msg = 'compare ali and mansour';  recent = $false; want = 'driver'     }
  @{ msg = 'compare iphone and samsung'; recent = $false; want = 'fallthrough' }
)

$fail = 0
Write-Host '== Part 1: looksFleet =='
foreach ($c in $lfCases) {
  $got = Test-LooksFleet $c.msg
  if ($got -eq $c.want) { Write-Host ("PASS [fleet={0,-5}] {1}" -f $got, $c.msg) }
  else { $fail++; Write-Host ("FAIL want={0} got={1} :: {2}" -f $c.want, $got, $c.msg) }
}
Write-Host ''
Write-Host '== Part 2: entry-gate decision =='
foreach ($c in $gateCases) {
  $got = Get-FleetGate $c.msg $c.recent $ROSTER
  if ($got -eq $c.want) { Write-Host ("PASS [{0,-11}] (recent={1,-5}) {2}" -f $got, $c.recent, $c.msg) }
  else { $fail++; Write-Host ("FAIL want={0,-11} got={1,-11} (recent={2}) :: {3}" -f $c.want, $got, $c.recent, $c.msg) }
}

$total = $lfCases.Count + $gateCases.Count
Write-Host ''
if ($fail -eq 0) { Write-Host ("ALL {0} CASES PASSED" -f $total) }
else { Write-Host ("{0} FAILURE(S) of {1}" -f $fail, $total); exit 1 }
