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

# ================= summary =================
Write-Host "`n=================================================="
Write-Host ("  M2 novelty-gate offline verification: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
