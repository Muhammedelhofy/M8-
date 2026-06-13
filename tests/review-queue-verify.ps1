# review-queue-verify.ps1 -- Build-17 (M3.1): PS mirror of the review-queue PURE
# core in lib/review-queue.js. Two load-bearing properties:
#   (1) clusterAndRank groups by structural template family (families in name
#       order; within a family unmatched-first then statement asc) and its sort
#       key contains NO test/quality value (margin/observed/tested_to) -- the
#       order is triage/coverage, never a truth/novelty/quality ranking.
#   (2) detectReviewQueue routes view vs triage (triage requires a #id anchor)
#       and maps the verb to the right state.
# Pure ASCII (no-BOM .ps1 -> PS 5.1 ANSI). No DB here -- persistence/dedup are
# exercised live (tests/BUILD17_LIVE_TEST.md).

$pass = 0; $fail = 0
function CheckTrue([string]$name, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $name" -ForegroundColor Green }
  else { $script:fail++; Write-Host "  FAIL  $name" -ForegroundColor Red }
}

# -- PS mirror of clusterAndRank (lib/review-queue.js) --
function ClusterAndRank($items) {
  $groups = @{}
  foreach ($it in $items) {
    $k = if ($it.template) { "$($it.template)" } else { "(unknown)" }
    if (-not $groups.ContainsKey($k)) { $groups[$k] = New-Object System.Collections.ArrayList }
    [void]$groups[$k].Add($it)
  }
  $clusters = @()
  foreach ($k in ($groups.Keys | Sort-Object)) {
    $arr = @($groups[$k]) | Sort-Object `
      -Property @{ Expression = { if ($_.known_match) { 1 } else { 0 } } }, @{ Expression = { "$($_.statement)" } }
    $clusters += [pscustomobject]@{ template = $k; items = @($arr) }
  }
  return ,$clusters
}

# -- PS mirror of detectReviewQueue (lib/review-queue.js) --
function DetectReviewQueue([string]$message) {
  $s = ("$message").Trim()
  if ($s.Length -lt 4) { return @{ mode = $null } }
  $ids = @([regex]::Matches($s, '#(\d+)') | ForEach-Object { $_.Groups[1].Value })
  if ($ids.Count -gt 0) {
    $action = $null
    if ($s -imatch '\b(?:dismiss|reject|drop|discard|remove)\b') { $action = 'dismissed' }
    elseif ($s -imatch '\bkeep\b') { $action = 'kept' }
    elseif ($s -imatch '\b(?:reviewed|mark(?:ed)?)\b') { $action = 'reviewed' }
    if ($action) { return @{ mode = 'triage'; ids = $ids; action = $action } }
  }
  if (($s -imatch '\b(?:m3\s+)?(?:conjecture\s+|survivor\s+)?(?:review|triage)\s+queue\b') -or ($s -imatch '\bqueued?\s+for\s+review\b')) {
    return @{ mode = 'view' }
  }
  return @{ mode = $null }
}

Write-Host "`n== clusterAndRank: triage/coverage order, NO quality field ==" -ForegroundColor Cyan

# Two families, a known/unmatched mix, with margin + tested_to deliberately set so
# that ranking by EITHER would reverse the honest order. The honest order ignores both.
$items = @(
  [pscustomobject]@{ statement = "B claim zebra"; template = "B_sigma_freq";   known_match = $null;     margin = 0.1; tested_to = 100000 },
  [pscustomobject]@{ statement = "B claim apple"; template = "B_sigma_freq";   known_match = "terras";  margin = 0.0; tested_to = 300000 },
  [pscustomobject]@{ statement = "A claim mango"; template = "A_res_sigma_max"; known_match = $null;     margin = 99;  tested_to = 20000 }
)
$cl = ClusterAndRank $items
CheckTrue "families emitted in template-name order (A_ before B_)" ($cl[0].template -eq "A_res_sigma_max" -and $cl[1].template -eq "B_sigma_freq")

$bfam = $cl[1].items
CheckTrue "within family: UNMATCHED listed before known-form (coverage heuristic)" ((-not $bfam[0].known_match) -and ($bfam[1].known_match))
CheckTrue "order ignores tested_to (known item has HIGHER tested_to yet is last)" ($bfam[0].statement -eq "B claim zebra")
CheckTrue "order ignores margin (known item has tighter margin yet is last)"       ($bfam[1].statement -eq "B claim apple")

# Same known-status -> pure alphabetical by statement, NOT by margin.
$items2 = @(
  [pscustomobject]@{ statement = "zzz higher margin"; template = "T"; known_match = $null; margin = 1 },
  [pscustomobject]@{ statement = "aaa lower margin";  template = "T"; known_match = $null; margin = 99 }
)
$cl2 = ClusterAndRank $items2
CheckTrue "same status -> alphabetical by statement, margin ignored" ($cl2[0].items[0].statement -eq "aaa lower margin")

Write-Host "`n== detectReviewQueue: view vs triage routing ==" -ForegroundColor Cyan

$v1 = DetectReviewQueue "show me the m3 review queue"
CheckTrue "view: 'show me the m3 review queue'" ($v1.mode -eq 'view')
$v2 = DetectReviewQueue "what's in the triage queue?"
CheckTrue "view: 'triage queue'" ($v2.mode -eq 'view')
$v3 = DetectReviewQueue "list the survivor review queue"
CheckTrue "view: 'survivor review queue'" ($v3.mode -eq 'view')
$v4 = DetectReviewQueue "what is queued for review"
CheckTrue "view: 'queued for review'" ($v4.mode -eq 'view')

$t1 = DetectReviewQueue "dismiss #12"
CheckTrue "triage: 'dismiss #12' -> dismissed [12]" ($t1.mode -eq 'triage' -and $t1.action -eq 'dismissed' -and $t1.ids[0] -eq '12')
$t2 = DetectReviewQueue "keep #3 #4"
CheckTrue "triage: 'keep #3 #4' -> kept [3,4]" ($t2.mode -eq 'triage' -and $t2.action -eq 'kept' -and $t2.ids.Count -eq 2 -and $t2.ids[1] -eq '4')
$t3 = DetectReviewQueue "mark #5 reviewed"
CheckTrue "triage: 'mark #5 reviewed' -> reviewed [5]" ($t3.mode -eq 'triage' -and $t3.action -eq 'reviewed' -and $t3.ids[0] -eq '5')
$t4 = DetectReviewQueue "reject #9 please"
CheckTrue "triage: 'reject #9' -> dismissed [9]" ($t4.mode -eq 'triage' -and $t4.action -eq 'dismissed')

# negatives: no false positives
$n1 = DetectReviewQueue "keep going on the collatz run"
CheckTrue "negative: 'keep going' (no #id) -> null" ($null -eq $n1.mode)
$n2 = DetectReviewQueue "run the conjecture generator on collatz up to 100000"
CheckTrue "negative: a generator run -> null (not the queue lane)" ($null -eq $n2.mode)
$n3 = DetectReviewQueue "#12"
CheckTrue "negative: bare '#12' (no action verb) -> null" ($null -eq $n3.mode)
$n4 = DetectReviewQueue "hi"
CheckTrue "negative: short greeting -> null" ($null -eq $n4.mode)

# deterministic precedence: dismiss wins when verbs conflict (documented behavior)
$p1 = DetectReviewQueue "keep #1 but dismiss #2"
CheckTrue "precedence: conflicting verbs -> dismissed (deterministic)" ($p1.action -eq 'dismissed')

Write-Host "`n=================================================="
Write-Host ("  review-queue M3.1: {0} passed, {1} failed" -f $pass, $fail) -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
if ($fail -gt 0) { exit 1 } else { exit 0 }
