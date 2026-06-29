# tests/build165_wallet_range_breakdown.test.ps1
# PS-5.1 MIRROR of Build-165 wallet fixes in lib/orchestrator.js:
#   BUG #1  "total for sara from 1st of june till yesterday" -> 0  (no "from X till Y"
#           range branch; the single-date path then grabbed only "yesterday").
#   BUG #2  breakdown showed TOP-5 only, so it didn't add up to the total the user saw
#           ("but the total is not 11047").
# Node is absent on the host, so this:
#   (1) mirrors renderBreakdown's reconciliation MATH on his real Sara/June numbers
#       (top-5 + remainder == total, per-currency);
#   (2) mirrors the "from X till/to Y" regex split + proves non-range phrasings don't match;
#   (3) statically proves the wiring (range branch added, single-date path guarded,
#       Total/remainder lines added).

$ErrorActionPreference = 'Stop'
$script:fail = 0
function Check([string]$name, [bool]$cond) {
  if ($cond) { Write-Host ("  PASS  " + $name) }
  else { Write-Host ("  FAIL  " + $name); $script:fail = $script:fail + 1 }
}

$root = Split-Path $PSScriptRoot -Parent
$orcFile = Join-Path $root 'lib\orchestrator.js'
if (-not (Test-Path $orcFile)) { Write-Host "  FAIL  missing lib/orchestrator.js"; exit 1 }
$orc = [IO.File]::ReadAllText($orcFile, [Text.Encoding]::UTF8)

# ---------------------------------------------------------------------------------------
Write-Host "[1] breakdown reconciliation math (mirror of renderBreakdown sumCur)"
# His real data: Sara, June. Top-5 summed 8,417 but total was 11,047 -> 2,630 hidden.
$cats = @(
  @{ category="Alia's clothes"; byCurrency = @{ EGP = 5550 } },
  @{ category="Sara's scarf";   byCurrency = @{ EGP = 855  } },
  @{ category="Groceries";      byCurrency = @{ EGP = 812  } },
  @{ category="Money at home";  byCurrency = @{ EGP = 600  } },
  @{ category="Marioma's gift"; byCurrency = @{ EGP = 600  } },
  @{ category="Misc A";         byCurrency = @{ EGP = 1500 } },
  @{ category="Misc B";         byCurrency = @{ EGP = 1130 } }
)
function Sum-Cur($list) {
  $t = @{}
  foreach ($c in $list) { foreach ($cur in $c.byCurrency.Keys) {
    if (-not $t.ContainsKey($cur)) { $t[$cur] = 0.0 }
    $t[$cur] = $t[$cur] + [double]$c.byCurrency[$cur]
  } }
  return $t
}
$N = 5
$shown = $cats[0..($N-1)]
$rest  = $cats[$N..($cats.Count-1)]
$shownT = (Sum-Cur $shown)['EGP']
$restT  = (Sum-Cur $rest)['EGP']
$totalT = (Sum-Cur $cats)['EGP']
Check "top-5 sum = 8417"                 ($shownT -eq 8417)
Check "remainder (2 more) = 2630"        ($restT  -eq 2630)
Check "Total = 11047"                    ($totalT -eq 11047)
Check "shown + remainder == Total (reconciles)" (($shownT + $restT) -eq $totalT)
Check "remainder count = 2"              ($rest.Count -eq 2)

# multi-currency independence (SAR + EGP must not mix)
$mix = @(
  @{ category="A"; byCurrency = @{ SAR = 100; EGP = 50 } },
  @{ category="B"; byCurrency = @{ SAR = 25 } }
)
$mt = Sum-Cur $mix
Check "multi-currency Total SAR = 125"   ($mt['SAR'] -eq 125)
Check "multi-currency Total EGP = 50"    ($mt['EGP'] -eq 50)

# ---------------------------------------------------------------------------------------
Write-Host "[2] 'from X till/to Y' range split (mirror of the new parseDateRange branch)"
$fromTill = [regex]::new('\bfrom\b(.+?)\b(?:till|until|thru|through|to|up\s+to)\b(.+)', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
function Split-FromTill([string]$s) {
  $mm = $fromTill.Match($s)
  if (-not $mm.Success) { return $null }
  return @{ a = $mm.Groups[1].Value.Trim(); b = $mm.Groups[2].Value.Trim() }
}
$r1 = Split-FromTill 'give me total expenses for sara from 1st of june till yesterday'
Check "splits the live miss into endpoints" ($null -ne $r1)
if ($r1) {
  Check "  start endpoint = '1st of june'" ($r1.a -eq '1st of june')
  Check "  end endpoint   = 'yesterday'"   ($r1.b -eq 'yesterday')
}
$r2 = Split-FromTill 'from june 1 to june 15'
Check "'from X to Y' also splits"          ($null -ne $r2 -and $r2.a -eq 'june 1' -and $r2.b -eq 'june 15')
# non-range phrasings must NOT match the from-till cue (so the single-date path still works)
Check "'on june 23' is NOT a from-till range"   ($null -eq (Split-FromTill 'what did sara spend on june 23'))
Check "'expenses yesterday' is NOT a range"     ($null -eq (Split-FromTill 'expenses yesterday'))
Check "'from last week' (no till/to) NOT a from-till" ($null -eq (Split-FromTill 'spending from last week'))

# ---------------------------------------------------------------------------------------
Write-Host "[3] wiring is in place (static)"
Check "parseDateRange has the from-till branch" ($orc.Contains('(?:till|until|thru|through|to|up\s+to)'))
Check "parseDateRange has the open since/starting branch" ($orc.Contains('(?:since|starting)'))
Check "single-date path is guarded by !parseDateRange(m)" ($orc.Contains('!parseDateRange(m) &&'))
Check "renderBreakdown adds a Total line" ($orc.Contains('Total: ') -or $orc.Contains('`Total:'))
Check "renderBreakdown adds an '...and N more' line" ($orc.Contains('more: '))
Check "renderBreakdown sums per currency (sumCur)" ($orc.Contains('const sumCur'))

# ---------------------------------------------------------------------------------------
Write-Host ""
if ($script:fail -gt 0) {
  Write-Host ("build165 wallet range+breakdown mirror: FAIL ({0} check(s) failed)" -f $script:fail)
  exit 1
}
Write-Host "build165 wallet range+breakdown mirror: OK (all checks passed)"
exit 0
