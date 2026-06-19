# tests/command-center-verify.ps1
# PS-mirror of lib/command-center.js pure engine (Command Center v1, Decision 2026-0617-CC).
# No local Node on this box -> verify the deterministic logic via a faithful PowerShell port:
#   value-weighted dependency-blockage (spec D4, incl. GPT's "5 cleanups vs 1 memory build" case),
#   scoreTask + band thresholds (D5), cycle guard rejects adversarial A->B->C->A (Manus 3.3),
#   max-depth-8 guard (D8), and the blocked-filter (unmet deps never rank; D7).
# Pure ASCII (PS 5.1 reads no-BOM as ANSI); flat loops; weights/bands mirrored from the engine.

$script:pass = 0
$script:fail = 0
function Ok($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else       { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

# ---- mirrored constants (must match lib/command-center.js exactly) ----------
$WI = 0.2; $WU = 0.3; $WB = 0.4; $WC = 0.1; $WR = 0.3; $WE = 0.2
$BLOCKAGE_UNIT = 4.0
$BLOCKAGE_CAP  = 5.0
$OPEN = @('planned','active','blocked','waiting','review')

# ---- task factory -----------------------------------------------------------
function T($id, $state, $impact, $urgency, $risk, $strategic, $effort, $deps) {
  [pscustomobject]@{
    id = $id; title = ("task#" + $id); project_id = 1; state = $state;
    impact = $impact; urgency = $urgency; risk = $risk;
    strategic_value = $strategic; effort = $effort; deps = @($deps)
  }
}

# ---- pure-engine port -------------------------------------------------------
function Get-ReverseAdjacency($tasks) {
  $children = @{}
  foreach ($x in $tasks) {
    foreach ($d in @($x.deps)) {
      if ($null -eq $d) { continue }
      if (-not $children.ContainsKey([int]$d)) { $children[[int]$d] = New-Object System.Collections.ArrayList }
      [void]$children[[int]$d].Add([int]$x.id)
    }
  }
  return $children
}
function Get-DownstreamClosure([int]$taskId, $children) {
  $seen  = New-Object System.Collections.Generic.HashSet[int]
  $stack = New-Object System.Collections.Generic.Stack[int]
  $stack.Push($taskId)
  while ($stack.Count -gt 0) {
    $cur = $stack.Pop()
    if ($children.ContainsKey($cur)) {
      foreach ($c in $children[$cur]) {
        if (-not $seen.Contains([int]$c)) { [void]$seen.Add([int]$c); $stack.Push([int]$c) }
      }
    }
  }
  return $seen      # excludes taskId itself (matches JS)
}
function Get-BlockageRaw([int]$taskId, $children, $byId) {
  $sum = 0
  foreach ($id in (Get-DownstreamClosure $taskId $children)) {
    if ($byId.ContainsKey([int]$id)) { $t = $byId[[int]$id]; $sum += ([int]$t.impact + [int]$t.strategic_value) }
  }
  return $sum
}
function Get-BlockageScore($raw) { return [Math]::Min($BLOCKAGE_CAP, [double]$raw / $BLOCKAGE_UNIT) }
function Get-Score($t, $bScore) {
  return ($WI * [double]$t.impact) + ($WU * [double]$t.urgency) + ($WB * [double]$bScore) `
       + ($WC * [double]$t.strategic_value) - ($WR * [double]$t.risk) - ($WE * [double]$t.effort)
}
function Get-Band($score) {
  if ($score -ge 3.0) { return 'Critical' }
  elseif ($score -ge 2.2) { return 'Important' }
  elseif ($score -ge 1.4) { return 'Active' }
  elseif ($score -ge 0.6) { return 'Queued' }
  else { return 'Parking Lot' }
}
function Get-UnmetDeps($t, $byId) {
  $r = @()
  foreach ($d in @($t.deps)) {
    if ($null -eq $d) { continue }
    $u = $null; if ($byId.ContainsKey([int]$d)) { $u = $byId[[int]$d] }
    if ($null -eq $u -or $u.state -ne 'done') { $r += [int]$d }
  }
  return $r        # bare return: empty collapses to Count 0 under @() at the call site
}

# cycle guard (3-color DFS over the deps/upstream graph) ----------------------
$script:cc_byId = $null; $script:cc_color = $null; $script:cc_found = $false
function Invoke-CycleVisit([int]$id) {
  if ($script:cc_found) { return }
  $script:cc_color[$id] = 1
  $node = $script:cc_byId[$id]
  foreach ($d in @($node.deps)) {
    if ($null -eq $d -or -not $script:cc_byId.ContainsKey([int]$d)) { continue }
    $cd = $script:cc_color[[int]$d]
    if ($cd -eq 1) { $script:cc_found = $true; return }
    if ($cd -eq 0) { Invoke-CycleVisit ([int]$d) }
  }
  $script:cc_color[$id] = 2
}
function Test-HasCycle($tasks) {
  $script:cc_byId = @{}; foreach ($t in $tasks) { $script:cc_byId[[int]$t.id] = $t }
  $script:cc_color = @{}; foreach ($t in $tasks) { $script:cc_color[[int]$t.id] = 0 }
  $script:cc_found = $false
  foreach ($t in $tasks) { if ($script:cc_color[[int]$t.id] -eq 0) { Invoke-CycleVisit ([int]$t.id) } }
  return $script:cc_found
}

# longest upstream chain depth (edges); assumes acyclic -----------------------
$script:md_byId = $null; $script:md_memo = $null
function Get-Depth([int]$id, $guard) {
  if ($script:md_memo.ContainsKey($id)) { return $script:md_memo[$id] }
  if ($guard.Contains($id)) { return 0 }
  [void]$guard.Add($id)
  $best = 0
  foreach ($d in @($script:md_byId[$id].deps)) {
    if ($null -eq $d -or -not $script:md_byId.ContainsKey([int]$d)) { continue }
    $cand = 1 + (Get-Depth ([int]$d) $guard)
    if ($cand -gt $best) { $best = $cand }
  }
  [void]$guard.Remove($id)
  $script:md_memo[$id] = $best
  return $best
}
function Get-MaxDepth($tasks) {
  $script:md_byId = @{}; foreach ($t in $tasks) { $script:md_byId[[int]$t.id] = $t }
  $script:md_memo = @{}
  $m = 0
  foreach ($t in $tasks) {
    $g = New-Object System.Collections.Generic.HashSet[int]
    $d = Get-Depth ([int]$t.id) $g
    if ($d -gt $m) { $m = $d }
  }
  return $m
}

# build ranked packet (open filter + blocked split + bands) -------------------
function Build-Ranked($tasks) {
  $byId = @{}; foreach ($t in $tasks) { $byId[[int]$t.id] = $t }
  $children = Get-ReverseAdjacency $tasks
  $rows = @()
  foreach ($t in $tasks) {
    if ($OPEN -notcontains $t.state) { continue }
    $raw = Get-BlockageRaw ([int]$t.id) $children $byId
    $bScore = Get-BlockageScore $raw
    $score = Get-Score $t $bScore
    $unmet = @(Get-UnmetDeps $t $byId)
    $rows += [pscustomobject]@{
      id = [int]$t.id; blockageRaw = $raw; blockageScore = $bScore;
      score = $score; band = (Get-Band $score); blocked_by = $unmet
    }
  }
  $blocked  = @($rows | Where-Object { $_.blocked_by.Count -gt 0 } | Sort-Object -Property score -Descending)
  $rankable = @($rows | Where-Object { $_.blocked_by.Count -eq 0 } | Sort-Object -Property score -Descending)
  return [pscustomobject]@{ rows = $rows; blocked = $blocked; rankable = $rankable }
}
function Row($packet, $id) { return ($packet.rows | Where-Object { $_.id -eq $id } | Select-Object -First 1) }
function ClosureCount($tasks, $id) {
  $children = Get-ReverseAdjacency $tasks
  return (Get-DownstreamClosure ([int]$id) $children).Count
}

Write-Host ""
Write-Host "=== Command Center v1+v2 -- engine mirror verify ===" -ForegroundColor Cyan
Write-Host ""

# ============================================================================
# TEST 1 -- value-weighted blockage: GPT's "5 trivial cleanups vs 1 memory build"
# A (#1) unblocks 5 trivial leaf tasks (count 5, value 5*(1+1)=10).
# G (#2) unblocks a high-value Memory build (#21) which itself unblocks #22,#23
#        (closure count 3, value 3*(5+5)=30).
# RAW COUNT favors A (5 > 3). VALUE favors G (30 > 10) -> G must outrank A.
# ============================================================================
$gpt = @(
  (T 1 'planned' 2 2 1 1 1 @()),
  (T 11 'planned' 1 1 1 1 1 @(1)), (T 12 'planned' 1 1 1 1 1 @(1)),
  (T 13 'planned' 1 1 1 1 1 @(1)), (T 14 'planned' 1 1 1 1 1 @(1)),
  (T 15 'planned' 1 1 1 1 1 @(1)),
  (T 2 'planned' 2 2 1 1 1 @()),
  (T 21 'planned' 5 1 1 5 1 @(2)),
  (T 22 'planned' 5 1 1 5 1 @(21)),
  (T 23 'planned' 5 1 1 5 1 @(21))
)
$pk = Build-Ranked $gpt
$rA = Row $pk 1; $rG = Row $pk 2
$cntA = ClosureCount $gpt 1; $cntG = ClosureCount $gpt 2

Ok "raw downstream COUNT favors A (would mis-rank: $cntA > $cntG)" ($cntA -gt $cntG)
Ok "blockageRaw value-weighted: A=$($rA.blockageRaw) (expect 10)" ($rA.blockageRaw -eq 10)
Ok "blockageRaw value-weighted: G=$($rG.blockageRaw) (expect 30)" ($rG.blockageRaw -eq 30)
Ok "blockage clamp: G capped at 5.0 (30/4=7.5 -> 5)" ([Math]::Abs($rG.blockageScore - 5.0) -lt 1e-9)
Ok "VALUE-weighted blockage flips it: G outranks A ($([Math]::Round($rG.score,2)) > $([Math]::Round($rA.score,2)))" ($rG.score -gt $rA.score)
Ok "G lands in a higher band than A (G=$($rG.band), A=$($rA.band))" ($rG.band -eq 'Important' -and $rA.band -eq 'Active')

# ============================================================================
# TEST 2 -- band thresholds (D5). Drive Get-Band at the exact boundaries.
# ============================================================================
Ok "band 3.0 -> Critical"        ((Get-Band 3.0)   -eq 'Critical')
Ok "band 2.9 -> Important"       ((Get-Band 2.9)   -eq 'Important')
Ok "band 2.2 -> Important (eq)"  ((Get-Band 2.2)   -eq 'Important')
Ok "band 2.19 -> Active"         ((Get-Band 2.19)  -eq 'Active')
Ok "band 1.4 -> Active (eq)"     ((Get-Band 1.4)   -eq 'Active')
Ok "band 0.6 -> Queued (eq)"     ((Get-Band 0.6)   -eq 'Queued')
Ok "band 0.59 -> Parking Lot"    ((Get-Band 0.59)    -eq 'Parking Lot')
Ok "band -1.0 -> Parking Lot"    ((Get-Band (-1.0))  -eq 'Parking Lot')

# ============================================================================
# TEST 3 -- cycle guard rejects adversarial A->B->C->A (Manus 3.3).
# deps = upstream: A depends on B, B on C, C on A -> a 3-cycle.
# ============================================================================
$cyc = @( (T 1 'planned' 1 1 1 1 1 @(2)), (T 2 'planned' 1 1 1 1 1 @(3)), (T 3 'planned' 1 1 1 1 1 @(1)) )
Ok "cycle guard DETECTS A->B->C->A" (Test-HasCycle $cyc)
$acyc = @( (T 1 'planned' 1 1 1 1 1 @(2)), (T 2 'planned' 1 1 1 1 1 @(3)), (T 3 'planned' 1 1 1 1 1 @()) )
Ok "cycle guard PASSES a clean DAG" (-not (Test-HasCycle $acyc))
$self = @( (T 1 'planned' 1 1 1 1 1 @(1)) )
Ok "cycle guard DETECTS a self-loop" (Test-HasCycle $self)

# ============================================================================
# TEST 4 -- max-depth-8 guard (D8). Chain of N+1 nodes => depth N edges.
# Depth 8 is allowed (boundary); depth 9 must be rejected.
# ============================================================================
function Build-Chain($edges) {
  $arr = @()
  for ($i = 0; $i -le $edges; $i++) {
    $dep = @(); if ($i -lt $edges) { $dep = @($i + 1) }   # node i depends on node i+1
    $arr += (T $i 'planned' 1 1 1 1 1 $dep)
  }
  return $arr
}
Ok "max-depth of an 8-edge chain == 8 (boundary, allowed)" ((Get-MaxDepth (Build-Chain 8)) -eq 8)
Ok "max-depth of a 9-edge chain == 9 (> 8 -> write rejected)" ((Get-MaxDepth (Build-Chain 9)) -eq 9)

# ============================================================================
# TEST 5 -- blocked-filter (D7): a task with any non-done dep never ranks;
# it appears in the blocked list. Marking the dep done releases it to rankable.
# ============================================================================
$blk = @( (T 32 'active' 3 3 1 3 1 @()), (T 31 'planned' 4 4 1 5 1 @(32)) )
$pkB = Build-Ranked $blk
$inBlocked  = @($pkB.blocked  | Where-Object { $_.id -eq 31 }).Count -eq 1
$notRank    = @($pkB.rankable | Where-Object { $_.id -eq 31 }).Count -eq 0
Ok "blocked task #31 (dep #32 not done) is in BLOCKED list" $inBlocked
Ok "blocked task #31 is EXCLUDED from rankable/bands" $notRank

$rel = @( (T 32 'done' 3 3 1 3 1 @()), (T 31 'planned' 4 4 1 5 1 @(32)) )
$pkR = Build-Ranked $rel
$nowRank = @($pkR.rankable | Where-Object { $_.id -eq 31 }).Count -eq 1
Ok "once dep #32 is done, #31 moves to RANKABLE" $nowRank

# a 'done' task is dropped entirely from the open set
$pkDone = Build-Ranked @( (T 5 'done' 5 5 1 5 1 @()) )
Ok "done task is excluded from the open set entirely" ($pkDone.rows.Count -eq 0)

# ============================================================================
# TEST 6 -- chat routing: detectPriorityQuery (PRIORITY_RE) fires on the intended
# "what should we work on / priorities / command center" asks and does NOT steal
# research / fleet / engine-catalog turns. The .NET engine runs the EXACT JS pattern.
# ============================================================================
$PRIORITY_RE = [regex]::new(
  "\b(?:what(?:'s|s| is| should)?\s+(?:the\s+)?(?:my\s+|our\s+|next\s+)*(?:priorit\w*|most important|highest priority|work on next)|what\s+should\s+(?:i|we)\s+work\s+on|prioriti[sz]e|command\s+center|what(?:'s| is)\s+next\s+(?:on|for)\b|where should (?:i|we) focus)\b",
  [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
function Detect($m) { return $PRIORITY_RE.IsMatch([string]$m) }

# positives -- should ROUTE to the Command Center
Ok "route: 'what's the priority?'"            (Detect "what's the priority?")
Ok "route: 'what should we work on next?'"    (Detect "what should we work on next?")
Ok "route: 'what is my next priority'"        (Detect "what is my next priority")
Ok "route: 'whats the most important thing'"  (Detect "whats the most important thing to do")
Ok "route: 'prioritize my tasks'"             (Detect "prioritize my tasks")
Ok "route: 'open the command center'"         (Detect "open the command center")
Ok "route: 'where should I focus?'"           (Detect "where should I focus?")
# negatives -- must NOT be claimed by the priority route (other lanes own them)
Ok "no-route: research census run"            (-not (Detect "run the structural probes on collatz up to 100000"))
Ok "no-route: engine catalog ask"             (-not (Detect "what can your problem-solving engine do?"))
Ok "no-route: fleet question"                 (-not (Detect "how much did the top driver earn yesterday?"))
Ok "no-route: plain doc ask"                  (-not (Detect "summarize this report for me"))
Ok "no-route: small talk"                     (-not (Detect "what's the weather like today?"))
Ok "no-route: ops question (tight branch)"    (-not (Detect "what should I do about the late driver?"))

# ============================================================================
# TEST 7 -- v2 human-in-the-loop scoring + approval (Build-74).
# Mirrors detectScoreCommand parsing/validation, detectApproveCommand routing,
# and approvalDrift -- using the EXACT JS regexes run by the .NET engine.
# ============================================================================
$SCORE_TRIGGER_RE = [regex]::new("\b(?:rate|score|re[\s-]?score|set|update)\b", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$TASK_ID_RE       = [regex]::new("(?:\btask\s*#?\s*|#)(\d+)", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$FIELD_PAIR_RE    = [regex]::new("\b(impact|urgency|urgent|risk|effort|strategic[_\s-]?value|strategic|value)\b\s*(?:to|=|:|at)?\s*(\d+)", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$APPROVE_RE       = [regex]::new("\b(?:approve|lock(?:\s+in)?|confirm|accept|sign[\s-]?off(?:\s+on)?)\b[^.?!\n]{0,40}\b(?:priorit\w*|ranking|the\s+order|command\s*center|ledger)\b", [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
$SCORE_FIELD_MAP  = @{ impact='impact'; urgency='urgency'; urgent='urgency'; risk='risk'; effort='effort'; strategic='strategic_value'; strategic_value='strategic_value'; value='strategic_value' }

function Test-FieldOk($field, $val) {
  if ($field -eq 'strategic_value') { return (@(1,3,5) -contains $val) }
  return ($val -ge 1 -and $val -le 5)
}
function Parse-Score($m) {
  if (-not $SCORE_TRIGGER_RE.IsMatch($m)) { return $null }
  $idm = $TASK_ID_RE.Match($m)
  if (-not $idm.Success) { return $null }
  $id = [int]$idm.Groups[1].Value
  $updates = @{}; $invalid = @()
  foreach ($mm in $FIELD_PAIR_RE.Matches($m)) {
    $raw = ($mm.Groups[1].Value.ToLower() -replace '[\s-]', '_')
    if (-not $SCORE_FIELD_MAP.ContainsKey($raw)) { continue }
    $field = $SCORE_FIELD_MAP[$raw]
    $val = [int]$mm.Groups[2].Value
    if (Test-FieldOk $field $val) { $updates[$field] = $val } else { $invalid += $field }
  }
  if ($updates.Count -eq 0 -and $invalid.Count -eq 0) { return $null }
  return @{ id = $id; updates = $updates; invalid = $invalid }
}
function Approval-Drift($currentIds, $approvedOrder) {
  $approvedSet = @{}; foreach ($i in $approvedOrder) { $approvedSet[[int]$i] = $true }
  $cur = @(); foreach ($i in $currentIds) { if ($approvedSet.ContainsKey([int]$i)) { $cur += [int]$i } }
  $curSet = @{}; foreach ($i in $cur) { $curSet[[int]$i] = $true }
  $app = @(); foreach ($i in $approvedOrder) { if ($curSet.ContainsKey([int]$i)) { $app += [int]$i } }
  return (($cur -join ',') -ne ($app -join ','))
}

# -- score command parsing --
$s1 = Parse-Score "rate task #3 impact 5 urgency 4"
Ok "score parse: id extracted (#3)"                ($s1.id -eq 3)
Ok "score parse: impact=5 captured"                ($s1.updates['impact'] -eq 5)
Ok "score parse: urgency=4 captured"               ($s1.updates['urgency'] -eq 4)
Ok "score parse: no invalid fields"                ($s1.invalid.Count -eq 0)

$s2 = Parse-Score "set #2 strategic 4"
Ok "score parse: strategic 4 is INVALID (not 1/3/5)" ($s2.invalid -contains 'strategic_value')
Ok "score parse: invalid leaves updates empty"     ($s2.updates.Count -eq 0)

$s3 = Parse-Score "set #2 strategic 5"
Ok "score parse: strategic 5 is VALID"             ($s3.updates['strategic_value'] -eq 5)
$s3b = Parse-Score "rate #2 strategic value 3"
Ok "score parse: 'strategic value 3' -> field+3"   ($s3b.updates['strategic_value'] -eq 3)

$s4 = Parse-Score "update #7 impact 6"
Ok "score parse: impact 6 out of range -> invalid" ($s4.invalid -contains 'impact')
$s5 = Parse-Score "score #11 effort 1 risk 2"
Ok "score parse: multi-field effort=1 risk=2"      ($s5.updates['effort'] -eq 1 -and $s5.updates['risk'] -eq 2)

Ok "score parse: 'rate this highly' -> null (no id)" ($null -eq (Parse-Score "rate this highly"))
Ok "score parse: 'what's the priority?' -> null"     ($null -eq (Parse-Score "what's the priority?"))

# -- approve command routing --
Ok "approve: 'approve the priority order'"   ($APPROVE_RE.IsMatch("approve the priority order"))
Ok "approve: 'lock in the ranking'"          ($APPROVE_RE.IsMatch("lock in the ranking"))
Ok "approve: 'confirm the command center order'" ($APPROVE_RE.IsMatch("confirm the command center order"))
Ok "approve: 'accept the ledger priorities'" ($APPROVE_RE.IsMatch("accept the ledger priorities"))
Ok "approve no-route: 'approve the deployment'" (-not $APPROVE_RE.IsMatch("approve the deployment"))
Ok "approve no-route: 'lock the door'"          (-not $APPROVE_RE.IsMatch("lock the door"))
Ok "approve no-route: 'what's the priority?'"   (-not $APPROVE_RE.IsMatch("what's the priority?"))

# the approve verbs must NOT collide with the priority-query route (checked first in orchestrator anyway)
Ok "approve text not caught by PRIORITY_RE"  (-not (Detect "approve the priority order"))

# -- drift detection --
Ok "drift: order [3,1,2] vs approved [1,2,3] -> drifted" (Approval-Drift @(3,1,2) @(1,2,3))
Ok "drift: order [1,2,3] vs approved [1,2,3] -> stable"  (-not (Approval-Drift @(1,2,3) @(1,2,3)))
Ok "drift: a NEW task (#9) doesn't count as drift"       (-not (Approval-Drift @(1,2,3,9) @(1,2,3)))
Ok "drift: a removed task collapses order -> stable on shared set" (-not (Approval-Drift @(1,3) @(1,2,3)))
Ok "drift: reordered shared set [2,1] vs [1,2,3] -> drifted" (Approval-Drift @(2,1) @(1,2,3))

# -- re-rank effect: bumping a task's scores moves it up (what applyScoreCommand relies on) --
$beforeT = @( (T 1 'planned' 3 3 1 3 1 @()), (T 2 'planned' 3 3 1 3 1 @()) )
$pkBefore = Build-Ranked $beforeT
$afterT  = @( (T 1 'planned' 3 3 1 3 1 @()), (T 2 'planned' 5 5 1 5 1 @()) )
$pkAfter  = Build-Ranked $afterT
$topAfter = ($pkAfter.rankable | Select-Object -First 1).id
Ok "re-rank: bumping #2 to 5/5/5 makes it outrank #1" ($topAfter -eq 2)
Ok "re-rank: #2 score strictly increased after bump" ((Row $pkAfter 2).score -gt (Row $pkBefore 2).score)

# ============================================================================
Write-Host ""
$resultColor = 'Green'; if ($script:fail -ne 0) { $resultColor = 'Red' }
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed") -ForegroundColor $resultColor
if ($script:fail -ne 0) { exit 1 }
