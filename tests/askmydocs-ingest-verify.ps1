# Ask-My-Docs Ingest -- offline, pure PS 5.1 ASCII.
# Verifies the ingest manifest and report file document the expected
# source rows (IDs 34-36) and concept nodes (IDs 247-261) that were
# inserted into m8_knowledge_sources and m8_graph_nodes on 2026-06-28.
# Node: does NOT require a live Supabase connection or Node.js.

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0

function Assert-True {
  param([string]$label, [bool]$cond)
  if ($cond) { Write-Host ("  PASS  " + $label) -ForegroundColor Green; $script:pass++ }
  else        { Write-Host ("  FAIL  " + $label) -ForegroundColor Red;   $script:fail++ }
}

$manifestPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\INGEST_MANIFEST.md"))
$reportPath   = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\reports\ingest-done.json"))

Write-Host "Ask-My-Docs Ingest verify`n"

# -- 1. Files exist -----------------------------------------------------------
Write-Host "-- 1. output files --"
Assert-True "INGEST_MANIFEST.md exists"       ([IO.File]::Exists($manifestPath))
Assert-True "reports/ingest-done.json exists" ([IO.File]::Exists($reportPath))

$mf = if ([IO.File]::Exists($manifestPath)) { [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) } else { "" }
$rp = if ([IO.File]::Exists($reportPath))   { [IO.File]::ReadAllText($reportPath,   [Text.Encoding]::UTF8) } else { "" }

# -- 2. Manifest: sources -----------------------------------------------------
Write-Host "`n-- 2. manifest: sources --"
Assert-True "source id=34 present (Career Background)"    ($mf -match "id=34")
Assert-True "source id=35 present (Job Hunt)"             ($mf -match "id=35")
Assert-True "source id=36 present (Operating Playbook)"   ($mf -match "id=36")
Assert-True "vault_file CV + LinkedIn.md cited"           ($mf -match "CV \+ LinkedIn\.md")
Assert-True "vault_file Job Hunt.md cited"                ($mf -match "Job Hunt\.md")
Assert-True "vault_file Operating Playbook.md cited"      ($mf -match "Operating Playbook\.md")

# -- 3. Manifest: node IDs ----------------------------------------------------
Write-Host "`n-- 3. manifest: node IDs 247-261 --"
$expectedNodes = 247, 248, 249, 250, 251, 252, 253, 254, 255, 256, 257, 258, 259, 260, 261
foreach ($nid in $expectedNodes) {
  Assert-True ("node id $nid in manifest") ($mf -match "\b$nid\b")
}
Assert-True "total 15 nodes stated" ($mf -match "15 concept nodes")

# -- 4. Manifest: embedding decision ------------------------------------------
Write-Host "`n-- 4. manifest: embedding decision --"
Assert-True "embeddings deferred stated"     ($mf -match -join("DEFERRED|deferred"))
Assert-True "keyword ILIKE fallback stated"  ($mf -match "ILIKE|ilike")
Assert-True "Stream 1 wiring noted"          ($mf -match "Stream 1|stream1|B-158")

# -- 5. Manifest: privacy wall ------------------------------------------------
Write-Host "`n-- 5. manifest: privacy wall --"
Assert-True "Money & Runway.md skipped"      ($mf -match "Money & Runway")
Assert-True "privacy wall section present"   ($mf -match -join("Privacy wall|privacy wall|PRIVACY WALL"))

# -- 6. Report: JSON structure ------------------------------------------------
Write-Host "`n-- 6. report JSON --"
Assert-True "status=done in report"          ($rp -match '"status":\s*"done"')
Assert-True "branch name in report"          ($rp -match "askmydocs-ingest")
Assert-True "3 sources in report"            ($rp -match '"rows":\s*3')
Assert-True "15 nodes in report"             ($rp -match '"nodes":\s*15')
Assert-True "source IDs 34/35/36 in report"  ($rp -match '"source_ids"' -and $rp -match '34' -and $rp -match '35' -and $rp -match '36')
Assert-True "smoke_test section present"     ($rp -match '"smoke_test"')
Assert-True "fleet_supply_courier pass"      ($rp -match '"fleet_supply_courier"' -and $rp -match '"pass":\s*true')

# -- 7. Smoke test results: keywords that MUST hit career nodes ---------------
Write-Host "`n-- 7. keyword coverage check (node label strings) --"
# These are the exact norm_labels we inserted. Verify manifest lists them all.
$expectedLabels = @(
  "career-positioning-statement",
  "careem-supply-manager-egypt-8-years",
  "current-role-alkhair-alwaffer-riyadh",
  "bolt-api-fleet-dashboard-built",
  "full-pnl-across-5-major-platforms",
  "target-role-senior-ops-supply-ksa",
  "warm-intro-strategy-beats-cold-applications",
  "top-target-companies-ksa-2026",
  "supply-side-counterparty-key-advantage",
  "application-pitch-template-ops-supply",
  "bolt-fleet-profit-model-rental-bonus-tiers",
  "daily-morning-driver-triage-routine",
  "driver-management-whatsapp-phone-approach",
  "4-point-app-idea-test-framework",
  "settlement-dashboard-saas-business-idea"
)
foreach ($lbl in $expectedLabels) {
  Assert-True ("label '$lbl' in manifest") ($mf -match [Regex]::Escape($lbl))
}

# -- Summary ------------------------------------------------------------------
Write-Host ""
$total = $pass + $fail
$color = if ($fail -eq 0) { "Green" } else { "Red" }
Write-Host ("Ask-My-Docs Ingest verify: " + $pass + "/" + $total + " passed") -ForegroundColor $color
if ($fail -gt 0) { exit 1 }
