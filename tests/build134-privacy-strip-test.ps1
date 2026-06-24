# Build-134 (privacy #1) - strip a money turn that was CLAIMED via its reply's
# MONEY_SENTINEL, even when the turn's own words carry no currency cue ("throw 30 to it").
# PS 5.1 mirror of stripMoneyHistory() in lib/orchestrator.js. The sentinel (U+2063,
# invisible separator) is built from its code point so the file stays ASCII-clean.
$ErrorActionPreference = 'Stop'
$opt  = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
$SENT = [string][char]0x2063   # MONEY_SENTINEL

# Simplified _MONEY_PLAUSIBLE (sufficient for these cases).
$MONEY_PLAUSIBLE = '\b(sar|sr|riyals?|egp|pounds?|expenses?|wallet|balance|transactions?|spend(?:ing)?|spent|paid)\b'
function Money-Plausible([string]$c) { return [regex]::IsMatch($c, $MONEY_PLAUSIBLE, $opt) }

# Mirror of stripMoneyHistory (with the Build-134 tag-based rule). Returns KEPT contents.
# NOTE: JS String.indexOf is ORDINAL, but .NET String.IndexOf(string) is CULTURE-AWARE and
# treats U+2063 (the invisible MONEY_SENTINEL) as an ignorable char → it would match every
# string at index 0. We must use the Ordinal overload to mirror JS faithfully.
$ORD = [System.StringComparison]::Ordinal
function Has-Sentinel([string]$c) { return $c.IndexOf($SENT, $ORD) -ge 0 }
function Strip-Money($hist) {
  $kept = @()
  for ($i = 0; $i -lt $hist.Count; $i++) {
    $h = $hist[$i]; $c = [string]$h.content
    if (Has-Sentinel $c) { continue }                         # tagged assistant money reply
    if ($h.role -eq 'user') {
      if (Money-Plausible $c) { continue }                    # currency cue in the words
      $next = if ($i + 1 -lt $hist.Count) { $hist[$i + 1] } else { $null }
      if ($next -and $next.role -eq 'assistant' -and (Has-Sentinel ([string]$next.content))) { continue }  # NEW: claimed via reply
    }
    $kept += $c
  }
  return $kept   # callers wrap in @() to guarantee an array (avoid the single-element unroll)
}

$fail = 0
function Check($name, $cond) {
  if ($cond) { Write-Host "PASS $name" } else { $script:fail++; Write-Host "FAIL $name" }
}

# 1. The closed leak: a money turn with NO currency word, claimed (reply tagged) -> stripped.
$h1 = @(
  @{ role = 'user';      content = 'throw 30 to it' }
  @{ role = 'assistant'; content = 'Update last expense -> 40 EGP?' + $SENT }
  @{ role = 'user';      content = 'whats the weather today' }
)
$k1 = @(Strip-Money $h1)
Check "'throw 30 to it' stripped (claimed via reply tag)" (-not ($k1 -contains 'throw 30 to it'))
Check "tagged confirm reply stripped"                    (-not ($k1 -contains ('Update last expense -> 40 EGP?' + $SENT)))
Check "'whats the weather today' kept"                   ($k1 -contains 'whats the weather today')

# 2. Existing behavior intact: a currency-word money turn still stripped.
$h2 = @(
  @{ role = 'user';      content = 'spent 50 sar on lunch' }
  @{ role = 'assistant'; content = 'Logged 50 SAR' + $SENT }
)
$k2 = @(Strip-Money $h2)
Check "'spent 50 sar on lunch' stripped (currency cue)" (-not ($k2 -contains 'spent 50 sar on lunch'))
Check "money reply stripped"                            ($k2.Count -eq 0)

# 3. No over-reach: a normal turn followed by a NON-money reply is kept.
$h3 = @(
  @{ role = 'user';      content = 'what is 2 plus 2' }
  @{ role = 'assistant'; content = '4' }
  @{ role = 'user';      content = 'thanks' }
)
$k3 = @(Strip-Money $h3)
Check "'what is 2 plus 2' kept (reply not money-tagged)" ($k3 -contains 'what is 2 plus 2')
Check "'4' kept"                                          ($k3 -contains '4')
Check "'thanks' kept"                                     ($k3 -contains 'thanks')

Write-Host ''
if ($fail -eq 0) { Write-Host 'ALL 8 CHECKS PASSED' }
else { Write-Host ("{0} FAILURE(S)" -f $fail); exit 1 }
