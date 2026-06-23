# Phase 1 — PS 5.1 mirror of parseConfirmExpensePrompt() in lib/orchestrator.js.
# This regex reconstructs the pending expense from OUR add-confirm prompt on "yes".
# It is regression-critical: it now backs BOTH the keyword path and AI-detected adds.
# (The AI classifier itself can't run offline — Node absent — so it's in the live sheet.)
$ErrorActionPreference = 'Stop'

$pat = '([\d,]+(?:\.\d+)?)\s+(SAR|EGP)\s+·\s+([^·?؟\n]+?)(?:\s+·\s+([^?؟\n]+?))?\s*[?؟]'

function Parse-Confirm([string]$t) {
  $m = [regex]::Match($t, $pat)
  if (-not $m.Success) { return $null }
  $amount = [double]($m.Groups[1].Value -replace ',', '')
  if (-not ($amount -gt 0)) { return $null }
  [pscustomobject]@{
    amount   = $amount
    currency = $m.Groups[2].Value
    category = $m.Groups[3].Value.Trim()
    note     = $m.Groups[4].Value.Trim()
  }
}

# {prompt; amount; currency; category; note}  (note '' = none)
$cases = @(
  @{ t = '🧾 Confirm expense — add 50 SAR · Dining · lunch? Reply "yes" to log it (or "no" to cancel).'; amount = 50;   currency = 'SAR'; category = 'Dining'; note = 'lunch' }
  @{ t = '🧾 Confirm expense — add 1,500 SAR · Rent? Reply "yes" to log it.';                            amount = 1500; currency = 'SAR'; category = 'Rent';   note = '' }
  @{ t = '🧾 Confirm expense — add 30 EGP · Internet & Phone · bill? Reply "yes".';                      amount = 30;   currency = 'EGP'; category = 'Internet & Phone'; note = 'bill' }
  @{ t = '🧾 تأكيد مصروف — أضيف 50 SAR · Dining · lunch؟ اكتب «نعم» للتأكيد أو «لا» للإلغاء.';            amount = 50;   currency = 'SAR'; category = 'Dining'; note = 'lunch' }
  @{ t = 'just some normal chat with no confirm prompt at all';                                          amount = $null; currency = $null; category = $null; note = $null }
)

$fail = 0
foreach ($c in $cases) {
  $r = Parse-Confirm $c.t
  if ($null -eq $c.amount) {
    if ($null -eq $r) { Write-Host "PASS [no-match] $($c.t.Substring(0,[Math]::Min(40,$c.t.Length)))..." }
    else { $fail++; Write-Host "FAIL expected no-match but got amount=$($r.amount) :: $($c.t)" }
    continue
  }
  if ($null -eq $r) { $fail++; Write-Host "FAIL expected a match, got none :: $($c.t)"; continue }
  $ok = ($r.amount -eq $c.amount) -and ($r.currency -eq $c.currency) -and ($r.category -eq $c.category) -and ($r.note -eq $c.note)
  if ($ok) {
    Write-Host ("PASS amount={0} cur={1} cat='{2}' note='{3}'" -f $r.amount, $r.currency, $r.category, $r.note)
  } else {
    $fail++
    Write-Host ("FAIL got amount={0} cur={1} cat='{2}' note='{3}' :: want amount={4} cur={5} cat='{6}' note='{7}'" -f $r.amount,$r.currency,$r.category,$r.note,$c.amount,$c.currency,$c.category,$c.note)
  }
}
Write-Host ''
if ($fail -eq 0) { Write-Host ("ALL {0} CASES PASSED" -f $cases.Count) } else { Write-Host ("{0} FAILURE(S)" -f $fail); exit 1 }
