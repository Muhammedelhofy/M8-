# M8 Company Registry (multi-company) — detection + routing + framing port (no-node)
# Load-bearing checks: ROUTING (does a non-Bolt company / cross-company query inject
# the right context?) and HONESTY FRAMING (unprofiled companies are never invented;
# the roster says don't-conflate). Bolt is NOT solo-injected (the fleet/finance spine
# owns it) and appears only in the cross-company roster.
# ASCII only (PowerShell 5.1 mangles multibyte in a no-BOM .ps1).
#   Run:  powershell -File tests/companies-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}
$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---- ported regexes ----
$MULTI = '\b(my\s+companies|all\s+(?:my\s+)?(?:companies|businesses|ventures)|across\s+(?:my\s+)?(?:companies|businesses|ventures)|which\s+(?:of\s+my\s+)?(?:compan|business)|other\s+(?:compan|business)|each\s+(?:of\s+my\s+)?(?:compan|business)|company\s+(?:breakdown|comparison|roster)|between\s+my\s+(?:compan|business))\b'
# COMPANIES order: bolt (no soloAlias), thrivve, noon
$ALIASES = @(
  @{ id = 'thrivve'; re = '\bthrivve(?:\.sa)?\b' },
  @{ id = 'noon';    re = '\b(?:my\s+noon|noon\s+(?:company|venture|business))\b' }
)
function IsMulti($m)      { return [regex]::IsMatch($m, $MULTI, $IC) }
function DetectCompany($m) {
  foreach ($a in $ALIASES) { if ([regex]::IsMatch($m, $a.re, $IC)) { return $a.id } }
  return ''
}
# buildCompanyContext mode ladder: multi -> roster; else named -> company_unprofiled; else none
function CompanyMode($m) {
  if (IsMulti $m) { return 'roster' }
  $c = DetectCompany $m
  if ($c -ne '') { return 'company_unprofiled' }   # thrivve/noon are both unprofiled in the seed
  return ''
}

# ---- (1) non-Bolt company detection ----
Write-Host "== (1) company detection (non-primary, named as subject) ==" -ForegroundColor Cyan
Check "how's Thrivve doing -> thrivve"        (DetectCompany "how's Thrivve doing?")               "thrivve"
Check "thrivve.sa revenue -> thrivve"          (DetectCompany "what's thrivve.sa revenue?")         "thrivve"
Check "my noon company -> noon"                (DetectCompany "how's my noon company doing?")       "noon"
Check "noon venture -> noon"                   (DetectCompany "update on the noon venture")         "noon"
# bare 'noon' is the PLATFORM, not his company -> no solo company injection
Check "noon orders (platform) -> none"         (DetectCompany "how many noon orders did drivers do today?") ""
Check "fleet net (bolt, spine owns it) -> none"(DetectCompany "what was the fleet net yesterday?")  ""
Check "weather -> none"                         (DetectCompany "what's the weather in riyadh?")      ""

# ---- (2) cross-company / roster detection ----
Write-Host "== (2) multi-company / roster routing ==" -ForegroundColor Cyan
Check "across my companies -> multi"   (IsMulti "across my companies how am I doing?")  $true
Check "all my businesses -> multi"     (IsMulti "give me all my businesses at a glance") $true
Check "which of my companies -> multi" (IsMulti "which of my companies is most profitable?") $true
Check "company breakdown -> multi"     (IsMulti "show me a company breakdown")           $true
Check "fleet net -> not multi"         (IsMulti "what was the fleet net yesterday?")     $false

# ---- (3) buildCompanyContext mode ladder ----
Write-Host "== (3) context mode: roster / company_unprofiled / none ==" -ForegroundColor Cyan
Check "multi -> roster"                 (CompanyMode "across my companies, how am I doing?") "roster"
Check "thrivve -> company_unprofiled"   (CompanyMode "how's Thrivve doing?")                "company_unprofiled"
Check "my noon company -> company_unprofiled" (CompanyMode "how's my noon company?")        "company_unprofiled"
Check "fleet question -> none"          (CompanyMode "what's the fleet net yesterday?")     ""
Check "bare noon (platform) -> none"    (CompanyMode "how many noon orders today?")         ""
Check "weather -> none"                 (CompanyMode "what's the weather?")                 ""

# ---- (4) honesty framing shipped in lib/companies.js ----
Write-Host "== (4) load-bearing honesty framing present ==" -ForegroundColor Cyan
$src = Get-Content -Raw "$PSScriptRoot/../lib/companies.js"
function SrcHas($name, $needle) { if ($src.Contains($needle)) { $script:pass++ } else { $script:fail++; Write-Host "  FAIL: $name (source missing '$needle')" -ForegroundColor Red } }
SrcHas "never-invent unprofiled" "Do NOT invent what"
SrcHas "ask Boss to fill in"     "ASK him to fill you in"
SrcHas "roster don't-conflate"   "Do NOT conflate them"
SrcHas "noon platform disambig"  "disambiguate"
SrcHas "separate public vs internal" "separate that from his INTERNAL specifics"

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
