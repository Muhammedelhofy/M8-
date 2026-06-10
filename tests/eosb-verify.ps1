# M8 EOSB calculator — formula + extraction + detection port verification (no-node)
# Ports the LOAD-BEARING logic of lib/eosb.js so the end-of-service ARITHMETIC can
# be trusted before deploy (the rule itself is stated + flagged-to-verify in the
# packet; here we lock that the MATH is exact and the inputs parse correctly):
#   (1) computeEOSB — 1/2 month/yr first 5 yrs + 1 month/yr beyond; resignation
#       reductions (<2y=0, 2-<5y=1/3, 5-<10y=2/3, 10y+=full); termination=full.
#   (2) extractWage / extractYears / extractReason — natural-language inputs.
#   (3) looksEOSB — fires on a calc ask, not a bare "end of service" mention.
# Pure ASCII (PowerShell 5.1 mangles multibyte in a no-BOM .ps1).
#   Run:  powershell -File tests/eosb-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}
$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---- (1) computeEOSB (verbatim port) ----
function ComputeEOSB($wage, $years, $reason) {
  $w = [double]$wage; $y = [double]$years
  $first5 = [Math]::Min($y, 5); $beyond5 = [Math]::Max(0, $y - 5)
  $base = $first5 * 0.5 * $w + $beyond5 * 1.0 * $w
  $frac = 1.0
  if ($reason -eq 'resignation') {
    if     ($y -lt 2)  { $frac = 0.0 }
    elseif ($y -lt 5)  { $frac = 1.0 / 3.0 }
    elseif ($y -lt 10) { $frac = 2.0 / 3.0 }
    else               { $frac = 1.0 }
  }
  return [Math]::Round($base * $frac, 2)
}
Write-Host "== (1) computeEOSB: 0.5 mo/yr first 5, 1 mo/yr beyond; resignation reductions ==" -ForegroundColor Cyan
Check "termination 6000 x 3y -> 9000"    (ComputeEOSB 6000 3  'termination')  9000
Check "termination 6000 x 8y -> 33000"   (ComputeEOSB 6000 8  'termination')  33000
Check "termination 5000 x 4.5y -> 11250" (ComputeEOSB 5000 4.5 'termination') 11250
Check "resign 6000 x 1y -> 0"            (ComputeEOSB 6000 1  'resignation')  0
Check "resign 6000 x 3y -> 3000 (1/3)"   (ComputeEOSB 6000 3  'resignation')  3000
Check "resign 6000 x 7y -> 18000 (2/3)"  (ComputeEOSB 6000 7  'resignation')  18000
Check "resign 6000 x 12y -> 57000 (full)"(ComputeEOSB 6000 12 'resignation')  57000
Check "resign boundary 6000 x 2y -> 2000 (1/3 of 6000)"  (ComputeEOSB 6000 2  'resignation') 2000
Check "resign boundary 6000 x 5y -> 10000 (2/3 of 15000)" (ComputeEOSB 6000 5 'resignation') 10000
Check "resign boundary 6000 x 10y -> 45000 (full)" (ComputeEOSB 6000 10 'resignation') 45000

# ---- (2) extraction (verbatim ports) ----
function ExtractWage($s) {
  $pats = @(
    '\b(?:salary|wage|pay|earns?|earning|making|makes|paid)\s*(?:of|is|=|:|at)?\s*(?:sar|riyals?)?\s*([\d][\d,\.]*)',
    '\b([\d][\d,\.]*)\s*(?:sar|riyals?)',
    '\b([\d][\d,\.]*)\s*(?:/?\s*(?:a\s+)?month|monthly|per\s+month|/mo)'
  )
  foreach ($re in $pats) {
    $m = [regex]::Match($s, $re, $IC)
    if ($m.Success) { $n = [double]($m.Groups[1].Value -replace ',', ''); if ($n -gt 0) { return $n } }
  }
  return $null
}
function ExtractYears($s) {
  $years = $null
  $ym = [regex]::Match($s, '\b(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr)\b', $IC)
  if ($ym.Success) { $years = [double]$ym.Groups[1].Value }
  $mm = [regex]::Match($s, '\b(\d+(?:\.\d+)?)\s*(?:months?|mos?)\b', $IC)
  if ($mm.Success) { $mo = [double]$mm.Groups[1].Value; if ($years -eq $null) { $years = 0 }; $years = $years + $mo / 12 }
  return $years
}
$RESIGN = '\b(resign\w*|quit\w*|stepp?ing?\s+down|left\s+(?:voluntarily|on\s+(?:his|her|their)\s+own)|hands?\s+in\s+(?:his|her|their)\s+notice)\b'
$TERMIN = '\b(fir(?:e|ed|ing)|terminat\w*|let\s+(?:him|her|them|go)|lay(?:ing)?\s*off|laid\s+off|dismiss\w*|made\s+redundant|end(?:ing)?\s+(?:his|her|their|the)\s+contract|contract\s+end\w*|not\s+renew\w*)\b'
function ExtractReason($s) {
  if ([regex]::IsMatch($s, $RESIGN, $IC)) { return 'resignation' }
  if ([regex]::IsMatch($s, $TERMIN, $IC)) { return 'termination' }
  return ''
}
Write-Host "== (2) input extraction: wage / years / reason ==" -ForegroundColor Cyan
Check "wage 'salary of 6000'"      (ExtractWage "salary of 6000")                 6000
Check "wage 'earns 4,500 SAR'"     (ExtractWage "he earns 4,500 SAR")             4500
Check "wage '5000 a month'"        (ExtractWage "on 5000 a month")               5000
Check "wage '6000 SAR/month'"      (ExtractWage "6000 SAR/month")                6000
Check "years '3 years'"            (ExtractYears "worked 3 years")               3
Check "years '4.5 yrs'"            (ExtractYears "after 4.5 yrs")                4.5
Check "years '2 years and 6 months' -> 2.5" (ExtractYears "2 years and 6 months") 2.5
Check "years '18 months' -> 1.5"   (ExtractYears "18 months")                    1.5
Check "reason resigned"            (ExtractReason "he resigned last week")       "resignation"
Check "reason fire"                (ExtractReason "if I fire him")               "termination"
Check "reason let go"              (ExtractReason "I let him go")                "termination"
Check "reason end his contract"    (ExtractReason "I'm ending his contract")     "termination"
Check "reason none -> ''"          (ExtractReason "his end of service")          ""

# ---- (3) looksEOSB detection ----
$TOPIC = '\b(end[\s-]?of[\s-]?service|eosb|gratuity|severance)\b'
$VERB  = "\b(calculate|compute|work\s+out|how\s+much|what'?s|figure\s+out|owe|entitled|payout|pay\s+out)\b"
function LooksEOSB($s) {
  if (-not [regex]::IsMatch($s, $TOPIC, $IC)) { return $false }
  if ([regex]::IsMatch($s, $VERB, $IC)) { return $true }
  return ((ExtractWage $s) -ne $null -and (ExtractYears $s) -ne $null)
}
Write-Host "== (3) looksEOSB: a calc ASK, not a bare mention ==" -ForegroundColor Cyan
Check "calculate end of service"   (LooksEOSB "calculate end of service for a driver earning 6000 after 3 years") $true
Check "how much EOSB"              (LooksEOSB "how much EOSB does he get?")        $true
Check "severance with inputs"      (LooksEOSB "severance for someone on 5000 SAR who worked 4 years") $true
Check "bare mention (no ask) -> false" (LooksEOSB "I need to handle his end of service")  $false
Check "no topic -> false"          (LooksEOSB "calculate his bonus for 3 years")  $false
Check "weather -> false"           (LooksEOSB "what's the weather today")         $false

# ---- (4) end-to-end: parse a sentence then compute ----
Write-Host "== (4) end-to-end (parse -> compute) ==" -ForegroundColor Cyan
$s1 = "what's the EOSB if he resigned, salary 6000, 7 years?"
Check "e2e resign 6000/7y -> 18000" (ComputeEOSB (ExtractWage $s1) (ExtractYears $s1) (ExtractReason $s1)) 18000
$s2 = "how much severance for someone on 5000 SAR who worked 4.5 years and I let go?"
Check "e2e let-go 5000/4.5y -> 11250" (ComputeEOSB (ExtractWage $s2) (ExtractYears $s2) (ExtractReason $s2)) 11250

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
