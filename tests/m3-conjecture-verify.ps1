# m3-conjecture-verify.ps1 -- Build-14 (M3-lite) offline verification.
# Three parts (no local node -- JS is verified live after deploy):
#   A) DETECTION: regex ports of detectConjectureGen -- fires only on explicit
#      run-the-generator asks; recall questions, M1 probe asks, discovery asks
#      and long pasted briefs must NOT fire.
#   B) FALSIFIER: a PowerShell mirror of computeFeatureTable + falsify, run at
#      LIM=10,000 and checked against KNOWN Collatz ground truth (sigma_inf(27)
#      = 111 is the first n exceeding 100; sigma(n)=1 exactly for even n;
#      nu2(3n+1)=2 exactly for n = 1 (mod 8) -> density 25% = 2^-2).
#   C) GATE + VACUITY arithmetic: pure-function mirrors with hand cases.
# Pure ASCII (PS 5.1 reads no-BOM UTF-8 as ANSI).

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

# ================= A) detection regex ports =================
Write-Host "`n== A) detectConjectureGen regex ports ==" -ForegroundColor Cyan
$M3_TARGET   = '\b(?:collatz|3n\s*\+\s*1|3x\s*\+\s*1)\b'
$M3_GEN_RE   = '\b(?:conjecture\s+generat(?:or|ion)|generate\s+(?:some\s+|new\s+|\d+\s+)?conjectures?|m3[-\s]?lite|m3\s+(?:generator|run)|run\s+m3)\b'
$M3_RUN_VERB = '\b(?:run|generate|execute|launch|fire|start|kick\s+off)\b'

function DetectCore([string]$s) {
  return ([regex]::IsMatch($s, $M3_TARGET, $IC)) -and
         ([regex]::IsMatch($s, $M3_GEN_RE, $IC)) -and
         ([regex]::IsMatch($s, $M3_RUN_VERB, $IC))
}

Check "fires: run the conjecture generator on collatz up to 100,000" (DetectCore "run the conjecture generator on collatz up to 100,000") True
Check "fires: generate conjectures about collatz stopping times" (DetectCore "generate conjectures about collatz stopping times") True
Check "fires: run m3-lite on collatz" (DetectCore "run m3-lite on collatz") True
Check "fires: kick off the m3 generator on 3n+1 up to 50k seed 42" (DetectCore "kick off the m3 generator on 3n+1 up to 50k seed 42") True
Check "fires: generate 20 conjectures on collatz" (DetectCore "generate 20 conjectures on collatz") True
Check "no fire: what conjectures do we have on collatz?" (DetectCore "what conjectures do we have on collatz?") False
Check "no fire: run the structural probes on collatz up to 100000 (M1's)" (DetectCore "run the structural probes on collatz up to 100000") False
Check "no fire: verify collatz up to 100,000 and log it (discovery's)" (DetectCore "verify collatz up to 100,000 and log it") False
Check "no fire: the conjecture generator on collatz is a cool idea" (DetectCore "the conjecture generator on collatz is a cool idea") False
Check "no fire: generate conjectures about goldbach (wrong target)" (DetectCore "generate conjectures about goldbach") False
Check "no fire: tell me about the collatz conjecture" (DetectCore "tell me about the collatz conjecture") False

# sentence-scoping discipline (the S6 coda-leak lesson): a long paste with the
# signal words spread across DIFFERENT sentences must not fire per-sentence.
$paste = "The team reviewed collatz work this week and liked the census. " +
         "We should generate more documentation soon for the wider effort. " +
         "Several conjectures from the literature were discussed in depth too. " +
         "Overall the round went well and the next sync is planned for Friday, with more reviewers joining us then."
$fired = $false
foreach ($sent in ($paste -split '(?<=[.!?])\s+')) { if ($sent.Length -ge 12 -and (DetectCore $sent)) { $fired = $true } }
CheckTrue "no fire: long paste, signals in different sentences" (-not $fired)

# seed + bound extraction
$m = [regex]::Match("kick off the m3 generator on collatz up to 50k seed 42", '\bseed\s+(\d{1,9})\b', $IC)
Check "seed parsed" $m.Groups[1].Value "42"
$b = [regex]::Match("run the conjecture generator on collatz up to 100,000", '\b(?:up\s+to|below|under|to)\s+(?:n\s*=\s*)?(\d[\d,_]*)', $IC)
Check "bound parsed" ($b.Groups[1].Value -replace ',','') "100000"

# ================= B) falsifier mirror vs known ground truth =================
Write-Host "`n== B) feature table + falsifier mirror (LIM=10,000) ==" -ForegroundColor Cyan
$LIM = 10000   # NOTE: PS variables are case-insensitive - $N would collide with loop counter $n
$sigma = New-Object int[] ($LIM + 1)
$total = New-Object double[] ($LIM + 1)
$peak  = New-Object double[] ($LIM + 1)
$nu    = New-Object int[] ($LIM + 1)
$total[1] = 0; $peak[1] = 1

for ($n = 2; $n -le $LIM; $n++) {
  $v = [double]$n; $steps = 0.0; $pk = [double]$n; $sg = 0
  while ($true) {
    if ($v % 2 -eq 0) { $v = $v / 2 } else { $v = 3 * $v + 1 }
    $steps++
    if ($v -gt $pk) { $pk = $v }
    if ($v -lt $n) {
      $sg = [int]$steps
      $steps += $total[[int]$v]
      if ($peak[[int]$v] -gt $pk) { $pk = $peak[[int]$v] }
      break
    }
  }
  $sigma[$n] = $sg; $total[$n] = $steps; $peak[$n] = $pk
  if ($n % 2 -eq 1) {
    $x = 3 * $n + 1; $k = 0
    while ($x % 2 -eq 0) { $x = $x / 2; $k++ }
    $nu[$n] = $k
  }
}

# ground truth anchors (literature)
Check "sigma_inf(27) = 111" $total[27] 111
Check "peak(27) = 9232" $peak[27] 9232
Check "sigma(even) = 1 (n=9998)" $sigma[9998] 1

# falsify mirror: A_total_log-style flat bound "sigma_inf(n) <= 100" must be
# killed with FIRST counterexample n=27 (no smaller n exceeds 100).
$counter = 0
for ($n = 2; $n -le $LIM; $n++) { if ($total[$n] -gt 100) { $counter = $n; break } }
Check "first n with sigma_inf > 100 is 27" $counter 27

# A_res_sigma_max mirror on an all-even class would be trivial (sigma=1):
# the template excludes it -- classHasOdd(m even, r even) = false.
function ClassHasOdd([int]$m, [int]$r) { return ($m % 2 -eq 1) -or ($r % 2 -eq 1) }
Check "classHasOdd(6,4) excluded" (ClassHasOdd 6 4) False
Check "classHasOdd(6,1) allowed"  (ClassHasOdd 6 1) True
Check "classHasOdd(3,0) allowed (odd modulus = mixed class)" (ClassHasOdd 3 0) True

# B_sigma_freq mirror: sigma(n) <= 1 holds for exactly the even n.
# evens in [2,10000] = 5000 of 9999 values -> 50.005%.
$cnt = 0
for ($n = 2; $n -le $LIM; $n++) { if ($sigma[$n] -le 1) { $cnt++ } }
$obs = 100.0 * $cnt / ($LIM - 1)
CheckTrue "B_sigma_freq observed ~50.005% (got $([math]::Round($obs,3)))" ([math]::Abs($obs - 50.005) -lt 0.01)
CheckTrue "claim 'at least 49%' survives" ($obs -ge 49)
CheckTrue "claim 'at least 51%' is killed" (-not ($obs -ge 51))

# B_nu_geo mirror: nu2(3n+1)=2 exactly when n = 1 (mod 8) -> density 25% = 2^-2.
$cnt = 0; $odd = 0
for ($n = 3; $n -le $LIM; $n += 2) { if ($nu[$n] -eq 2) { $cnt++ }; $odd++ }
$obs = 100.0 * $cnt / $odd
$dev = [math]::Abs($obs - 25.0)
CheckTrue "B_nu_geo k=2 deviation from 25% under 0.25pp (dev=$([math]::Round($dev,4)))" ($dev -le 0.25)

# A_nu_total_max domain sanity: odd n with nu>=4 exist below 10k and their
# sigma_inf varies (non-local feature -- the A2-safe implication target).
$mx = 0; $found = 0
for ($n = 3; $n -le $LIM; $n += 2) { if ($nu[$n] -ge 4) { $found++; if ($total[$n] -gt $mx) { $mx = $total[$n] } } }
CheckTrue "nu>=4 class non-empty ($found members)" ($found -gt 100)
CheckTrue "nu>=4 max sigma_inf varies (max=$mx > 20)" ($mx -gt 20)

# ================= C) gate + vacuity arithmetic =================
Write-Host "`n== C) gate + vacuity mirrors ==" -ForegroundColor Cyan
function GatePass([int]$ms, [int]$mt, [int]$bs, [int]$bt) {
  $mr = $ms / $mt; $br = $bs / $bt
  if ($ms -lt 1) { return $false }
  if ($br -eq 0) { return $true }
  return $mr -ge (2 * $br)
}
Check "gate: 5/30 vs 1/30 -> PASS" (GatePass 5 30 1 30) True
Check "gate: 2/30 vs 2/30 -> FAIL" (GatePass 2 30 2 30) False
Check "gate: 1/30 vs 0/30 -> PASS (baseline zero)" (GatePass 1 30 0 30) True
Check "gate: 0/30 vs 0/30 -> FAIL (no survivors)" (GatePass 0 30 0 30) False
Check "gate: 4/30 vs 2/30 -> PASS (exactly 2x)" (GatePass 4 30 2 30) True

# vacuity (Type A ratio rule, VACUITY_RATIO=1.5): claimed c vs needed c
function VacA([double]$c, [double]$need) { return $c -gt ([math]::Max($need, 1) * 1.5) }
Check "vacuous: sigma claim c=119 when observed max 60" (VacA 119 60) True
Check "not vacuous: c=65 when observed max 60" (VacA 65 60) False
# vacuity (B_sigma_freq, VAC_FREQ_PP=5): observed - claimed > 5pp
function VacBFreq([double]$obsv, [double]$p) { return ($obsv - $p) -gt 5 }
Check "vacuous: claims 40% when observed 50%" (VacBFreq 50 40) True
Check "not vacuous: claims 49.5% when observed 50%" (VacBFreq 50 49.5) False

# canonical statement determinism (the graph dedup key)
function StmtResSigma([int]$mm, [int]$rr, [int]$cc, [string]$NN) {
  return "for all n <= $NN with n = $rr (mod $mm): stopping time sigma(n) <= $cc"
}
Check "statement canonical + deterministic" (StmtResSigma 6 1 96 "100,000") (StmtResSigma 6 1 96 "100,000")

# ================= summary =================
Write-Host "`n=================================================="
Write-Host ("  M3-lite offline verification: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
