# ============================================================================
# Build-85e: Memory Consolidation - offline verifier (PS 5.1, no Node).
#   powershell -File tests/B85e-memory-consolidation-verify.ps1
#
# Two parts:
#   1) A PowerShell MIRROR of the PURE logic in lib/memory-consolidator.js
#      (tokenSet / jaccard / groupByJaccard / pickCanonical / candidatePairs /
#       confidence) run over small fixtures - kept in lockstep with the JS.
#   2) Static assertions: the module + endpoint export/return the right surface,
#      the model/threshold/cap constants are correct, recallMemory filters
#      merged_into IS NULL, and the migration adds the columns + index.
# Pure ASCII (PS 5.1 reads a no-BOM file as ANSI).
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

# ---- PURE-LOGIC MIRROR ------------------------------------------------------
$JACCARD_THRESHOLD = 0.6
$MAX_PAIRS = 50

function TokensOf([string]$s) {
  if ($null -eq $s) { $s = "" }
  return @( ($s.ToLower() -split '[^a-z0-9]+') | Where-Object { $_ } | Select-Object -Unique )
}
function Jaccard([string]$a, [string]$b) {
  # NB: locals are $ta/$tb (NOT $A/$B): PowerShell variable names are
  # case-insensitive, so $A would alias the typed [string]$a param and coerce
  # the token array back into a string. JS (case-sensitive) has no such issue.
  $ta = TokensOf $a; $tb = TokensOf $b
  if ($ta.Count -eq 0 -and $tb.Count -eq 0) { return 0.0 }
  $inter = 0; foreach ($w in $ta) { if ($tb -contains $w) { $inter++ } }
  $union = $ta.Count + $tb.Count - $inter
  if ($union -eq 0) { return 0.0 }
  return [math]::Round([double]$inter / [double]$union, 4)
}
function PickCanonical($rows) {
  return (@($rows) | Sort-Object @{Expression='importance';Descending=$true}, @{Expression='created_at';Descending=$false})[0]
}
function GroupByJaccard($facts, $th) {
  $groups = New-Object System.Collections.ArrayList
  foreach ($f in $facts) {
    $placed = $false
    foreach ($g in $groups) {
      foreach ($s in $g.sets) {
        if ((Jaccard $f.content $s) -ge $th) { [void]$g.rows.Add($f); [void]$g.sets.Add($f.content); $placed = $true; break }
      }
      if ($placed) { break }
    }
    if (-not $placed) {
      $rows = New-Object System.Collections.ArrayList; [void]$rows.Add($f)
      $sets = New-Object System.Collections.ArrayList; [void]$sets.Add($f.content)
      [void]$groups.Add([pscustomobject]@{ rows = $rows; sets = $sets })
    }
  }
  $out = New-Object System.Collections.ArrayList
  foreach ($g in $groups) {
    if ($g.rows.Count -gt 1) {
      $canon = PickCanonical $g.rows
      $dups = @($g.rows | Where-Object { $_.id -ne $canon.id })
      [void]$out.Add([pscustomobject]@{ canonical = $canon; duplicates = $dups })
    }
  }
  return ,$out
}
function CandidatePairs($facts, $cap) {
  $byKey = @{}
  foreach ($f in $facts) {
    $k = if ($f.memory_key) { $f.memory_key } else { "_nokey_" }
    if (-not $byKey.ContainsKey($k)) { $byKey[$k] = (New-Object System.Collections.ArrayList) }
    [void]$byKey[$k].Add($f)
  }
  $pairs = New-Object System.Collections.ArrayList
  foreach ($k in $byKey.Keys) {
    $rows = $byKey[$k]
    for ($i = 0; $i -lt $rows.Count; $i++) {
      for ($j = $i + 1; $j -lt $rows.Count; $j++) {
        [void]$pairs.Add(@($rows[$i], $rows[$j]))
        if ($pairs.Count -ge $cap) { return ,$pairs }
      }
    }
  }
  return ,$pairs
}
function Confidence($r) { return ([int]$r.trust_level) * 10 + [int]$r.importance }

function Fact($id, $content, $imp, $trust, $key, $created) {
  return [pscustomobject]@{ id = $id; content = $content; importance = $imp; trust_level = $trust; memory_key = $key; created_at = $created }
}

Write-Host "`n-- pure logic: tokenSet / jaccard --" -ForegroundColor Cyan
Ok ((TokensOf "the fleet has 12 cars").Count -eq 5)                 "tokenSet splits + dedupes (5 tokens)"
Ok ((Jaccard "a b c" "a b c") -eq 1)                                "jaccard identical = 1"
Ok ((Jaccard "a b c" "x y z") -eq 0)                                "jaccard disjoint = 0"
Ok ((Jaccard "" "") -eq 0)                                          "jaccard both empty = 0"
Ok ((Jaccard "a b c" "a b d") -eq 0.5)                              "jaccard {a,b}/{a,b,c,d} = 0.5"
Ok ((Jaccard "the fleet has 12 cars" "fleet has 12 cars") -ge 0.6) "near-duplicate >= 0.6"
Ok ((Jaccard "fleet has 12 cars" "driver net target is 5000") -lt 0.6) "distinct facts < 0.6"

Write-Host "`n-- pure logic: groupByJaccard / pickCanonical --" -ForegroundColor Cyan
$nearDups = @(
  (Fact "a1" "the fleet has 12 cars"  3 3 "fleet_size" "2026-01-01T00:00:00Z"),
  (Fact "a2" "fleet has 12 cars"      5 3 "fleet_size" "2026-02-01T00:00:00Z"),
  (Fact "b1" "driver net target 5000" 4 3 "net_target" "2026-01-15T00:00:00Z")
)
$groups = GroupByJaccard $nearDups $JACCARD_THRESHOLD
Ok ($groups.Count -eq 1)                          "two near-dups -> exactly one group"
Ok ($groups[0].duplicates.Count -eq 1)            "group has one duplicate"
Ok ($groups[0].canonical.id -eq "a2")             "canonical = highest importance (a2)"

$allDistinct = @(
  (Fact "c1" "muhammad lives in riyadh" 4 3 "city"  "2026-01-01T00:00:00Z"),
  (Fact "c2" "the company name is mhm"  4 3 "co"    "2026-01-02T00:00:00Z")
)
Ok ((GroupByJaccard $allDistinct $JACCARD_THRESHOLD).Count -eq 0) "all-distinct facts -> no groups"

$tie = @(
  (Fact "t1" "fleet has 12 cars total" 4 3 "fleet_size" "2026-01-01T00:00:00Z"),
  (Fact "t2" "fleet has 12 cars total" 4 3 "fleet_size" "2026-03-01T00:00:00Z")
)
$tg = GroupByJaccard $tie $JACCARD_THRESHOLD
Ok ($tg[0].canonical.id -eq "t1")                 "canonical tie-break = oldest (t1)"

Write-Host "`n-- pure logic: candidatePairs / confidence --" -ForegroundColor Cyan
$sameKey = @(
  (Fact "p1" "net target 5000" 4 3 "net_target" "2026-01-01T00:00:00Z"),
  (Fact "p2" "net target 4000" 3 2 "net_target" "2026-02-01T00:00:00Z")
)
Ok ((CandidatePairs $sameKey $MAX_PAIRS).Count -eq 1) "same memory_key -> one candidate pair"
$distinctKeys = @(
  (Fact "q1" "alpha" 4 3 "k1" "2026-01-01T00:00:00Z"),
  (Fact "q2" "beta"  4 3 "k2" "2026-01-02T00:00:00Z")
)
Ok ((CandidatePairs $distinctKeys $MAX_PAIRS).Count -eq 0) "distinct keys -> no pairs"
# 6 facts on one key -> 15 pairs, but cap=3 stops at 3
$many = 0..5 | ForEach-Object { Fact "m$_" "val $_" 3 3 "samekey" "2026-01-0${_}T00:00:00Z" }
Ok ((CandidatePairs $many 3).Count -eq 3)            "candidatePairs respects cap"
Ok ((Confidence (Fact 'x' 'c' 1 4 'k' '2026-01-01T00:00:00Z')) -gt (Confidence (Fact 'y' 'c' 9 0 'k' '2026-01-01T00:00:00Z'))) "confidence: trust dominates importance"
Ok ((Confidence (Fact 'x' 'c' 5 2 'k' '2026-01-01T00:00:00Z')) -gt (Confidence (Fact 'y' 'c' 3 2 'k' '2026-01-01T00:00:00Z'))) "confidence: importance breaks trust tie"

# ---- STATIC WIRING ASSERTIONS ----------------------------------------------
$root = Split-Path -Parent $PSScriptRoot
$con  = Get-Content (Join-Path $root 'lib\memory-consolidator.js') -Raw
$api  = Get-Content (Join-Path $root 'api\memory-consolidate.js')  -Raw
$mem  = Get-Content (Join-Path $root 'lib\memory.js')              -Raw
$mig  = Get-Content (Join-Path $root 'migrations\B85e_memory_consolidation.sql') -Raw

Write-Host "`n-- consolidator module --" -ForegroundColor Cyan
Ok ($con -match 'findDuplicates')              "consolidator exports findDuplicates"
Ok ($con -match 'consolidate')                 "consolidator exports consolidate"
Ok ($con -match 'flagContradictions')          "consolidator exports flagContradictions"
Ok ($con -match 'JACCARD_THRESHOLD\s*=\s*0\.6') "JACCARD_THRESHOLD = 0.6"
Ok ($con -match 'MAX_PAIRS\s*=\s*50')          "MAX_PAIRS = 50"
Ok ($con -match 'gemini-2\.5-flash')           "contradiction model = gemini-2.5-flash"
Ok ($con -match 'maxOutputTokens:\s*100')      "contradiction maxOutputTokens 100"
Ok ($con -match 'fire-and-forget')             "documents fire-and-forget contract"
Ok ($con -match 'checkPairAsync')              "has fire-and-forget checkPairAsync"
Ok ($con -match 'merged_into:\s*g\.canonical\.id') "consolidate sets merged_into = canonical"
Ok ($con -match 'is_current:\s*false')         "consolidate marks duplicate not-current"
Ok ($con -match '\.is\("merged_into", null\)') "fetchFacts skips already-merged rows"

Write-Host "`n-- /api/memory-consolidate endpoint --" -ForegroundColor Cyan
Ok ($null -ne $api)                            "api/memory-consolidate.js exists"
Ok ($api -match 'consolidate\(db\)')           "endpoint calls consolidate(db)"
Ok ($api -match 'flagContradictions\(db\)')    "endpoint calls flagContradictions(db)"
Ok ($api -match 'consolidated:')               "response has consolidated"
Ok ($api -match 'kept:')                       "response has kept"
Ok ($api -match 'contradictions:')             "response has contradictions"
Ok ($api -match 'ran_at:')                     "response has ran_at"

Write-Host "`n-- recallMemory filter --" -ForegroundColor Cyan
Ok (([regex]::Matches($mem, '\.is\("merged_into", null\)')).Count -ge 2) "recall filters merged_into IS NULL (both queries)"

Write-Host "`n-- migration --" -ForegroundColor Cyan
Ok ($mig -match 'ALTER TABLE m8_conversations')         "migration alters m8_conversations"
Ok ($mig -match 'merged_into uuid')                     "adds merged_into uuid"
Ok ($mig -match 'REFERENCES m8_conversations\(id\)')    "merged_into references canonical id"
Ok ($mig -match 'contradiction_flag boolean')           "adds contradiction_flag boolean"
Ok ($mig -match 'contradiction_reason text')            "adds contradiction_reason text"
Ok ($mig -match 'INDEX.*merged_into')                   "indexes merged_into"

# ---- summary ----------------------------------------------------------------
Write-Host ""
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed") -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
