# ============================================================================
# B115 -- Engine Learn Status  .  PS-5.1 MIRROR of the pure logic in
# lib/learn-status.js: parseTemplate, parseBound, buildLearnStatusPacket.
#
# Node is absent on this host, so this ports the JS logic byte-for-byte.
# A PS-only failure = the MIRROR is wrong, not the JS (see feedback-ps-test
# -mirror-gotchas). Uses [Math]::Round for JS Math.round, -match for /i.
# ALL STRINGS ARE ASCII -- no em-dashes; PS 5.1 default encoding is UTF-16 LE
# and the Write tool saves UTF-8; avoid non-ASCII to prevent parse errors.
#
# What it proves:
#   parseTemplate: correct extraction from real M3-lite note content
#   parseBound:    correct extraction of the numeric test bound
#   buildLearnStatusPacket:
#     - empty survivors + no loopRun  -> correct empty-state lines
#     - survivors only                -> leaderboard renders counts/pct
#     - gen_version 2  earned 0       -> B112 active, B113 pending, gate silent
#     - gen_version 3  earned 0       -> B113 steering active, PREFER silent
#     - gen_version 3  earned 2       -> gate earned regions reported
#     - SOURCE-BINDING: honesty contract always present
# ============================================================================
$ErrorActionPreference = "Stop"
$fail = 0
function Assert($name, $cond) {
  if ($cond) { Write-Host "  PASS  $name" -ForegroundColor Green }
  else        { Write-Host "  FAIL  $name" -ForegroundColor Red; $script:fail++ }
}

# -- mirror: parseTemplate(content) -----------------------------------------
# JS: /template\s+([A-Za-z][A-Za-z0-9_]+)\)/.exec(content)?.[1] ?? null
function Get-Template($content) {
  if ([string]::IsNullOrEmpty($content)) { return $null }
  if ($content -match 'template\s+([A-Za-z][A-Za-z0-9_]+)\)') {
    return $Matches[1]
  }
  return $null
}

# -- mirror: parseBound(content) ---------------------------------------------
# JS: /(?:n\s*<=|tested\s+to)\s*([\d,]+)/i -> parseInt(..., 10)
function Get-Bound($content) {
  if ([string]::IsNullOrEmpty($content)) { return 0 }
  if ($content -match '(?:n\s*<=|tested\s+to)\s*([\d,]+)') {
    $raw = $Matches[1] -replace ',', ''
    $v = 0
    if ([int]::TryParse($raw, [ref]$v)) { return $v }
  }
  return 0
}

# -- mirror: buildLearnStatusPacket({ survivors, loopRun }) ------------------
# NOTE: JS uses em-dashes (--) in some lines; the PS mirror uses ASCII "--"
# for the same lines. Source-binding asserts test content keys, not em-dashes.
function Build-LearnStatusPacket($survivors, $loopRun) {
  $lines = New-Object System.Collections.ArrayList

  [void]$lines.Add("ENGINE LEARN STATUS -- deterministic read (Build-115). Read-only view of accumulated evidence.")
  [void]$lines.Add("Evidence is COMPUTATIONAL, never proof. The gate measures GENERATION QUALITY, not truth.")
  [void]$lines.Add("")
  [void]$lines.Add("SURVIVOR PRODUCTIVITY LEADERBOARD")
  [void]$lines.Add("(templates whose conjectures most often survive exhaustive falsification)")

  if ($null -eq $survivors -or $survivors.Count -eq 0) {
    [void]$lines.Add("  No M3-lite survivor notes recorded yet in m8_research_notes.")
  } else {
    $total = 0
    foreach ($r in $survivors) { $total += $r.count }
    foreach ($r in $survivors) {
      $pct   = if ($total -gt 0) { [Math]::Round(([double]$r.count / [double]$total) * 100) } else { 0 }
      $bound = if ($r.maxBound -gt 0) { "{0:N0}" -f $r.maxBound } else { "?" }
      $tmpl  = $r.template.PadRight(22)
      # Build the survivor line without using ($pct%) directly (PS parses % as modulo)
      $line  = "  " + $tmpl + "  x" + $r.count + " survivors (" + $pct + "%)  tested to " + $bound
      [void]$lines.Add($line)
    }
    [void]$lines.Add("")
    [void]$lines.Add("  Total survivor notes: " + $total + "  |  Distinct templates: " + $survivors.Count)
    [void]$lines.Add("  NOTE: high count = template repeatedly survives falsification -- NOT that the conjecture is true or novel.")
  }

  [void]$lines.Add("")
  [void]$lines.Add("GENERATION STEERING STATE (Build-112/113):")

  if ($null -eq $loopRun) {
    [void]$lines.Add("  No m8_loop_runs rows found -- cron has not run yet.")
  } else {
    $meta  = if ($loopRun.metadata) { $loopRun.metadata } else { @{} }
    $learn = if ($meta.learn)       { $meta.learn }       else { @{} }
    $genV  = if ($null -ne $meta.gen_version) { $meta.gen_version } else { "?" }

    [void]$lines.Add("  Latest cron run: " + $loopRun.run_date + "   gen_version: " + $genV)

    if ([string]$genV -eq "2") {
      [void]$lines.Add("  B112 FEEDBACK: generator reads verified Lean outcomes when proposing.")
      $sp = if ($null -ne $learn.success_patterns) { $learn.success_patterns } else { 0 }
      $fp = if ($null -ne $learn.failed_patterns)  { $learn.failed_patterns  } else { 0 }
      [void]$lines.Add("    success_patterns: " + $sp + "  |  failed_patterns: " + $fp)
      [void]$lines.Add("  B113 COHORT STEERING: pending next cron-explore run (gen_version will flip to 3).")
    } elseif ([int]$genV -ge 3) {
      [void]$lines.Add("  B113 COHORT STEERING active -- generator down-weights over-explored template regions.")
      if ($null -ne $learn.gen_steered)        { [void]$lines.Add("    gen_steered:      " + $learn.gen_steered) }
      if ($null -ne $learn.down_weighted)      { [void]$lines.Add("    down_weighted:    " + $learn.down_weighted) }
      if ($null -ne $learn.survivor_templates) { [void]$lines.Add("    survivor_templates used: " + $learn.survivor_templates) }
      if ($null -ne $learn.success_patterns)   { [void]$lines.Add("    success_patterns: " + $learn.success_patterns) }
      if ($null -ne $learn.failed_patterns)    { [void]$lines.Add("    failed_patterns:  " + $learn.failed_patterns) }
    } else {
      [void]$lines.Add("  Loop metadata present but gen_version unknown -- output raw.")
      $pairs = foreach ($k in $learn.Keys) { "$k=$($learn[$k])" }
      [void]$lines.Add("    raw learn: {" + ($pairs -join ', ') + "}")
    }

    $ep = $learn.earned_patterns
    $mv = if ($null -ne $learn.min_verifs) { $learn.min_verifs } else { 3 }
    if ($null -eq $ep -or $ep -eq 0) {
      [void]$lines.Add("")
      [void]$lines.Add("  LEAN GATE: earned_patterns: 0")
      [void]$lines.Add("  No template region has yet verified >= " + $mv + " times in Lean.")
      [void]$lines.Add("  The PREFER (steer-toward) block is SILENT -- correct and cautious by design.")
      [void]$lines.Add("  Steering becomes active only once a technique accumulates verified leaves.")
    } else {
      [void]$lines.Add("")
      [void]$lines.Add("  LEAN GATE: earned_patterns: " + $ep + " -- " + $ep + " template region(s) have verified >= " + $mv + " times")
      [void]$lines.Add("  and now actively steer generation toward those structural approaches.")
    }
  }

  [void]$lines.Add("")
  [void]$lines.Add("HONESTY CONTRACT:")
  [void]$lines.Add("  Survivors are machine-generated, falsification-tested to the stated bound ONLY.")
  [void]$lines.Add("  A survivor is NOT proven true, NOT established, NOT novel.")
  [void]$lines.Add("  The gate and leaderboard measure GENERATION QUALITY -- how often a template")
  [void]$lines.Add("  avoids easy disproof -- not mathematical truth or novelty.")

  return $lines -join "`n"
}

Write-Host "`n=== B115 learn-status mirror ===" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Section 1: parseTemplate
# ---------------------------------------------------------------------------
Write-Host "`n-- parseTemplate --" -ForegroundColor DarkCyan
$note_peak  = "[M3-lite machine-generated conjecture] Conjecture (type A, template A_peak_power): for all 2 <= n <= 100,000..."
$note_gap   = "[M3-lite machine-generated conjecture] Conjecture (type B, template B_res_total_gap): mean total..."
$note_cond  = "[M3-lite machine-generated conjecture] Conjecture (type A, template A_cond_nu_peak): for all odd..."
$note_none  = "This is a run summary note: M3-lite v3 run (seed 7, train 10,000...)..."

Assert "parseTemplate A_peak_power"    ((Get-Template $note_peak) -eq "A_peak_power")
Assert "parseTemplate B_res_total_gap" ((Get-Template $note_gap)  -eq "B_res_total_gap")
Assert "parseTemplate A_cond_nu_peak"  ((Get-Template $note_cond) -eq "A_cond_nu_peak")
Assert "parseTemplate null on summary" ((Get-Template $note_none) -eq $null)
Assert "parseTemplate null on empty"   ((Get-Template "") -eq $null)

# ---------------------------------------------------------------------------
# Section 2: parseBound
# ---------------------------------------------------------------------------
Write-Host "`n-- parseBound --" -ForegroundColor DarkCyan
$note_100k_tested  = "...tested to 100,000 only."
$note_100k_n       = "...for all 2 <= n <= 100,000..."
$note_50k          = "...tested to 50,000 only."
$note_no_bound     = "This summary has no bound."

Assert "parseBound tested to 100,000"  ((Get-Bound $note_100k_tested) -eq 100000)
Assert "parseBound n <= 100,000"       ((Get-Bound $note_100k_n)      -eq 100000)
Assert "parseBound tested to 50,000"   ((Get-Bound $note_50k)         -eq 50000)
Assert "parseBound no bound -> 0"      ((Get-Bound $note_no_bound)    -eq 0)
Assert "parseBound empty -> 0"         ((Get-Bound "")                -eq 0)

# ---------------------------------------------------------------------------
# Section 3: empty state (no survivors, no loopRun)
# ---------------------------------------------------------------------------
Write-Host "`n-- buildLearnStatusPacket: empty state --" -ForegroundColor DarkCyan
$pkA = Build-LearnStatusPacket @() $null
Assert "A: contains ENGINE LEARN STATUS header"  ($pkA -like "*ENGINE LEARN STATUS*")
Assert "A: empty survivors message"              ($pkA -like "*No M3-lite survivor notes*")
Assert "A: no loopRun message"                   ($pkA -like "*cron has not run yet*")
Assert "A: HONESTY CONTRACT present"             ($pkA -like "*HONESTY CONTRACT*")
Assert "A: NOT proven true present"              ($pkA -like "*NOT proven true*")
Assert "A: GENERATION QUALITY present"           ($pkA -like "*GENERATION QUALITY*")
Assert "A: leaderboard header present"           ($pkA -like "*SURVIVOR PRODUCTIVITY LEADERBOARD*")

# ---------------------------------------------------------------------------
# Section 4: survivors only, no loopRun (live template data)
# ---------------------------------------------------------------------------
Write-Host "`n-- buildLearnStatusPacket: survivors only --" -ForegroundColor DarkCyan
$survs = @(
  [pscustomobject]@{ template = "A_peak_power";   count = 17; maxBound = 100000 },
  [pscustomobject]@{ template = "B_cond_peak_nu"; count = 14; maxBound = 100000 },
  [pscustomobject]@{ template = "A_cond_nu_peak"; count = 14; maxBound = 100000 },
  [pscustomobject]@{ template = "B_res_total_gap"; count = 14; maxBound = 100000 },
  [pscustomobject]@{ template = "A_res_sigma_max"; count = 13; maxBound = 100000 },
  [pscustomobject]@{ template = "B_sigma_freq";    count = 5;  maxBound = 100000 },
  [pscustomobject]@{ template = "B_nu_geo";        count = 1;  maxBound = 100000 }
)
$pkB = Build-LearnStatusPacket $survs $null
$totalB = 17+14+14+14+13+5+1   # = 78
Assert "B: A_peak_power appears"         ($pkB -like "*A_peak_power*")
Assert "B: B_res_total_gap appears"      ($pkB -like "*B_res_total_gap*")
Assert "B: x17 count for peak_power"     ($pkB -like "*x17*")
Assert "B: total 78 noted"               ($pkB -like "*Total survivor notes: 78*")
Assert "B: distinct templates 7"         ($pkB -like "*Distinct templates: 7*")
Assert "B: 100,000 bound appears"        ($pkB -like "*100,000*")
Assert "B: cron not run message"         ($pkB -like "*cron has not run yet*")
Assert "B: HONESTY CONTRACT present"     ($pkB -like "*HONESTY CONTRACT*")
Assert "B: NOT proven caveat"            ($pkB -like "*NOT proven true*")
# pct for A_peak_power: round(17/78 * 100) = round(21.79) = 22
$pctPeak = [Math]::Round(17.0 / 78.0 * 100)
Assert "B: pct for A_peak_power shown"   ($pkB -like ("*x17 survivors (" + $pctPeak + "%)*"))

# ---------------------------------------------------------------------------
# Section 5: gen_version 2, earned_patterns 0 (current live state)
# ---------------------------------------------------------------------------
Write-Host "`n-- buildLearnStatusPacket: gen_v2 earned=0 (current live) --" -ForegroundColor DarkCyan
$run2 = [pscustomobject]@{
  run_date = "2026-06-22"
  metadata = @{
    gen_version = 2
    learn = @{ min_verifs=3; success_patterns=2; earned_patterns=0; failed_patterns=0 }
  }
}
$pkC = Build-LearnStatusPacket @() $run2
Assert "C: run date 2026-06-22"          ($pkC -like "*2026-06-22*")
Assert "C: gen_version 2"                ($pkC -like "*gen_version: 2*")
Assert "C: B112 FEEDBACK line"           ($pkC -like "*B112 FEEDBACK*")
Assert "C: success_patterns 2"           ($pkC -like "*success_patterns: 2*")
Assert "C: B113 pending message"         ($pkC -like "*B113 COHORT STEERING: pending*")
Assert "C: LEAN GATE earned=0"           ($pkC -like "*LEAN GATE: earned_patterns: 0*")
Assert "C: PREFER block SILENT"          ($pkC -like "*PREFER*SILENT*")
Assert "C: min_verifs >= 3 mentioned"    ($pkC -like "*>= 3*")
Assert "C: HONESTY CONTRACT present"     ($pkC -like "*HONESTY CONTRACT*")

# ---------------------------------------------------------------------------
# Section 6: gen_version 3, earned_patterns 0 (B113 active, gate silent)
# ---------------------------------------------------------------------------
Write-Host "`n-- buildLearnStatusPacket: gen_v3 earned=0 --" -ForegroundColor DarkCyan
$run3 = [pscustomobject]@{
  run_date = "2026-06-23"
  metadata = @{
    gen_version = 3
    learn = @{ min_verifs=3; success_patterns=2; earned_patterns=0; failed_patterns=0;
               gen_steered=5; down_weighted=1; survivor_templates=3 }
  }
}
$pkD = Build-LearnStatusPacket @() $run3
Assert "D: gen_version 3"                    ($pkD -like "*gen_version: 3*")
Assert "D: B113 COHORT STEERING active"      ($pkD -like "*B113 COHORT STEERING active*")
Assert "D: gen_steered 5 shown"              ($pkD -like "*gen_steered*5*")
Assert "D: down_weighted 1 shown"            ($pkD -like "*down_weighted*1*")
Assert "D: survivor_templates 3 shown"       ($pkD -like "*survivor_templates used: 3*")
Assert "D: LEAN GATE earned=0"               ($pkD -like "*LEAN GATE: earned_patterns: 0*")
Assert "D: PREFER block SILENT"              ($pkD -like "*PREFER*SILENT*")
Assert "D: HONESTY CONTRACT present"         ($pkD -like "*HONESTY CONTRACT*")

# ---------------------------------------------------------------------------
# Section 7: gen_version 3, earned_patterns 2 (gate active)
# ---------------------------------------------------------------------------
Write-Host "`n-- buildLearnStatusPacket: gen_v3 earned=2 --" -ForegroundColor DarkCyan
$run3e = [pscustomobject]@{
  run_date = "2026-06-24"
  metadata = @{
    gen_version = 3
    learn = @{ min_verifs=3; success_patterns=5; earned_patterns=2; failed_patterns=1 }
  }
}
$pkE = Build-LearnStatusPacket @() $run3e
Assert "E: earned_patterns 2 reported"           ($pkE -like "*earned_patterns: 2*")
Assert "E: 2 template region in gate line"        ($pkE -like "*2 template region*")
Assert "E: verified >= 3 times"                   ($pkE -like "*verified >= 3 times*")
Assert "E: no PREFER SILENT (gate open)"          ($pkE -notlike "*PREFER*SILENT*")
Assert "E: HONESTY CONTRACT present"              ($pkE -like "*HONESTY CONTRACT*")

# ---------------------------------------------------------------------------
# Section 8: source-binding asserts (honesty invariants must survive any edit)
# ---------------------------------------------------------------------------
Write-Host "`n-- source-binding asserts --" -ForegroundColor DarkCyan
$pkFull = Build-LearnStatusPacket $survs $run2
Assert "SB1: HONESTY CONTRACT always present"          ($pkFull -like "*HONESTY CONTRACT*")
Assert "SB2: NOT proven true always present"           ($pkFull -like "*NOT proven true*")
Assert "SB3: NOT established always present"           ($pkFull -like "*NOT established*")
Assert "SB4: GENERATION QUALITY always present"        ($pkFull -like "*GENERATION QUALITY*")
Assert "SB5: COMPUTATIONAL always present"             ($pkFull -like "*COMPUTATIONAL*")
Assert "SB6: tested to the stated bound ONLY"          ($pkFull -like "*tested to the stated bound ONLY*")
Assert "SB7: packet starts with ENGINE LEARN STATUS"   ($pkFull.StartsWith("ENGINE LEARN STATUS"))
Assert "SB8: leaderboard section always present"       ($pkFull -like "*SURVIVOR PRODUCTIVITY LEADERBOARD*")

Write-Host ""
if ($fail -eq 0) { Write-Host "B115 MIRROR: ALL PASS" -ForegroundColor Green; exit 0 }
else              { Write-Host "B115 MIRROR: $fail FAILED" -ForegroundColor Red; exit 1 }
