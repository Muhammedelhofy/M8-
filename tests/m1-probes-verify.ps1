# m1-probes-verify.ps1 â€” Build-13 (M1) offline verification.
# Two parts (no local node â€” JS is verified live after deploy):
#   A) ALGORITHM: a line-for-line PowerShell mirror of computeCensus() in
#      lib/collatz-probes.js, run at N=10,000 and checked against KNOWN Collatz
#      ground truth from the literature (Ïƒâˆž(27)=111, peak(27)=9232, the Ïƒâˆž and
#      excursion record tables, Terras parity densities, Î½â‚‚ geometric law).
#   B) DETECTION: regex ports of detectStructuralProbe â€” fires only on explicit
#      run-the-probes asks, never on recall questions or long pasted briefs.

$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
$pass = 0; $fail = 0
function Check([string]$name, $actual, $expected) {
  if ("$actual" -eq "$expected") { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got $actual, want $expected)" -ForegroundColor Red }
}
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}

# â•â•â•â•â•â•â•â• A) census algorithm mirror â•â•â•â•â•â•â•â•
Write-Host "`n== A) census algorithm vs known Collatz ground truth (LIM=10,000) ==" -ForegroundColor Cyan
$LIM = 10000   # NOTE: PS variables are case-insensitive - $N would collide with loop counter $n!
$totals = New-Object double[] ($LIM + 1)
$peaks  = New-Object double[] ($LIM + 1)
$totals[1] = 0; $peaks[1] = 1
$sigmaSum = 0.0; $sigmaMax = 0; $sigma1Count = 0
$totalRecords = New-Object System.Collections.ArrayList
$peakRecords  = New-Object System.Collections.ArrayList
$runTotalRec = -1.0; $runPeakRec = 0.0

for ($n = 2; $n -le $LIM; $n++) {
  $v = [double]$n; $steps = 0.0; $peak = [double]$n; $sigma = 0
  while ($true) {
    if ($v % 2 -eq 0) { $v = $v / 2 } else { $v = 3 * $v + 1 }
    $steps++
    if ($v -gt $peak) { $peak = $v }
    if ($v -lt $n) {
      $sigma = [int]$steps
      $steps += $totals[[int]$v]
      if ($peaks[[int]$v] -gt $peak) { $peak = $peaks[[int]$v] }
      break
    }
  }
  $totals[$n] = $steps; $peaks[$n] = $peak
  $sigmaSum += $sigma
  if ($sigma -gt $sigmaMax) { $sigmaMax = $sigma }
  if ($sigma -eq 1) { $sigma1Count++ }
  if ($steps -gt $runTotalRec) { $runTotalRec = $steps; [void]$totalRecords.Add("$n->$([int]$steps)") }
  if ($peak  -gt $runPeakRec)  { $runPeakRec  = $peak;  [void]$peakRecords.Add("$n->$([long]$peak)") }
}

# literature ground truth
Check "sigma_inf(27) = 111"        ([int]$totals[27])  111
Check "peak(27) = 9232"            ([long]$peaks[27])  9232
Check "sigma_inf(97) = 118"        ([int]$totals[97])  118
Check "sigma_inf(703) = 170"       ([int]$totals[703]) 170
Check "sigma_inf(6171) = 261 (record holder < 10000)" ([int]$totals[6171]) 261
Check "peak(9663) = 27,114,424"    ([long]$peaks[9663]) 27114424
CheckTrue "27->111 is a sigma_inf record"  ($totalRecords -contains "27->111")
Check "last sigma_inf record = 6171->261"  ($totalRecords[$totalRecords.Count-1]) "6171->261"
CheckTrue "703->250504 is an excursion record" ($peakRecords -contains "703->250504")
Check "last excursion record = 9663->27114424" ($peakRecords[$peakRecords.Count-1]) "9663->27114424"
$meanSigma = $sigmaSum / ($LIM - 1)
Check "mean full-map sigma = 5.1843 (deterministic)" ([math]::Round($meanSigma, 4)) 5.1843
Check "sigma=1 exactly the evens (5000 of 9999)" $sigma1Count 5000

# parity-vector census (first 8 steps, 1=odd) â€” Terras: density 2^-8 each
$parity = @{}
for ($n = 2; $n -le $LIM; $n++) {
  $v = [double]$n; $bits = ""
  for ($i = 0; $i -lt 8; $i++) {
    if ($v % 2 -eq 0) { $bits += "0"; $v = $v / 2 } else { $bits += "1"; $v = (3 * $v + 1) / 2 }   # SHORTCUT (Terras) map - full map admits no 11, only Fib(10)=55 prefixes
  }
  if ($parity.ContainsKey($bits)) { $parity[$bits]++ } else { $parity[$bits] = 1 }
}
Check "all 256 8-bit parity prefixes observed" $parity.Count 256
$pVals = $parity.Values | Measure-Object -Minimum -Maximum
CheckTrue "parity counts near-uniform (max/min < 2)" (($pVals.Maximum / [math]::Max(1,$pVals.Minimum)) -lt 2)

# nu_2(3n+1) over odd n â€” geometric law P(nu=k) = 2^-k
$nu = @{}; $oddCount = 0
for ($n = 3; $n -le $LIM; $n += 2) {
  $x = [double](3 * $n + 1); $k = 0
  while ($x % 2 -eq 0) { $x = $x / 2; $k++ }
  if ($nu.ContainsKey($k)) { $nu[$k]++ } else { $nu[$k] = 1 }
  $oddCount++
}
$f1 = $nu[1] / $oddCount; $f2 = $nu[2] / $oddCount
CheckTrue "nu=1 fraction ~0.5 (got $([math]::Round($f1,3)))"  ([math]::Abs($f1 - 0.5)  -lt 0.02)
CheckTrue "nu=2 fraction ~0.25 (got $([math]::Round($f2,3)))" ([math]::Abs($f2 - 0.25) -lt 0.02)

# â•â•â•â•â•â•â•â• B) detection ports â•â•â•â•â•â•â•â•
Write-Host "`n== B) detectStructuralProbe port ==" -ForegroundColor Cyan
$M1_TARGET   = '\b(?:collatz|3n\s*\+\s*1|3x\s*\+\s*1)\b'
$M1_RUN_VERB = '\b(?:run|compute|probe|generate|build|calculate|scan|execute|refresh)\b'
$M1_PACK_RE  = '\b(?:structural\s+probes?|probe\s+pack|m1\s+(?:probes?|pack)|structural\s+(?:features?|analysis|census|pack)|feature\s+(?:pack|census))\b'
$FAMS = @(
  '\btotal\s+stopping\s+times?\b',
  '(?<!total\s)\bstopping\s+times?\b',
  '\b(?:max(?:imum)?\s+)?excursions?\b|\bpeak\s+values?\b|\btrajectory\s+peaks?\b',
  '\bparity\s+(?:vectors?|patterns?|prefix(?:es)?|census)\b',
  '\b(?:2|two)[\s-]?adic\b|\bvaluations?\b',
  '\bresidues?(?:\s+(?:census|class(?:es)?))?\b|\bmod\s*6\b',
  '\brecord[\s-]?(?:setters?|holders?|breakers?)\b|\brecords?\b'
)
function M1-Core([string]$s) {
  if (-not [regex]::IsMatch($s, $M1_TARGET, $IC))   { return $false }
  if (-not [regex]::IsMatch($s, $M1_RUN_VERB, $IC)) { return $false }
  $famHit = $false
  foreach ($f in $FAMS) { if ([regex]::IsMatch($s, $f, $IC)) { $famHit = $true; break } }
  $pack = [regex]::IsMatch($s, $M1_PACK_RE, $IC)
  return ($pack -or $famHit)
}
function M1-Detect([string]$msg) {
  $s = $msg.Trim()
  if ($s.Length -lt 12) { return $false }
  if ($s.Length -le 240) { return (M1-Core $s) }
  foreach ($sent in [regex]::Split($s, '\n+|(?<=[.!?])\s+')) {
    $t = $sent.Trim()
    if ($t.Length -lt 12) { continue }
    if (M1-Core $t) { return $true }
  }
  return $false
}

Check "pack ask fires"            (M1-Detect "run the structural probe pack on collatz up to 100,000") $true
Check "named family fires"        (M1-Detect "compute collatz stopping times up to 50k") $true
Check "two families fire"         (M1-Detect "probe the parity vectors and 2-adic valuations of 3n+1 up to 10000") $true
Check "record setters fire"       (M1-Detect "generate the collatz record setters up to 200000") $true
Check "recall ask does NOT fire"  (M1-Detect "what do we know about collatz stopping times?") $false
Check "graph ask does NOT fire"   (M1-Detect "what does the graph have on collatz parity vectors?") $false
Check "plain discovery ask does NOT fire" (M1-Detect "verify collatz up to 100,000 and log it") $false
Check "no target does NOT fire"   (M1-Detect "compute the stopping times of the fleet") $false
$longBrief = "We reviewed the plan today and the team likes the ladder. Someone should run the deployment checklist before Friday. The collatz thread is still our main research focus, and the records we keep in the ledger are growing. Parity in the rota matters too, so keep the schedule balanced and fair for everyone involved."
Check "scattered long brief does NOT fire" (M1-Detect $longBrief) $false
$longWithAsk = "I read the round-2 synthesis again this morning and the middle-layer ladder feels right to me, especially putting the generator ahead of the literature pack. Now run the structural probe pack on collatz up to 100,000. We can review the families tomorrow."
Check "embedded probe ask in long msg fires" (M1-Detect $longWithAsk) $true

Write-Host "`n$pass passed, $fail failed" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }


