# ============================================================================
# Build-90: Entity slug canonicalization -- offline verifier (PS 5.1, no Node).
#   powershell -File tests/B90-entity-slug-verify.ps1
#
# Node is not on the box, so part 1 is a PowerShell MIRROR of the PURE logic in
# lib/entity-slug.js (toSlug / slugsMatch) kept in lockstep with the JS, run over
# the spec's required match / non-match cases. Arabic inputs are built from [int]
# code points so this file stays pure ASCII (PS 5.1 reads a no-BOM file as ANSI).
#
# Part 2 is static wiring: the lib exports the right surface, its Arabic->Latin
# map carries the correct code points (read as UTF-8 -- catches re-encoding), and
# entity-graph.js + the migration are wired up.
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- PURE-LOGIC MIRROR of lib/entity-slug.js -------------------------------
# Arabic -> Latin map, keyed by integer code point (avoids PS hashtable
# case-insensitive string-key folding). Mirrors AR2LAT in the JS exactly.
$AR2LAT = @{}
$AR2LAT[0x0623] = 'a'; $AR2LAT[0x0625] = 'a'; $AR2LAT[0x0627] = 'a'; $AR2LAT[0x0622] = 'a'
$AR2LAT[0x0671] = 'a'; $AR2LAT[0x0621] = '';  $AR2LAT[0x0626] = 'y'; $AR2LAT[0x0624] = 'w'
$AR2LAT[0x0628] = 'b'; $AR2LAT[0x062A] = 't'; $AR2LAT[0x062B] = 'th'; $AR2LAT[0x062C] = 'j'
$AR2LAT[0x062D] = 'h'; $AR2LAT[0x062E] = 'kh'; $AR2LAT[0x062F] = 'd'; $AR2LAT[0x0630] = 'dh'
$AR2LAT[0x0631] = 'r'; $AR2LAT[0x0632] = 'z'; $AR2LAT[0x0633] = 's'; $AR2LAT[0x0634] = 'sh'
$AR2LAT[0x0635] = 's'; $AR2LAT[0x0636] = 'd'; $AR2LAT[0x0637] = 't'; $AR2LAT[0x0638] = 'z'
$AR2LAT[0x0639] = 'a'; $AR2LAT[0x063A] = 'gh'; $AR2LAT[0x0641] = 'f'; $AR2LAT[0x0642] = 'q'
$AR2LAT[0x0643] = 'k'; $AR2LAT[0x0644] = 'l'; $AR2LAT[0x0645] = 'm'; $AR2LAT[0x0646] = 'n'
$AR2LAT[0x0647] = 'h'; $AR2LAT[0x0648] = 'w'; $AR2LAT[0x064A] = 'y'; $AR2LAT[0x0649] = 'a'
$AR2LAT[0x0629] = 'a'

$TASHKEEL = '[' + [char]0x0610 + '-' + [char]0x061A + [char]0x064B + '-' + [char]0x065F + ']'

function Get-Slug([string]$name) {
  if ($null -eq $name) { return "" }
  $orig = [string]$name
  $s = $orig.ToLowerInvariant()
  $s = [regex]::Replace($s, $TASHKEEL, '')   # strip tashkeel

  # strip leading Arabic article alef(0627)+lam(0644)
  if ($s.Length -gt 2 -and ([int]$s[0]) -eq 0x0627 -and ([int]$s[1]) -eq 0x0644) {
    $s = $s.Substring(2)
  }

  # Arabic -> Latin
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    $cp = [int]$ch
    if ($AR2LAT.ContainsKey($cp)) { [void]$sb.Append([string]$AR2LAT[$cp]) }
    else { [void]$sb.Append($ch) }
  }
  $s = $sb.ToString()

  # fold romanization digraphs (order matches JS DIGRAPHS)
  $s = $s.Replace('dh','d').Replace('th','t').Replace('kh','k').Replace('sh','s').Replace('gh','g')

  $s = [regex]::Replace($s, '[aeiou]', '')        # consonant skeleton
  $s = [regex]::Replace($s, '(.)\1+', '$1')       # collapse doubled letters
  $s = [regex]::Replace($s, '[^a-z0-9\s-]', '')
  $s = $s.Trim()
  $s = [regex]::Replace($s, '[\s-]+', '-')
  $s = [regex]::Replace($s, '^-+|-+$', '')
  if ($s.Length -gt 80) { $s = $s.Substring(0, 80) }

  if ([string]::IsNullOrEmpty($s)) {
    $s = $orig.ToLowerInvariant()
    $s = [regex]::Replace($s, '[^a-z0-9]+', '-')
    $s = [regex]::Replace($s, '^-+|-+$', '')
    if ($s.Length -gt 80) { $s = $s.Substring(0, 80) }
  }
  return $s
}

function Slugs-Match([string]$a, [string]$b) {
  $sa = Get-Slug $a
  return ($sa.Length -gt 0 -and $sa -ceq (Get-Slug $b))
}

function CharStr([int[]]$points) { return (-join ($points | ForEach-Object { [char]$_ })) }

# Arabic test strings (built from code points -> file stays ASCII)
$ar_ahmad    = CharStr @(0x0623,0x062D,0x0645,0x062F)                                   # AHMAD
$ar_mohammed = CharStr @(0x0645,0x062D,0x0645,0x062F)                                   # MHMD
$ar_abdullah = CharStr @(0x0639,0x0628,0x062F,0x0627,0x0644,0x0644,0x0647)             # ABDULLAH
$ar_riyadh   = CharStr @(0x0627,0x0644,0x0631,0x064A,0x0627,0x0636)                     # AL-RIYADH

Write-Host "`n-- slug match cases (MUST MATCH) --" -ForegroundColor Cyan
Ok (Slugs-Match "Ahmad"    $ar_ahmad)    ("Ahmad == Arabic Ahmad   [" + (Get-Slug "Ahmad")    + " == " + (Get-Slug $ar_ahmad)    + "]")
Ok (Slugs-Match "Mohammed" $ar_mohammed) ("Mohammed == Arabic Mhmd [" + (Get-Slug "Mohammed") + " == " + (Get-Slug $ar_mohammed) + "]")
Ok (Slugs-Match $ar_mohammed "Muhammad") ("Arabic Mhmd == Muhammad [" + (Get-Slug $ar_mohammed) + " == " + (Get-Slug "Muhammad") + "]")
Ok (Slugs-Match "Mohammed" "Muhammad")   ("Mohammed == Muhammad    [" + (Get-Slug "Mohammed") + " == " + (Get-Slug "Muhammad") + "]")
Ok (Slugs-Match "Abdullah" $ar_abdullah) ("Abdullah == Arabic      [" + (Get-Slug "Abdullah") + " == " + (Get-Slug $ar_abdullah) + "]")
Ok (Slugs-Match "Riyadh"   $ar_riyadh)   ("Riyadh == al-Riyadh     [" + (Get-Slug "Riyadh")   + " == " + (Get-Slug $ar_riyadh)   + "]")

Write-Host "`n-- slug non-match cases (MUST NOT MATCH) --" -ForegroundColor Cyan
Ok (-not (Slugs-Match "Ali" "Omar"))      ("Ali != Omar             [" + (Get-Slug "Ali")    + " != " + (Get-Slug "Omar")   + "]")
Ok (-not (Slugs-Match "Riyadh" "Jeddah")) ("Riyadh != Jeddah        [" + (Get-Slug "Riyadh") + " != " + (Get-Slug "Jeddah") + "]")

Write-Host "`n-- findCanonical mirror --" -ForegroundColor Cyan
$existing = @("Omar", "Ali", "Ahmad")
$canon = $null
foreach ($e in $existing) { if (Slugs-Match $e $ar_ahmad) { $canon = $e; break } }
Ok ($canon -eq "Ahmad")                        "findCanonical(Arabic Ahmad, [Omar,Ali,Ahmad]) = Ahmad"
$canon2 = $null
foreach ($e in @("Omar","Ali")) { if (Slugs-Match $e $ar_ahmad) { $canon2 = $e; break } }
Ok ($null -eq $canon2)                          "findCanonical returns null when no slug matches"

# ---- STATIC WIRING ASSERTIONS ----------------------------------------------
$root = Split-Path -Parent $PSScriptRoot
$libPath = Join-Path $root 'lib\entity-slug.js'
$egPath  = Join-Path $root 'lib\entity-graph.js'
$migPath = Join-Path $root 'migrations\B90_entity_slug.sql'
$lib = [IO.File]::ReadAllText($libPath, [Text.Encoding]::UTF8)
$eg  = [IO.File]::ReadAllText($egPath,  [Text.Encoding]::UTF8)
$mig = [IO.File]::ReadAllText($migPath, [Text.Encoding]::UTF8)

Write-Host "`n-- lib/entity-slug.js surface --" -ForegroundColor Cyan
Ok ([IO.File]::Exists($libPath))                          "entity-slug.js exists"
Ok ($lib -match 'function toSlug')                        "exports toSlug"
Ok ($lib -match 'function slugsMatch')                    "exports slugsMatch"
Ok ($lib -match 'function findCanonical')                 "exports findCanonical"
Ok ($lib -match 'module\.exports\s*=\s*\{\s*toSlug')      "module.exports surface"
Ok ($lib -match "replace\(VOWELS" -or $lib -match '\[aeiou\]') "drops vowels (consonant skeleton)"
Ok ($lib -match 'DIGRAPHS')                               "folds romanization digraphs"
Ok ($lib -match '0x0627' -and $lib -match '0x0644')       "strips Arabic article (alef+lam)"
Ok ($lib -match 'slice\(0, 80\)')                         "caps slug at 80 chars"

Write-Host "`n-- lib Arabic->Latin map (UTF-8 code-point check) --" -ForegroundColor Cyan
function MapHas([int]$cp, [string]$val) {
  $pat = '"' + [regex]::Escape([string][char]$cp) + '"\s*:\s*"' + $val + '"'
  return ($lib -match $pat)
}
Ok (MapHas 0x062D 'h')   "map HAH(062D) -> h"
Ok (MapHas 0x0645 'm')   "map MEEM(0645) -> m"
Ok (MapHas 0x062F 'd')   "map DAL(062F) -> d"
Ok (MapHas 0x0631 'r')   "map REH(0631) -> r"
Ok (MapHas 0x0636 'd')   "map DAD(0636) -> d"
Ok (MapHas 0x0639 'a')   "map AIN(0639) -> a"
Ok (MapHas 0x0644 'l')   "map LAM(0644) -> l"
Ok (MapHas 0x0627 'a')   "map ALEF(0627) -> a"

Write-Host "`n-- lib/entity-graph.js wiring --" -ForegroundColor Cyan
Ok ($eg -match "require\(['""]\./entity-slug")            "requires entity-slug"
Ok ($eg -match 'findCanonical\(')                          "calls findCanonical"
Ok ($eg -match 'toSlug\(name\)')                           "computes slug = toSlug(name)"
Ok ($eg -match 'limit\(200\)')                             "pulls last 200 names"
Ok ($eg -match 'insertEntityRow' -and $eg -match 'updateEntityRow') "slug-safe write helpers (pre-migration fail-safe)"
Ok ($eg -match 'patch\.slug' -and $eg -match 'row\.slug')  "persists slug on update + insert"
Ok ($eg -match 'catch \(_\)')                              "fail-safe: falls through on slug error"
Ok ($eg -match '\.ilike\("name", name\)')                  "keeps exact-name fallback path"

Write-Host "`n-- migration B90_entity_slug.sql --" -ForegroundColor Cyan
Ok ([IO.File]::Exists($migPath))                           "migration file exists"
Ok ($mig -match 'ADD COLUMN IF NOT EXISTS slug')           "adds slug column (idempotent)"
Ok ($mig -match 'CREATE INDEX IF NOT EXISTS m8_entities_slug_idx') "indexes slug"
Ok ($mig -match 'UPDATE m8_entities SET slug')             "backfills slug for existing rows"

# ---- summary ----------------------------------------------------------------
$total = $script:pass + $script:fail
Write-Host ""
$color = if ($script:fail -eq 0) { 'Green' } else { 'Red' }
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed") -ForegroundColor $color
Write-Host ("" + $script:pass + "/" + $total + " passed")
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
