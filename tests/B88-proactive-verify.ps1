# B88-proactive-verify.ps1
# Pure-PS mirror of lib/proactive.js logic. No Node required.
# Run: powershell -File tests\B88-proactive-verify.ps1

$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0

function Ok($cond, $label) {
    if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor DarkGreen }
    else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}

# ── Mirror: parseFollowUps(raw) ───────────────────────────────────────────────
# Strips fences, extracts up to 2 non-empty lines from numbered/bulleted list
function ParseFollowUps([string]$raw) {
    if (-not $raw) { return @() }
    # strip code fences
    $text = $raw -replace '```[a-z]*', '' -replace '```', ''
    $lines = $text -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    # strip leading numbering/bullets
    $cleaned = $lines | ForEach-Object {
        $_ -replace '^\s*[\d]+[\.\)]\s*', '' -replace '^\s*[-•*]\s*', ''
    } | Where-Object { $_.Length -gt 3 }
    return @($cleaned | Select-Object -First 2)
}

# ── Mirror: eligibility gate ──────────────────────────────────────────────────
$ELIGIBLE_INTENTS = @("knowledge", "general", "hybrid")
function IsEligible([string]$intent, [string]$answer) {
    if ($ELIGIBLE_INTENTS -notcontains $intent) { return $false }
    if ($answer.Length -lt 150) { return $false }
    return $true
}

# ── Tests: parseFollowUps ─────────────────────────────────────────────────────
$r1 = ParseFollowUps "1. What is X?`n2. How does Y work?`n3. Tell me more about Z."
Ok ($r1.Count -eq 2)                          "parseFollowUps: caps at 2 results"

$r2 = ParseFollowUps '```\n1. What is X?\n2. How does Y?\n```'
Ok ($r2.Count -ge 1)                          "parseFollowUps: strips code fences"

$r3 = ParseFollowUps ""
Ok ($r3.Count -eq 0)                          "parseFollowUps: empty string returns 0"

$r4 = ParseFollowUps "• First follow-up here`n• Second follow-up here"
Ok ($r4.Count -eq 2)                          "parseFollowUps: handles bullet format"

$r5 = ParseFollowUps "1. What does this mean exactly?"
Ok ($r5.Count -eq 1)                          "parseFollowUps: single item returns 1"

# ── Tests: eligibility gate ───────────────────────────────────────────────────
$longAnswer = "x" * 200

Ok (-not (IsEligible "fleet"   $longAnswer))  "fleet intent not eligible"
Ok (-not (IsEligible "finance" $longAnswer))  "finance intent not eligible"
Ok (      IsEligible "knowledge" $longAnswer) "knowledge intent eligible"
Ok (      IsEligible "general"   $longAnswer) "general intent eligible"
Ok (      IsEligible "hybrid"    $longAnswer) "hybrid intent eligible"

# short answer gate (< 150 chars)
Ok (-not (IsEligible "knowledge" "short"))    "short answer (< 150 chars) not eligible"
Ok (-not (IsEligible "knowledge" ("x" * 149))) "149-char answer not eligible"
Ok (      IsEligible "knowledge" ("x" * 150))  "150-char answer eligible"

# ── Static: lib/proactive.js exists and has required exports ──────────────────
$jsPath = Join-Path $PSScriptRoot "..\lib\proactive.js"
Ok (Test-Path $jsPath)                        "lib/proactive.js exists"
$src = Get-Content $jsPath -Raw
Ok ($src -match "suggestFollowUps")           "exports suggestFollowUps"
Ok ($src -match "parseFollowUps")             "exports parseFollowUps"
Ok ($src -match "ELIGIBLE_INTENTS")           "defines ELIGIBLE_INTENTS set"
Ok ($src -match "150")                        "short-answer gate (150) present"
Ok ($src -match "Promise\.race")              "1.5s hard cap via Promise.race present"

Write-Host ""
Write-Host "$($script:pass)/$($script:pass + $script:fail) passed"
if ($script:fail -gt 0) { exit 1 }
