# tests/fleet-name-parse-verify.ps1
# Fleet collective-phrase fix in lib/fleet.js driverCandidates() (post-window
# backlog item: "the fleet" name-parse). PS mirror of DRIVER_ASK / DRIVER_NAME_STOP
# / GENERIC_NON_NAME / FLEET_COLLECTIVE_HEAD / FLEET_COLLECTIVE_TAIL / driverCandidates
# (node is not available in this shell, per standing project note).
#
# ASCII-only file: the possessive alternation uses a literal right-single-quote
# (U+2019), built via [char]0x2019 and interpolated -- never typed as a glyph.

$ErrorActionPreference = "Stop"
$pass = 0
$fail = 0

function Test-True($name, $cond) {
  if ($cond) { $script:pass++; Write-Host "PASS: $name" }
  else       { $script:fail++; Write-Host "FAIL: $name" -ForegroundColor Red }
}

$RSQ = [string][char]0x2019   # right single quote (')

$DRIVER_ASK = [regex]::new(
  "\b(?:what|how)\s+about\s+([^?.!\n]+)|\bhow\s+did\s+([^?.!\n]+?)\s+do\b|\btell\s+me\s+about\s+([^?.!\n]+)|\bwhat\s+did\s+([^?.!\n]+?)\s+(?:do|make|earn)\b|\bhow\s+much\s+(?:did\s+)?([^?.!\n]+?)\s+(?:do|did|make|made|earn|earned|net|gross|get)\b|\bcompare\s+([^?.!\n]+)",
  "IgnoreCase"
)
$POSS_RE = [regex]::new(
  "\b([A-Za-z]+(?:\s+[A-Za-z]+)?)(?:'s|$RSQ s|s')\s+(?:net|gross|earnings?|numbers?|performance|stats?|rating)\b",
  "IgnoreCase"
)
$DRIVER_NAME_STOP = [regex]::new(
  "\b(net|gross|earnings?|earning|income|payout|numbers?|performance|stats?|score|rating|yesterday|today|tomorrow|tonight|this\s+week|last\s+week|this\s+month|so\s+far|as|did|do|done|make|made|earn|earned|get|got|the|driver|drivers|rider|riders|captain|captains|courier|couriers|fleet|team|teams|crew|roster|staff|squad|everyone|everybody|people|guys|folks|whole|entire|we|us|you|they|them|our|your|is|are|was|were|give|gimme|show|tell|me|what|here|that)\b",
  "IgnoreCase"
)
$GENERIC_NON_NAME = [regex]::new(
  "^(of|day|days|week|weeks|month|months|a|an|the|my|our|your|their|his|her|its|this|that|these|those|it|we|us|you|they|them|i|me|he|she|everyone|everybody|anyone|anybody|someone|somebody|all|none|things?|stuff|fleet|team|teams|crew|roster|staff|squad|business|company|biz|ops|operations?|people|guys|folks|group|driver|drivers|rider|riders|captain|captains|courier|couriers|today|tomorrow|yesterday)$",
  "IgnoreCase"
)
$MONTH_RE = [regex]::new("^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|january|february|march|april|june|july|august|september|october|november|december)$", "IgnoreCase")

$FLEET_COLLECTIVE = "fleet|team|crew|roster|staff|squad|business|company|operations?"
$FLEET_COLLECTIVE_HEAD = [regex]::new("^(?:(?:the|our|my|your|this|that|a|an|all|whole|entire)\s+)*(?:$FLEET_COLLECTIVE)(?:'s|$RSQ s)?\b", "IgnoreCase")
$FLEET_COLLECTIVE_TAIL = [regex]::new("\b(?:$FLEET_COLLECTIVE)(?:'s|$RSQ s)?\s*$", "IgnoreCase")
function Test-FleetCollective([string]$part) {
  return $FLEET_COLLECTIVE_HEAD.IsMatch($part) -or $FLEET_COLLECTIVE_TAIL.IsMatch($part)
}

function Get-DriverCandidates([string]$message) {
  $raw = if ($message) { $message } else { "" }
  $span = $null
  $m = $DRIVER_ASK.Match($raw)
  if ($m.Success) {
    for ($i = 1; $i -le 6; $i++) {
      if ($m.Groups[$i].Success -and $m.Groups[$i].Value) { $span = $m.Groups[$i].Value; break }
    }
  }
  if (-not $span) {
    $p = $POSS_RE.Match($raw)
    if ($p.Success) { $span = $p.Groups[1].Value }
  }
  if (-not $span) { return $null }
  $span = $span.Trim()
  if ($span.Length -lt 2) { return $null }

  $rawParts = @($span -split '\s*(?:,|&|\band\b)\s*' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  $out = @()
  foreach ($part in $rawParts) {
    if (Test-FleetCollective $part) { continue }
    $n = $DRIVER_NAME_STOP.Replace($part, " ")
    $n = ($n -replace '\s+', ' ').Trim()
    if ($n.Length -lt 2) { continue }
    if ($n -match '\d') { continue }
    if ($MONTH_RE.IsMatch($n)) { continue }
    if ($GENERIC_NON_NAME.IsMatch($n)) { continue }
    $out += $n
  }
  if ($out.Count) { return $out } else { return $null }
}

# ── The live flake: "the fleet's <financial noun>" must NOT become a fake driver ──
Test-True "the fleet's profit -> null (was 'the fleet')" (
  $null -eq (Get-DriverCandidates "what about the fleet's profit")
)
Test-True "compare the fleet's profit to last month -> null (was ''s profit to last month')" (
  $null -eq (Get-DriverCandidates "compare the fleet's profit to last month")
)
Test-True "how's the fleet's performance this week -> null" (
  $null -eq (Get-DriverCandidates "how's the fleet's performance this week")
)

# ── "the fleet" alone / with trailing junk -> null (was 'to') ───────────────────
Test-True "what about the fleet -> null" (
  $null -eq (Get-DriverCandidates "what about the fleet")
)
Test-True "compare the fleet to last week -> null (was 'to')" (
  $null -eq (Get-DriverCandidates "compare the fleet to last week")
)

# ── Company-name + fleet (qualifier + collective) -> null (was 'Bolt') ──────────
Test-True "how did the Bolt fleet do today -> null (was 'Bolt')" (
  $null -eq (Get-DriverCandidates "how did the Bolt fleet do today")
)
Test-True "MOHM's fleet net this week -> null" (
  $null -eq (Get-DriverCandidates "how did MOHM's fleet do this week")
)
Test-True "our whole fleet's earnings -> null" (
  $null -eq (Get-DriverCandidates "what about our whole fleet's earnings")
)

# ── Real driver names still resolve (no regression) ─────────────────────────────
$r = @(Get-DriverCandidates "how did Ali do")
Test-True "how did Ali do -> ['Ali']" ($r.Count -eq 1 -and $r[0] -eq "Ali")

$r = @(Get-DriverCandidates "Habib's net today")
Test-True "Habib's net -> ['Habib']" ($r.Count -eq 1 -and $r[0] -eq "Habib")

$r = @(Get-DriverCandidates "compare ALI ALSHAHRANI and Mansour")
Test-True "compare ALI ALSHAHRANI and Mansour -> 2 candidates" ($r.Count -eq 2 -and $r[0] -eq "ALI ALSHAHRANI" -and $r[1] -eq "Mansour")

# ── Driver named alongside the fleet -> only the driver survives ────────────────
$r = @(Get-DriverCandidates "compare ALI and the fleet")
Test-True "compare ALI and the fleet -> ['ALI'] only" ($r.Count -eq 1 -and $r[0] -eq "ALI")

# ── Plain fleet queries with no driver/collective span -> null (unchanged) ──────
Test-True "what's the fleet net today -> null" (
  $null -eq (Get-DriverCandidates "what's the fleet net today")
)
Test-True "how much did we make yesterday -> null" (
  $null -eq (Get-DriverCandidates "how much did we make yesterday")
)

Write-Host ""
Write-Host "=== fleet-name-parse-verify.ps1 ==="
Write-Host "PASS: $pass  FAIL: $fail"
if ($fail -gt 0) { exit 1 }
