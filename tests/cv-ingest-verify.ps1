# CV Ingest verify -- offline, pure PS 5.1.
# Asserts the CV PDF (Mohamed_ElHofy_CV_Updated.pdf) was ingested as
# m8_knowledge_sources id=37 with 18 concept nodes (IDs 262-279).
# Does NOT require a live Supabase connection or Node.js.

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$manifestPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\INGEST_MANIFEST.md"))
$reportPath   = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\reports\cv-ingest-done.json"))

Write-Host "CV Ingest verify`n"

# -- 1. Files exist -----------------------------------------------------------
Write-Host "-- 1. output files --"
Assert-True "INGEST_MANIFEST.md exists"          ([IO.File]::Exists($manifestPath))
Assert-True "reports/cv-ingest-done.json exists" ([IO.File]::Exists($reportPath))

$mf = if ([IO.File]::Exists($manifestPath)) { [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) } else { "" }
$rp = if ([IO.File]::Exists($reportPath))   { [IO.File]::ReadAllText($reportPath,   [Text.Encoding]::UTF8) } else { "" }

# -- 2. Manifest: source id=37 ------------------------------------------------
Write-Host "`n-- 2. manifest: source id=37 --"
Assert-True "source id=37 present"               ($mf -match "id=37")
Assert-True "CV PDF filename cited"              ($mf -match "Mohamed_ElHofy_CV_Updated\.pdf")
Assert-True "4 sources total stated"             ($mf -match "4 sources")
Assert-True "33 nodes total stated"              ($mf -match "33 concept nodes")

# -- 3. Manifest: all 18 CV node IDs -----------------------------------------
Write-Host "`n-- 3. manifest: node IDs 262-279 --"
262..279 | ForEach-Object {
  Assert-True ("node id $_ in manifest") ($mf -match "\b$_\b")
}

# -- 4. Manifest: node labels from CV -----------------------------------------
Write-Host "`n-- 4. manifest: CV node labels --"
$cvLabels = @(
  "cv-ten-plus-years-ops-supply-fleet",
  "alkhair-alwafeer-current-role-oct2025",
  "five-platform-portfolio-100-plus-fleet",
  "careem-egypt-supply-manager-2022-2025",
  "acquisition-channel-zero-to-15pct-market",
  "indirect-to-direct-100pct-acquisition-shift",
  "cpad-best-in-class-digital-acquisition-channel",
  "rumi-migration-egypt-fleet-to-uber",
  "careem-multi-product-launch-bid-ask-wasally",
  "careem-senior-supply-lead-alexandria-2019-2021",
  "careem-supply-lead-alexandria-2018-2019",
  "vodafone-egypt-call-center-manager-2017",
  "vodafone-top-achiever-q4-2016",
  "clothes-factory-50pct-revenue-uplift",
  "nine-core-competencies-ops-supply",
  "education-bcom-english-alexandria-university",
  "languages-arabic-native-english-professional",
  "full-career-timeline-2012-present"
)
foreach ($lbl in $cvLabels) {
  Assert-True ("label '$lbl' in manifest") ($mf -match [Regex]::Escape($lbl))
}

# -- 5. Manifest: privacy wall covers CV PII ----------------------------------
Write-Host "`n-- 5. manifest: privacy wall --"
Assert-True "phone number exclusion documented"  ($mf -match "phone number|Phone number")
Assert-True "email exclusion documented"         ($mf -match "email address|Email address")
Assert-True "CV resolved section present"        ($mf -match "RESOLVED")
Assert-True "no phone digits in manifest"        (-not ($mf -match "\+966 560"))
Assert-True "no email value in manifest"         (-not ($mf -match "mohd\.hofy@gmail\.com"))

# -- 6. Manifest: smoke test results ------------------------------------------
Write-Host "`n-- 6. manifest: smoke test results --"
Assert-True "Careem smoke test 9 nodes stated"   ($mf -match "9 nodes")
Assert-True "18/18 total nodes stated"           ($mf -match "18/18")

# -- 7. Report: JSON structure ------------------------------------------------
Write-Host "`n-- 7. report JSON --"
Assert-True "status done in report"              ($rp -match '"status":\s*"done"')
Assert-True "source_id 37 in report"             ($rp -match '"source_id":\s*37')
Assert-True "18 node_ids in report"              ($rp -match '"node_ids"')
Assert-True "smoke_test section present"         ($rp -match '"smoke_test"')
Assert-True "careem_hits pass in report"         ($rp -match '"careem_hits"' -and $rp -match '"pass":\s*true')
Assert-True "skipped section present"            ($rp -match '"skipped"')
Assert-True "branch name in report"              ($rp -match "cv-ingest")

# -- Summary ------------------------------------------------------------------
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("CV Ingest verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
