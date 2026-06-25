# Build-140 — PS-5.1 mirror of isTransientFact() (lib/memory.js).
# A time-bound lookup (weather / price / score / daily fleet snapshot / loop seed)
# must be BLOCKED from durable memory; business config, family, and research facts
# must be KEPT.
# Run:  powershell -ExecutionPolicy Bypass -File M8\tests\build140-memory-hygiene-test.ps1

$ErrorActionPreference = "Stop"

function Test-Transient([string]$s) {
    $s = $s.ToLower()
    if ($s -match '\b(weather|forecast|humidity|precipitation|temperature)\b|°\s?[cf]\b') { return $true }
    if ($s -match '\b(stock|share|crypto)\s+price\b|\bprice\s+(was|is)\s+(approximately\s+)?\$?\d') { return $true }
    if (($s -match '\b(cheapest\s+)?(flight|round-trip|one-way)\b') -and ($s -match '\$?\d')) { return $true }
    if ($s -match '\b(beat|defeated|drew|lost)\b[^.]*\b\d\s*-\s*\d\b|\bfinal score\b|\bfriendly (match|football)\b') { return $true }
    if ($s -match '(\bactive\b[^.]*\bdrivers?\b|\bdrivers?\b[^.]*\bactive\b)[^.]*\bon\b|\babsent for the last\b|\bacceptance rate (was|of)\b|\butilization rate\b|\bearned\s+\d[\d,]*\s*sar\b[^.]*\b(on|today|yesterday)\b') { return $true }
    if ($s -match '\bautonomous loop run\b[^.]*\bseed\b|\bused seed\b') { return $true }
    return $false
}

$cases = @(
    # --- should BLOCK (transient junk) ---
    @("weather",        "Alexandria, Egypt, on June 8, 2026, is expected to have a high of 93°F (34°C).", $true),
    @("stock price",    "As of June 5, 2026, Tesla (TSLA) stock price was approximately `$391.00.",       $true),
    @("flight price",   "The cheapest one-way flight from Riyadh to Alexandria starts at `$118.",          $true),
    @("sports score",   "Brazil beat Egypt 2-1 in an international friendly football match.",              $true),
    @("active drivers", "30 out of 38 drivers were active on June 19th.",                                  $true),
    @("active drivers2","There were 26 active drivers on June 21st.",                                      $true),
    @("driver absent",  "ABDULRAHMAN ALSHAHRANI has been absent for the last 5 days.",                     $true),
    @("acceptance rate","The average acceptance rate was 86% on June 6, 2026.",                            $true),
    @("daily perf",     "On June 6, 2026, Mansour Alshehri earned 112 SAR with a 48% utilization rate.",   $true),
    @("loop seed",      "The autonomous loop run on 2026-06-14 used seed 20281219.",                       $true),
    # --- should KEEP (durable) ---
    @("family",         "Muhammad's wife is Sara.",                                                        $false),
    @("rent config",    "The monthly office rent is 6,000 SAR.",                                           $false),
    @("fleet size",     "Muhammad's fleet has 38 drivers.",                                                $false),
    @("research",       "The Collatz Conjecture remains unsolved.",                                        $false),
    @("book fact",      "Arktos by Joscelyn Godwin explores esoteric mythological concepts.",              $false),
    @("target",         "The monthly bonus target is 5000 SAR net per driver.",                            $false)
)

$pass = 0; $fail = 0
foreach ($c in $cases) {
    $got = Test-Transient $c[1]
    if ($got -eq $c[2]) { $pass++; "PASS  $($c[0])" } else { $fail++; "FAIL  $($c[0])  expected '$($c[2])' got '$got'  <= '$($c[1])'" }
}
""
"Result: $pass passed, $fail failed, $($cases.Count) total"
if ($fail -gt 0) { exit 1 } else { exit 0 }
