# M8 KSA Legal Playbook — detection + priority + framing port verification (no-node)
# A playbook contributes REASONING, not authority — so the load-bearing checks are
# ROUTING (does a legal query reliably inject the legal playbook?) and FRAMING (did
# the escalation + never-invent guard actually ship?). The legal playbook is placed
# 2nd in the object so the max-2 detector can never drop it when it matches.
# ASCII only (PowerShell 5.1 mangles multibyte in a no-BOM .ps1) — Arabic triggers
# exist in the real regex but aren't exercised here.
#   Run:  powershell -File tests/legal-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}
$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---- ported trigger regexes (English part), in PLAYBOOKS key order ----
$LEGAL = '\b(saudi\s+labou?r|labou?r\s+law|employment\s+law|saudi[sz]ation|nitaqat|\bgosi\b|iqama|work\s+permits?|kafala|sponsorship|qiwa|mudad|wage\s+protection|\bwps\b|end[\s-]?of[\s-]?service|\beosb\b|gratuity|notice\s+period|labou?r\s+court|wrongful\s+termination|commercial\s+registration|\bcr\b|company\s+(formation|registration|setup)|companies\s+law|\bllc\b|\bmisa\b|foreign\s+(invest\w*|owner\w*)|\bzatca\b|commercial\s+law|legal(?:ly)?\s+(requirement|require|obligation|oblig|complian|allowed|liable|binding)|labou?r\s+(?:contract|dispute|rights?)|terminate?\s+(?:an?\s+)?(?:employee|driver|worker|staff))\b'
$ORDER = @(
  @{ name = 'operations'; re = '\b(fleet|drivers?|couriers?|delivery|dispatch|utilisation|utilization|recruit|retention|route|shift|riders?|idle|acceptance|finish rate)\b' },
  @{ name = 'legal';      re = $LEGAL },
  @{ name = 'finance';    re = '\b(profit|profitab\w*|cash ?flow|revenue|costs?|margins?|unit economics|budget|invest\w*|savings?|debt|loans?|pricing|roi|break ?even|p&l|expenses?|zakat)\b' },
  @{ name = 'negotiation';re = '\b(negotiat\w*|deals?|suppliers?|vendors?|contracts?|discount|price down|salary|raise|terms|counter ?offer|bargain\w*)\b' },
  @{ name = 'recruitment';re = '\b(hire|hiring|recruit\w*|candidates?|interview\w*|screening|onboard\w*|talent|applicants?|staffing|job (post|ad))\b' }
)
function LooksLegal($m) { return [regex]::IsMatch($m, $LEGAL, $IC) }
function DetectPlaybooks($m, $max = 2) {
  $hits = @()
  foreach ($p in $ORDER) {
    if ([regex]::IsMatch($m, $p.re, $IC)) { $hits += $p.name; if ($hits.Count -ge $max) { break } }
  }
  return $hits
}
function HasLegal($m) { return (@(DetectPlaybooks $m) -contains 'legal') }

# ---- (1) legal detection ----
Write-Host "== (1) legal detection: labour / commercial / company / Saudization ==" -ForegroundColor Cyan
Check "saudization rules"       (LooksLegal "what are the saudization rules for my fleet?")        $true
Check "nitaqat band"            (LooksLegal "which nitaqat band am I in?")                          $true
Check "labour law"             (LooksLegal "what does saudi labour law say about overtime?")       $true
Check "GOSI"                    (LooksLegal "do I register drivers with GOSI?")                     $true
Check "iqama / work permit"     (LooksLegal "how do work permits and iqama transfer work?")         $true
Check "end of service"          (LooksLegal "how is end of service calculated?")                    $true
Check "commercial registration" (LooksLegal "do I need a commercial registration for this?")        $true
Check "MISA foreign ownership"  (LooksLegal "can I get 100% foreign ownership via MISA?")           $true
Check "company formation / LLC" (LooksLegal "should I set up an LLC company?")                      $true
Check "ZATCA / VAT"             (LooksLegal "what are my zatca obligations?")                       $true
Check "terminate a driver"      (LooksLegal "can I terminate a driver for low acceptance?")         $true
# negatives — generic / non-legal stays off the legal playbook
Check "weather (not legal)"     (LooksLegal "what's the weather in riyadh today?")                  $false
Check "fleet net (not legal)"   (LooksLegal "what was the fleet net yesterday?")                    $false
Check "make a deck (not legal)" (LooksLegal "make me a pitch deck")                                 $false

# ---- (2) priority: legal is NEVER dropped by the max-2 detector when it matches ----
Write-Host "== (2) routing priority: legal always injected when it matches (placed 2nd) ==" -ForegroundColor Cyan
Check "saudization + fleet -> legal kept" (HasLegal "saudization rules for my driver fleet")        $true
Check "EOSB + terminate driver -> legal kept" (HasLegal "how is end of service handled if I terminate a driver?") $true
Check "MISA + company setup -> legal kept" (HasLegal "do I need MISA to set up an LLC company?")     $true
Check "3-domain (fleet+legal+zakat) keeps legal" (HasLegal "saudization and zakat for my fleet")     $true
Check "legal alone -> legal kept"          (HasLegal "what are the nitaqat thresholds?")             $true
# and the co-injection: a fleet+legal query injects BOTH ops and legal
$both = @(DetectPlaybooks "saudization rules for my driver fleet")
Check "fleet+legal injects operations too" ($both -contains 'operations') $true
Check "fleet+legal injects exactly 2"      ($both.Count) 2

# ---- (3) framing shipped: the load-bearing escalation + never-invent guard ----
Write-Host "== (3) load-bearing framing present in lib/playbooks.js ==" -ForegroundColor Cyan
$src = Get-Content -Raw "$PSScriptRoot/../lib/playbooks.js"
function SrcHas($name, $needle) { if ($src.Contains($needle)) { $script:pass++ } else { $script:fail++; Write-Host "  FAIL: $name (source missing '$needle')" -ForegroundColor Red } }
SrcHas "NOT legal advice framing" "NOT legal advice"
SrcHas "ESCALATE rule"            "ESCALATE (do not play lawyer)"
SrcHas "never-invent guard"       "NEVER INVENT: article numbers"
SrcHas "framework-vs-figures"     "FRAMEWORK vs CURRENT FIGURES"
SrcHas "points to Qiwa"           "Qiwa"
SrcHas "points to MISA"           "MISA"
SrcHas "points to ZATCA"          "ZATCA"

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
