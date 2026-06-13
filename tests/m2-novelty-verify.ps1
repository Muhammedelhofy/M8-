# m2-novelty-verify.ps1 -- Build-15 (M2 seed pack + novelty gate v1) offline verification.
# THE M2 GATE (NORTH_STAR): 10/10 on planted known/unknown probes against the
# DETERMINISTIC novelty comparator (canonical-form/template+slot pass -- the
# embedding pass is adjacency-only and live-tested separately).
# Three parts (no local node -- JS is verified live after deploy):
#   A) PACK SCHEMA: data/seed-packs/collatz-v1.json against the adopted round-3
#      schema (two-axis result_type x scope, proof_strength, negative_result,
#      citation, related_features, curation verification record).
#   B) COMPARATOR MIRROR: PowerShell port of lib/seed-pack.js seedKnownMatch
#      ("TEMPLATE" covers the family, "TEMPLATE:slot=val" pins a slot).
#   C) THE 10 PLANTED PROBES: 5 known (must match the right seed), 5 unknown
#      (must NOT match) -- 10/10 required.
# Pure ASCII (PS 5.1 reads no-BOM UTF-8 as ANSI).

$pass = 0; $fail = 0
function Check([string]$name, $actual, $expected) {
  if ("$actual" -eq "$expected") { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name (got $actual, want $expected)" -ForegroundColor Red }
}
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}

$packPath = Join-Path $PSScriptRoot "..\data\seed-packs\collatz-v1.json"
$pack = Get-Content $packPath -Raw -Encoding UTF8 | ConvertFrom-Json
# PS 5.1 gotcha: assign-then-wrap to normalise the array
$seeds = @($pack.seeds)

# ================= A) pack schema =================
Write-Host "`n== A) seed pack schema (adopted round-3 Q1) ==" -ForegroundColor Cyan
CheckTrue "pack size 15-20 (got $($seeds.Count))" ($seeds.Count -ge 15 -and $seeds.Count -le 20)
$ids = @($seeds | ForEach-Object { $_.id })
Check "no duplicate ids" (@($ids | Group-Object | Where-Object { $_.Count -gt 1 }).Count) 0
$RESULT_TYPES = @("theorem","conjecture","computational_result","counterexample","survey_claim")
$SCOPES = @("finite","asymptotic","density","structural")
$badRT = @($seeds | Where-Object { $RESULT_TYPES -notcontains $_.result_type })
Check "all result_type valid" $badRT.Count 0
$badSc = @($seeds | Where-Object { $SCOPES -notcontains $_.scope })
Check "all scope valid" $badSc.Count 0
$noVer = @($seeds | Where-Object { -not $_.verification -or -not $_.verification.method -or -not $_.verification.date })
Check "every seed has a curation verification record (KG-integrity step)" $noVer.Count 0
$thin = @($seeds | Where-Object { $_.statement.Length -lt 40 })
Check "no thin statements (atomic results)" $thin.Count 0
$noCite = @($seeds | Where-Object { -not $_.source_citation })
Check "every seed cited" $noCite.Count 0
$negs = @($seeds | Where-Object { $_.negative_result -eq $true })
CheckTrue "pack contains negative results (unanimous round-3: needed to kill contradicting conjectures) (got $($negs.Count))" ($negs.Count -ge 3)
$tested = @($seeds | Where-Object { $_.tested_bound -eq "2^71" })
CheckTrue "computational frontier 2^71 seeded (Barina)" ($tested.Count -ge 1)

# ================= B) comparator mirror =================
Write-Host "`n== B) seedKnownMatch mirror ==" -ForegroundColor Cyan
function SeedMatch([string]$template, $slots) {
  foreach ($s in $seeds) {
    foreach ($pat in @($s.matches_templates)) {
      if (-not $pat) { continue }
      $parts = "$pat" -split ":"
      if ($parts[0] -ne $template) { continue }
      if ($parts.Count -gt 1) {
        $kv = $parts[1] -split "="
        $slotName = $kv[0]; $slotVal = $kv[1]
        $actual = $null
        if ($slots -and $slots.ContainsKey($slotName)) { $actual = "$($slots[$slotName])" }
        if ($actual -ne $slotVal) { continue }
      }
      return $s.id
    }
  }
  return $null
}
# family-pattern semantics: any slot value matches a bare "TEMPLATE" pattern
Check "B_nu_geo k=2 matches nu2-geometric-law" (SeedMatch "B_nu_geo" @{ k = 2 }) "nu2-geometric-law"
Check "first-hit-wins is pack order (B_sigma_freq -> Terras seed)" (SeedMatch "B_sigma_freq" @{ t = 3 }) "terras-1976-stopping-density"

# ================= C) the 10 planted known/unknown probes (THE M2 GATE) =================
Write-Host "`n== C) 10/10 planted known/unknown probes ==" -ForegroundColor Cyan
# KNOWN plants -- statistical baselines the literature/elementary results cover.
# These are exactly the shapes Gemini warned the generator would keep re-deriving.
Check "known 1: nu2 geometric k=2"  ([bool](SeedMatch "B_nu_geo" @{ k = 2 }))  True
Check "known 2: nu2 geometric k=5"  ([bool](SeedMatch "B_nu_geo" @{ k = 5 }))  True
Check "known 3: nu2 geometric k=7"  ([bool](SeedMatch "B_nu_geo" @{ k = 7 }))  True
Check "known 4: sigma frequency t=3"  ([bool](SeedMatch "B_sigma_freq" @{ t = 3 }))  True
Check "known 5: sigma frequency t=20" ([bool](SeedMatch "B_sigma_freq" @{ t = 20 })) True
# UNKNOWN plants -- machine-shaped finite-bound claims no atomic literature
# result covers (residue-class sigma_inf maxima, log bounds, peak powers,
# cross-feature conditionals, class-mean gaps).
Check "unknown 1: A_res_total_max class bound"   (SeedMatch "A_res_total_max" @{ m = 7; r = 3 })  ""
Check "unknown 2: A_total_log bound"             (SeedMatch "A_total_log" @{ a = 8 })             ""
Check "unknown 3: A_peak_power bound"            (SeedMatch "A_peak_power" @{ e = 2 })            ""
Check "unknown 4: A_cond_nu_peak conditional"    (SeedMatch "A_cond_nu_peak" @{ k = 3 })          ""
Check "unknown 5: B_res_total_gap class means"   (SeedMatch "B_res_total_gap" @{ m = 9; r1 = 1; r2 = 2 }) ""

# ================= D) node mapping spot checks =================
Write-Host "`n== D) seedToNode kind mapping ==" -ForegroundColor Cyan
function KindFor($s) {
  if ($s.node_kind) { return $s.node_kind }
  switch ($s.result_type) {
    "theorem" { return "theorem" }
    "conjecture" { return "conjecture" }
    "computational_result" { return "evidence" }
    "counterexample" { return "counterexample" }
    "survey_claim" { return "evidence" }
  }
  return "evidence"
}
$terras = $seeds | Where-Object { $_.id -eq "terras-1976-stopping-density" }
Check "literature theorem -> theorem node (source external distinguishes it)" (KindFor $terras) "theorem"
$barina = $seeds | Where-Object { $_.id -eq "barina-2k71-verification" }
Check "computational_result -> evidence node" (KindFor $barina) "evidence"
$cc = $seeds | Where-Object { $_.id -eq "collatz-conjecture" }
Check "open conjecture -> conjecture node" (KindFor $cc) "conjecture"
$oeis = $seeds | Where-Object { $_.id -eq "oeis-a006577" }
Check "OEIS seed -> sequence node (node_kind override)" (KindFor $oeis) "sequence"
$herch = $seeds | Where-Object { $_.id -eq "hercher-2022-no-m-cycles" }
Check "negative result flagged (Hercher)" $herch.negative_result True

# ================= E) M3-FULL SHIP GATE: confusion matrix over expressible forms =
# Build-16 (M3-full). The kickoff's "zero false positives on a held-out split of
# the literature seeds" is VACUOUS for 16/19 seeds: no generator template expresses
# the Tao/Korec/Eliahou/Hercher/OEIS/cycle-bound shapes, so they can never be
# flagged either way -- holding them out tests nothing. The HONEST ship gate
# (decided 2026-06-13): a clean confusion matrix over EVERY (template, slot) the
# generator can actually emit, both error directions driven to zero:
#   FN (MISSED KNOWN) -- a known-form candidate the comparator FAILS to flag; it
#        would then be narrated as / left implying novel. THE honesty risk.
#   FP (FAKE MATCH)   -- an unmatched candidate the comparator labels "matches
#        <seed>"; a fabricated citation. The credibility risk (kickoff omitted it).
# The slot domains MIRROR lib/conjecture-gen.js, so this proves the family-pattern
# coverage generalises across the generator's WHOLE output range -- not just the 10
# hand-picked probes -- and a HELD-OUT batch (slot values NOT used in part C) must
# be clean too. NOTE the real generator/known overlap is ~1 live template
# (B_sigma_freq; B_nu_geo is pre-killed by the micro-prover before survival) -- this
# gate is honest about being narrow, not theatrically broad.
Write-Host "`n== E) M3-full ship gate: confusion matrix over expressible forms ==" -ForegroundColor Cyan

# generator slot domains (mirror lib/conjecture-gen.js)
$MODS     = @(3,5,6,7,8,9,10,11,12,15,16,18)
$NU_KS    = @(2,3,4,5,6,7)
$SIGMA_TS = @(3,5,8,12,16,20,30)
$PEAK_ES  = @(1.5,2,2.5,3,3.5,4)
$LOG_AS   = @(4,6,8,10,12,14,16,20)
$PEAK_RT  = @(2,5,10,20)
# calibration slots = values already planted in part C; everything else is HELD-OUT
$calSigmaT = @(3,20); $calNuK = @(2,5,7)

$corpus = New-Object System.Collections.Generic.List[object]
function AddCand($tpl, $slots, $expected, $heldOut) {
  $corpus.Add(@{ tpl = $tpl; slots = $slots; expected = $expected; heldOut = $heldOut }) | Out-Null
}
# KNOWN forms (must match): B_sigma_freq -> Terras (first hit in pack order),
# B_nu_geo -> the elementary 2-adic geometric law. Iterate the FULL slot domain.
foreach ($tt in $SIGMA_TS) { AddCand "B_sigma_freq" @{ t = $tt } "terras-1976-stopping-density" (-not ($calSigmaT -contains $tt)) }
foreach ($kk in $NU_KS)    { AddCand "B_nu_geo"      @{ k = $kk } "nu2-geometric-law"           (-not ($calNuK   -contains $kk)) }
# UNMATCHED forms (must return null): every other template across its slot domain.
foreach ($mm in $MODS) {
  AddCand "A_res_sigma_max" @{ m = $mm; r = 1 } "" $true
  AddCand "A_res_total_max" @{ m = $mm; r = 3 } "" (-not ($mm -eq 7))
  AddCand "B_res_total_gap" @{ m = $mm; r1 = 1; r2 = 2 } "" (-not ($mm -eq 9))
}
foreach ($kk in $NU_KS)   { AddCand "A_nu_total_max" @{ k = $kk } "" $true
                            AddCand "A_cond_nu_peak"  @{ k = $kk } "" (-not ($kk -eq 3)) }
foreach ($aa in $LOG_AS)  { AddCand "A_total_log"     @{ a = $aa } "" (-not ($aa -eq 8)) }
foreach ($ee in $PEAK_ES) { AddCand "A_peak_power"    @{ e = $ee } "" (-not ($ee -eq 2)) }
foreach ($pt in $PEAK_RT) { AddCand "B_cond_peak_nu"  @{ t = $pt } "" $true }

$TP = 0; $FN = 0; $FP = 0; $TN = 0; $hoFN = 0; $hoFP = 0; $hoTotal = 0
foreach ($cand in $corpus) {
  $actual = SeedMatch $cand.tpl $cand.slots
  if (-not $actual) { $actual = "" }
  $isKnown = ($cand.expected -ne "")
  if ($cand.heldOut) { $hoTotal++ }
  if ($isKnown) {
    if ($actual -eq $cand.expected) { $TP++ }
    else { $FN++; if ($cand.heldOut) { $hoFN++ }; Write-Host "    MISSED KNOWN: $($cand.tpl) expected $($cand.expected) got '$actual'" -ForegroundColor Red }
  } else {
    if ($actual -eq "") { $TN++ }
    else { $FP++; if ($cand.heldOut) { $hoFP++ }; Write-Host "    FAKE MATCH: $($cand.tpl) matched '$actual' (should be none)" -ForegroundColor Red }
  }
}
Write-Host ("  corpus: {0} candidates ({1} known-form, {2} unmatched) -- confusion TP={3} FN={4} FP={5} TN={6}" -f $corpus.Count, ($TP + $FN), ($FP + $TN), $TP, $FN, $FP, $TN)
Write-Host ("  held-out batch: {0} candidates -- FN={1} FP={2}" -f $hoTotal, $hoFN, $hoFP)
Check "ship gate: zero MISSED KNOWNS (no known form would be narrated novel)" $FN 0
Check "ship gate: zero FAKE MATCHES (no fabricated citation)" $FP 0
Check "ship gate: held-out batch zero missed knowns" $hoFN 0
Check "ship gate: held-out batch zero fake matches" $hoFP 0
CheckTrue "ship gate: corpus exercises both directions (>=10 known, >=20 unmatched)" ((($TP + $FN) -ge 10) -and (($FP + $TN) -ge 20))

# ================= F) M3-FULL novelty-aware persistence: down-rank mirror =========
# Mirrors the PARTITION invariant rankSurvivors gains in lib/conjecture-gen.js
# (Build-16): known-form survivors are pushed BELOW every unmatched survivor, so
# when the persistence cap (M3_MAX_SURVIVORS) bites the notebook keeps candidates
# with NO pack match. The within-group order (template round-robin + margin) is
# unchanged from gen v2 and not re-tested here -- this locks the NEW behavior only.
Write-Host "`n== F) M3-full down-rank partition mirror ==" -ForegroundColor Cyan
function RankSurvivors($survivors) {
  $unmatched = @($survivors | Where-Object { -not $_.known })
  $known     = @($survivors | Where-Object { $_.known })
  return @($unmatched) + @($known)
}
# a known-form survivor with the TIGHTEST margin must still be down-ranked
$mix = @(
  @{ id = "km1"; known = $true;  margin = 1 },
  @{ id = "u1";  known = $false; margin = 5 },
  @{ id = "u2";  known = $false; margin = 9 },
  @{ id = "km2"; known = $true;  margin = 2 }
)
$ranked = @(RankSurvivors $mix)
$topTwo = @($ranked[0..1] | ForEach-Object { $_.id })
$knownInTop = @($topTwo | Where-Object { $_ -like "km*" })
Check "down-rank: top-2 slots are UNMATCHED even when a known-form has tighter margin" $knownInTop.Count 0
# persistence cap: 5 unmatched + 2 known, cap 5 -> 0 known persists
$big = New-Object System.Collections.Generic.List[object]
for ($g = 1; $g -le 5; $g++) { $big.Add(@{ id = "u$g"; known = $false; margin = $g }) | Out-Null }
$big.Add(@{ id = "kmA"; known = $true; margin = 0 }) | Out-Null
$big.Add(@{ id = "kmB"; known = $true; margin = 0 }) | Out-Null
$top = @(RankSurvivors $big.ToArray())
$topCap = @($top[0..4] | ForEach-Object { $_.id })
$knownPersisted = @($topCap | Where-Object { $_ -like "km*" })
Check "persistence cap: 5 unmatched fill cap=5, 0 known-form persisted" $knownPersisted.Count 0
# down-rank REORDERS, never DROPS: an all-known set still persists
$allk = @( @{ id = "kmX"; known = $true; margin = 1 }, @{ id = "kmY"; known = $true; margin = 2 } )
Check "down-rank keeps known-form when nothing is unmatched (orders, never drops)" (@(RankSurvivors $allk)).Count 2

# ================= summary =================
Write-Host "`n=================================================="
Write-Host ("  M2 novelty-gate offline verification: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
