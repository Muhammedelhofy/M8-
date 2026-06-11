#
# M8 Discovery Build-2 -- .NET regex port verification (Build-2 fixes included)
# Tests: loop trigger detection, bound scaling, multi-step note parsing,
#        next-probe suggestion, follow-up loop detection.  No Node.js required.
# Run:  powershell -ExecutionPolicy Bypass -File tests/discovery-b2-verify.ps1
#

$pass = 0; $fail = 0
function Check($label, $got, $want) {
    if ("$got" -eq "$want") {
        Write-Host "  PASS  $label" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $label  got=[$got]  want=[$want]" -ForegroundColor Red
        $script:fail++
    }
}
function CheckTrue($label, $val) {
    if ($val) {
        Write-Host "  PASS  $label" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $label  (was false/null)" -ForegroundColor Red
        $script:fail++
    }
}
function CheckFalse($label, $val) {
    if (-not $val) {
        Write-Host "  PASS  $label" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $label  (expected false, was true)" -ForegroundColor Red
        $script:fail++
    }
}

# ----------------------------------------------------------------
# SECTION 1: Loop trigger detection
# ----------------------------------------------------------------
Write-Host ""
Write-Host "-- Loop trigger detection --"

$LOOP = [regex]'(?i)\bkeep\s+going\b|\bfor\s+(\d+)\s+(?:more\s+)?steps?\b|\b(\d+)\s+(?:more\s+)?steps?\b|\bautomatically(?:\s+(?:run|continue|loop))?\b|\bmulti[- ]?step\b'

$loopTrue = @(
    "verify Collatz up to 100000 and keep going for 3 steps",
    "verify twin primes up to 50,000 for 2 steps",
    "check Goldbach up to 1000, keep going for 2 steps",
    "explore fibonacci sequences up to 10^6 automatically",
    "multi-step verification of collatz up to 1M",
    "verify Collatz up to 1e5, 3 steps"
)
foreach ($s in $loopTrue) {
    CheckTrue "loop fires: $s" ($LOOP.IsMatch($s))
}

$loopFalse = @(
    "verify Collatz up to 10000 and log it",
    "check Goldbach for every even number below 10^6",
    "verify twin primes up to 50000",
    "what is 7^13",
    "log a conjecture on collatz"
)
foreach ($s in $loopFalse) {
    CheckFalse "loop silent: $s" ($LOOP.IsMatch($s))
}

# ----------------------------------------------------------------
# SECTION 2: Max steps extraction
# ----------------------------------------------------------------
Write-Host ""
Write-Host "-- Max steps extraction --"

function ExtractMaxSteps($s) {
    $m = [regex]::Match($s, '(?i)\bfor\s+(\d+)\s+(?:more\s+)?steps?\b')
    if ($m.Success) { return [Math]::Min([Math]::Max([int]$m.Groups[1].Value, 1), 5) }
    $m = [regex]::Match($s, '(?i)\b(\d+)\s+(?:more\s+)?steps?\b')
    if ($m.Success) { return [Math]::Min([Math]::Max([int]$m.Groups[1].Value, 1), 5) }
    return 3
}

Check "3 steps from 'for 3 steps'" (ExtractMaxSteps "verify collatz up to 100000 and keep going for 3 steps") 3
Check "2 steps from 'for 2 steps'" (ExtractMaxSteps "check Goldbach up to 1000, keep going for 2 steps") 2
Check "2 steps from end of sentence" (ExtractMaxSteps "verify twin primes up to 50000 for 2 steps") 2
Check "default 3 from bare keep going" (ExtractMaxSteps "verify collatz up to 1M and keep going") 3
Check "clamp to 5 max" (ExtractMaxSteps "verify collatz for 10 steps") 5
Check "clamp to 1 min" (ExtractMaxSteps "verify collatz for 0 steps") 1

# ----------------------------------------------------------------
# SECTION 3: Bound scaling
# ----------------------------------------------------------------
Write-Host ""
Write-Host "-- Bound scaling --"

function ParseBoundToNumber($s) {
    $c = ($s -replace ',|_','').Trim()
    $m = [regex]::Match($c, '^10\s*\^\s*(\d+(?:\.\d+)?)$', 'IgnoreCase')
    if ($m.Success) { return [Math]::Pow(10, [double]$m.Groups[1].Value) }
    $m = [regex]::Match($c, '^2\s*\^\s*(\d+(?:\.\d+)?)$', 'IgnoreCase')
    if ($m.Success) { return [Math]::Pow(2, [double]$m.Groups[1].Value) }
    $m = [regex]::Match($c, '^(\d+(?:\.\d+)?)[eE]\+?(\d+)$')
    if ($m.Success) { return [double]$m.Groups[1].Value * [Math]::Pow(10, [int]$m.Groups[2].Value) }
    $m = [regex]::Match($c, '^(\d+(?:\.\d+)?)\s*(million|billion|thousand|k|m|b)$', 'IgnoreCase')
    if ($m.Success) {
        $n = [double]$m.Groups[1].Value
        $sfx = $m.Groups[2].Value.ToLower()
        if ($sfx -match '^(m|million)$') { return $n * 1e6 }
        if ($sfx -match '^(b|billion)$') { return $n * 1e9 }
        if ($sfx -match '^(k|thousand)$') { return $n * 1e3 }
    }
    $n = 0.0
    if ([double]::TryParse($c, [ref]$n)) { return $n }
    return $null
}

function ScaleUpBound($bound) {
    $s = ($bound -replace ',|_','').Trim()
    $m = [regex]::Match($s, '^10\s*\^\s*(\d+)$', 'IgnoreCase')
    if ($m.Success) { return "10^$([int]$m.Groups[1].Value + 1)" }
    $m = [regex]::Match($s, '^1\s*[eE]\s*(\d+)$')
    if ($m.Success) { return "1e$([int]$m.Groups[1].Value + 1)" }
    $m = [regex]::Match($s, '^(\d+(?:\.\d+)?)\s*[eE]\s*(\d+)$')
    if ($m.Success) { return "1e$([int]$m.Groups[2].Value + 1)" }
    $m = [regex]::Match($s, '^2\s*\^\s*(\d+)$', 'IgnoreCase')
    if ($m.Success) { return "2^$([int]$m.Groups[1].Value + 4)" }
    $n = ParseBoundToNumber $s
    if ($n -eq $null) { return $bound }
    $scaled = $n * 10
    if ($scaled -ge 1e9) { return "$([Math]::Round($scaled/1e9))B" }
    if ($scaled -ge 1e6) { return "$([Math]::Round($scaled/1e6))M" }
    return [regex]::Replace([Math]::Round($scaled).ToString(), '\B(?=(\d{3})+(?!\d))', ',')
}

Check "100000 -> 1M"          (ScaleUpBound "100000")    "1M"
Check "100,000 -> 1M"         (ScaleUpBound "100,000")   "1M"
Check "10^5 -> 10^6"          (ScaleUpBound "10^5")      "10^6"
Check "10^6 -> 10^7"          (ScaleUpBound "10^6")      "10^7"
Check "1e5 -> 1e6"            (ScaleUpBound "1e5")       "1e6"
Check "1M -> 10M"             (ScaleUpBound "1M")        "10M"
Check "10M -> 100M"           (ScaleUpBound "10M")       "100M"
Check "2^20 -> 2^24"          (ScaleUpBound "2^20")      "2^24"
Check "50000 -> 500,000"      (ScaleUpBound "50000")     "500,000"
Check "1000 -> 10,000"        (ScaleUpBound "1000")      "10,000"

# ----------------------------------------------------------------
# SECTION 4: Multi-step note parsing
# ----------------------------------------------------------------
Write-Host ""
Write-Host "-- Multi-step note parsing --"

$EXEC_MARKER    = [regex]'(?i)\bcomput|python|ran\s+(?:the\s+)?(?:code|check|verification)|execut|sandbox'
$COUNTER_MARKER = [regex]'(?i)\bcounter\s*-?\s*examples?\s+(?:found|at|exists?)|\bfails?\s+(?:at|for)\s+n?\s*=?\s*\d|\bfound\s+a\s+counter'
$NO_COUNTER     = [regex]'(?i)\bno\s+counter\s*-?\s*examples?\b|\bholds?\s+(?:for|up\s+to|through)\b|\bverified\s+(?:up\s+to|through|for)\b'
$STEP_RE        = [regex]'(?is)Step\s+(\d+)\s*\(bound\s*([^)]+)\)\s*:\s*([\s\S]*?)(?=Step\s+\d+\s*\(bound|Exploration\s+complete|Logged\s+to|$)'

function ParseDiscoveryNotes($resp) {
    if (-not $EXEC_MARKER.IsMatch($resp)) { return @() }
    $notes = @()
    foreach ($m in $STEP_RE.Matches($resp)) {
        $text = $m.Groups[3].Value.Trim()
        if ($text.Length -gt 5) {
            $isCounter = $COUNTER_MARKER.IsMatch($text) -and (-not $NO_COUNTER.IsMatch($text))
            $notes += [pscustomobject]@{
                StepNum = [int]$m.Groups[1].Value
                Bound   = $m.Groups[2].Value.Trim()
                Kind    = if ($isCounter) { "counterexample" } else { "evidence" }
            }
        }
    }
    return $notes
}

# Normal 3-step response (single-quoted heredoc -- no PS interpolation)
$multiResp = @'
Ran the Python code for 3 bounds.
Step 1 (bound 100,000): No counterexample found through 100,000. All values verified.
Step 2 (bound 1,000,000): No counterexample found through 1,000,000. All values verified.
Step 3 (bound 10,000,000): No counterexample found through 10,000,000. All values verified.
Exploration complete: checked 100,000 through 10,000,000, 10,000,000 total cases, no counterexample.
Logged to the notebook.
'@

$notes = ParseDiscoveryNotes $multiResp
Check "3 steps parsed"         $notes.Count            3
Check "step 1 kind = evidence" $notes[0].Kind          "evidence"
Check "step 2 kind = evidence" $notes[1].Kind          "evidence"
Check "step 3 kind = evidence" $notes[2].Kind          "evidence"
Check "step 1 bound"           $notes[0].Bound         "100,000"
Check "step 2 bound"           $notes[1].Bound         "1,000,000"
Check "step 3 bound"           $notes[2].Bound         "10,000,000"

# Counterexample in step 2 -- step 3 should still be logged (parsing is not the loop guard,
# the JS code stops persisting after counterexample; here we just check parsing)
$counterResp = @'
Ran the code in Python.
Step 1 (bound 100): No counterexample found through 100.
Step 2 (bound 1,000): Counterexample found at n=27 with value exceeding expected.
Step 3 (bound 10,000): Skipped -- counterexample already found.
Logged to the notebook.
'@
$cNotes = ParseDiscoveryNotes $counterResp
# Use a loop so PS-5.1 single-object-vs-array unwrapping doesn't hide .Count
$counterCount = 0
foreach ($n in $cNotes) { if ($n.Kind -eq "counterexample") { $counterCount++ } }
CheckTrue "counterexample step logged" ($counterCount -ge 1)

# No exec marker -> no notes
$noExecResp = "The Collatz conjecture holds for all numbers up to 100,000 based on known results."
$noExecNotes = ParseDiscoveryNotes $noExecResp
Check "no exec marker -> 0 notes" $noExecNotes.Count 0

# ----------------------------------------------------------------
# SECTION 5: Next-probe suggestion
# ----------------------------------------------------------------
Write-Host ""
Write-Host "-- Next-probe suggestion --"

function SuggestNextProbe($lastBound, $foundCounter, $thread) {
    $t = ($thread -replace '-',' ')
    if ($foundCounter) {
        return "narrow down to find the minimal counterexample in the $t problem"
    }
    if (-not $lastBound) { return $null }
    $next = ScaleUpBound $lastBound
    return "verify $t up to $next and log it"
}

Check "single-step next command" `
    (SuggestNextProbe "10,000" $false "collatz") `
    "verify collatz up to 100,000 and log it"

Check "loop end scales from last bound" `
    (SuggestNextProbe "10,000,000" $false "collatz") `
    "verify collatz up to 100M and log it"

Check "counterexample -> narrow down" `
    (SuggestNextProbe "1,000" $true "goldbach") `
    "narrow down to find the minimal counterexample in the goldbach problem"

Check "slug to readable (twin-primes)" `
    (SuggestNextProbe "50,000" $false "twin-primes") `
    "verify twin primes up to 500,000 and log it"

$nullSugg = SuggestNextProbe $null $false "collatz"
CheckTrue "null bound -> no suggestion" ($nullSugg -eq $null)

# ----------------------------------------------------------------
# SECTION 6: Follow-up loop detection (bare "keep going" follow-up)
# ----------------------------------------------------------------
Write-Host ""
Write-Host "-- Follow-up loop detection --"

# Port of NEXT_PROBE_RE and detectFollowUpLoop from discovery.js
$NEXT_PROBE_RE   = [regex]'▶ Next probe:\s*`([^`]+)`'
$DISC_BOUND_PORT = [regex]'(?i)\b(?:up\s+to|below|under|first|to)\s+(?:n\s*=\s*)?(\d[\d,_]*(?:\.\d+)?(?:\s*(?:million|billion|thousand|k|m))?|10\s*\^\s*\d+|1e\d+|2\s*\^\s*\d+)\b'
$RUN_VERB_PORT   = [regex]'(?i)\b(verify|check|test|explore|search|scan|run|confirm|probe|compute)\b'
$RTARGET_PORT    = [regex]'(?i)\b(conjecture|hypothesis|collatz|goldbach|twin\s+primes?|primes?|perfect\s+numbers?|fibonacci|oeis|sequence|riemann|mersenne|fermat)\b'

function IsDiscovery($cmd) {
    if (-not $RUN_VERB_PORT.IsMatch($cmd)) { return $false }
    if (-not $RTARGET_PORT.IsMatch($cmd))  { return $false }
    $bm = $DISC_BOUND_PORT.Match($cmd)
    return $bm.Success
}

function ExtractFollowUpLoop($msg, $priorAssistant) {
    if (-not $LOOP.IsMatch($msg)) { return $null }
    $m = $NEXT_PROBE_RE.Match($priorAssistant)
    if (-not $m.Success) { return $null }
    $cmd = $m.Groups[1].Value.Trim()
    if (-not (IsDiscovery $cmd)) { return $null }
    $bm = $DISC_BOUND_PORT.Match($cmd)
    return @{
        looped   = $true
        bound    = $bm.Groups[1].Value
        maxSteps = ExtractMaxSteps $msg
    }
}

$priorResp = "Ran code for Collatz. No counterexample found through 10,000.`n" +
             "Logged to the notebook.`n" +
             "``n▶ Next probe: ``verify collatz up to 100,000 and log it```n"

# Hack: embed the coda directly since PS string interpolation of backticks is tricky
$priorResp = "No counterexample found through 10,000. Logged.`n▶ Next probe: ``verify collatz up to 100,000 and log it``"

$r1 = ExtractFollowUpLoop "keep going" $priorResp
CheckTrue "followup: 'keep going' fires when prior coda present" ($r1 -ne $null)
Check     "followup: extracts bound 100,000"                     $r1.bound    "100,000"
Check     "followup: default maxSteps = 3"                       $r1.maxSteps 3

$r2 = ExtractFollowUpLoop "keep going for 2 steps" $priorResp
CheckTrue "followup: 'for 2 steps' fires"     ($r2 -ne $null)
Check     "followup: maxSteps = 2 from msg"   $r2.maxSteps 2

$r3 = ExtractFollowUpLoop "keep going" "No prior coda here. Just a regular response."
CheckTrue "followup: no coda -> null" ($r3 -eq $null)

$r4 = ExtractFollowUpLoop "how did the fleet do yesterday" $priorResp
CheckTrue "followup: non-loop msg -> null" ($r4 -eq $null)

$tpResp = "Ran twin prime check. No issues through 50,000.`n▶ Next probe: ``verify twin primes up to 500,000 and log it``"
$r5 = ExtractFollowUpLoop "continue for 3 steps" $tpResp
CheckTrue "followup: twin primes thread detected"          ($r5 -ne $null)
Check     "followup: twin primes bound = 500,000"          $r5.bound "500,000"

# ----------------------------------------------------------------
# SUMMARY
# ----------------------------------------------------------------
Write-Host ""
Write-Host "-- Results --"
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host "  PASS: $pass   FAIL: $fail" -ForegroundColor $color
if ($fail -gt 0) { exit 1 } else { exit 0 }
