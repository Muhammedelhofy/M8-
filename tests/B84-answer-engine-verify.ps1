# tests/B84-answer-engine-verify.ps1
# PS-mirror of lib/answer-engine.js pure logic (Build-84 Multi-Source Answer Engine).
# No local Node on this box -> verify the deterministic pieces via a faithful PowerShell
# port: parseIntent, selectSources (intent map + flag overrides), wordSet/jaccard,
# toItems, mergeEvidence (Jaccard >= 0.5 dedup, keep higher-confidence copy), citationTag,
# confidenceNote (hedge below 0.75), renderEvidenceBlock.
# Pure ASCII (PS 5.1 reads no-BOM as ANSI); constants mirrored from the engine.

$script:pass = 0
$script:fail = 0
function Ok($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else       { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

# ---- mirrored constants -----------------------------------------------------
$INTENTS = @('fleet','finance','knowledge','math','general','hybrid')
$STOP = @('the','a','an','and','or','but','of','to','in','on','at','for','with','from','by',
  'is','are','was','were','be','been','being','it','its','this','that','these','those',
  'as','into','about','over','than','then','so','such','not','no','yes','i','you','he',
  'she','they','we','his','her','their','our','my','your','what','when','where','which',
  'who','how','why','do','does','did','has','have','had','will','would','can','could')
$STOPSET = @{}; foreach ($w in $STOP) { $STOPSET[$w] = $true }

# SOURCE_MAP mirror: order fleet,finance,knowledge,math,entity,recall
$SOURCE_MAP = @{
  fleet     = @{ fleet=$true;  finance=$false; knowledge=$false; math=$false; entity=$true;  recall=$true  }
  finance   = @{ fleet=$true;  finance=$true;  knowledge=$false; math=$false; entity=$true;  recall=$true  }
  knowledge = @{ fleet=$false; finance=$false; knowledge=$true;  math=$false; entity=$true;  recall=$true  }
  math      = @{ fleet=$false; finance=$false; knowledge=$false; math=$true;  entity=$false; recall=$false }
  general   = @{ fleet=$false; finance=$false; knowledge=$true;  math=$false; entity=$true;  recall=$true  }
  hybrid    = @{ fleet=$true;  finance=$true;  knowledge=$true;  math=$true;  entity=$true;  recall=$true  }
}

# ---- pure-engine port -------------------------------------------------------
function ParseIntent($raw) {
  if ($null -eq $raw -or $raw -isnot [string]) { return $null }
  $low = $raw.ToLower()
  foreach ($i in $INTENTS) {
    if ($low -match ('\b' + $i + '\b')) { return $i }
  }
  return $null
}

function SelectSources($intent, $flags) {
  $base = $SOURCE_MAP[$intent]; if ($null -eq $base) { $base = $SOURCE_MAP['hybrid'] }
  $sel = @{}; foreach ($k in $base.Keys) { $sel[$k] = $base[$k] }
  if ($flags.ContainsKey('fleetLike') -and $flags.fleetLike) { $sel.fleet = $true }
  if ($flags.ContainsKey('financeLike') -and $flags.financeLike) { $sel.finance = $true; $sel.fleet = $true }
  if ($flags.ContainsKey('computeMode') -and $flags.computeMode) { $sel.math = $true }
  if ($flags.ContainsKey('knowledgeIngestMode') -and $flags.knowledgeIngestMode) { $sel.knowledge = $true }
  if ($flags.ContainsKey('imgTurn') -and $flags.imgTurn) { $sel.knowledge = ($sel.knowledge -or $base.knowledge) }
  return $sel
}

function WordSet($text) {
  $set = @{}
  if ([string]::IsNullOrEmpty($text)) { return $set }
  $clean = ($text.ToLower() -replace '[^\p{L}\p{N}\s]', ' ')
  foreach ($w in ($clean -split '\s+')) {
    if ($w.Length -ge 3 -and -not $STOPSET.ContainsKey($w)) { $set[$w] = $true }
  }
  return $set
}

function Jaccard($a, $b) {
  if ($null -eq $a -or $null -eq $b) { return 0.0 }
  if ($a.Count -eq 0 -and $b.Count -eq 0) { return 0.0 }
  $inter = 0
  foreach ($w in $a.Keys) { if ($b.ContainsKey($w)) { $inter++ } }
  $uni = $a.Count + $b.Count - $inter
  if ($uni -eq 0) { return 0.0 }
  return [double]$inter / [double]$uni
}

function ToItems($raw, $source) {
  $out = @()
  if ($null -eq $raw) { return $out }
  $rows = @()
  if ($raw -is [string]) {
    foreach ($line in ($raw -split "`n")) { $t = $line.Trim(); if ($t) { $rows += $t } }
  } elseif ($raw -is [array]) {
    $rows = $raw
  } else {
    $rows = @($raw)
  }
  foreach ($r in $rows) {
    if ($r -is [hashtable]) {
      $content = ''
      if ($r.ContainsKey('content')) { $content = [string]$r.content } elseif ($r.ContainsKey('text')) { $content = [string]$r.text }
      $content = $content.Trim()
      $conf = 0.5; if ($r.ContainsKey('confidence')) { $conf = [double]$r.confidence }
      $src = $source; if ($r.ContainsKey('source') -and $r.source) { $src = $r.source }
      $ref = $null; if ($r.ContainsKey('ref')) { $ref = $r.ref }
      if ($content.Length -gt 0) { $out += @{ content=$content; source=$src; confidence=$conf; ref=$ref } }
    } else {
      $content = ([string]$r).Trim()
      if ($content.Length -gt 0) { $out += @{ content=$content; source=$source; confidence=0.5; ref=$null } }
    }
  }
  return ,$out
}

function MergeEvidence($kg, $mem, $threshold = 0.5) {
  $items = @()
  $items += ToItems $kg 'KG'
  $items += ToItems $mem 'Memory'
  $kept = New-Object System.Collections.ArrayList
  foreach ($it in $items) {
    $ws = WordSet $it.content
    $bestDup = $null; $bestSim = 0.0
    foreach ($k in $kept) {
      $sim = Jaccard $ws $k._ws
      if ($sim -ge $threshold -and $sim -gt $bestSim) { $bestDup = $k; $bestSim = $sim }
    }
    if ($null -ne $bestDup) {
      $bestDup.merged = $true
      $prev = 0.0; if ($null -ne $bestDup.similarity) { $prev = [double]$bestDup.similarity }
      $bestDup.similarity = [Math]::Max($prev, $bestSim)
      if ([double]$it.confidence -gt [double]$bestDup.confidence) {
        $bestDup.content = $it.content; $bestDup.source = $it.source
        $bestDup.confidence = $it.confidence; $bestDup.ref = $it.ref; $bestDup._ws = $ws
      }
    } else {
      [void]$kept.Add(@{ content=$it.content; source=$it.source; confidence=$it.confidence;
        ref=$it.ref; _ws=$ws; similarity=$null; merged=$false })
    }
  }
  return $kept
}

function CitationTag($source, $ref) {
  if ($source -eq 'KG')     { if ($ref) { return "[KG: $ref]" } else { return '[KG]' } }
  if ($source -eq 'Memory') { return '[Memory]' }
  if ($source -eq 'Entity') { return '[Entity]' }
  if ($source -eq 'Fleet')  { return '[Fleet]' }
  return "[$source]"
}

function ConfidenceNote($sim) {
  if ($null -eq $sim) { return '' }
  if ([double]$sim -lt 0.75) {
    return (" (found with " + ('{0:N2}' -f [double]$sim) + " similarity - treat as supporting context, not confirmed fact)")
  }
  return ''
}

function RenderEvidenceBlock($merged) {
  if ($null -eq $merged -or $merged.Count -eq 0) { return '' }
  $lines = @()
  foreach ($m in $merged) {
    $lines += ((CitationTag $m.source $m.ref) + ' ' + $m.content + (ConfidenceNote $m.similarity))
  }
  return ($lines -join "`n")
}

Write-Host "`n=== B84 Answer Engine ===" -ForegroundColor Cyan

# ---- parseIntent ------------------------------------------------------------
Ok "parseIntent fleet"              ((ParseIntent 'fleet') -eq 'fleet')
Ok "parseIntent finance"           ((ParseIntent 'finance') -eq 'finance')
Ok "parseIntent trims sentence"    ((ParseIntent 'The intent is knowledge.') -eq 'knowledge')
Ok "parseIntent case-insensitive"  ((ParseIntent 'MATH') -eq 'math')
Ok "parseIntent hybrid"            ((ParseIntent 'hybrid') -eq 'hybrid')
Ok "parseIntent garbage -> null"   ($null -eq (ParseIntent 'banana split'))
Ok "parseIntent empty -> null"     ($null -eq (ParseIntent ''))
Ok "parseIntent null -> null"      ($null -eq (ParseIntent $null))
Ok "parseIntent first-word wins"   ((ParseIntent 'fleet or finance') -eq 'fleet')

# ---- selectSources ----------------------------------------------------------
$sFleet = SelectSources 'fleet' @{}
Ok "fleet -> fleet on"             ($sFleet.fleet -eq $true)
Ok "fleet -> knowledge off"        ($sFleet.knowledge -eq $false)
Ok "fleet -> math off"            ($sFleet.math -eq $false)

$sKnow = SelectSources 'knowledge' @{}
Ok "knowledge -> knowledge on"     ($sKnow.knowledge -eq $true)
Ok "knowledge -> fleet off"        ($sKnow.fleet -eq $false)
Ok "knowledge -> entity on"        ($sKnow.entity -eq $true)

$sMath = SelectSources 'math' @{}
Ok "math -> math on"               ($sMath.math -eq $true)
Ok "math -> knowledge off"         ($sMath.knowledge -eq $false)
Ok "math -> entity off (lean)"     ($sMath.entity -eq $false)
Ok "math -> recall off (lean)"     ($sMath.recall -eq $false)

$sHybrid = SelectSources 'hybrid' @{}
Ok "hybrid -> all on (fleet)"      ($sHybrid.fleet -eq $true)
Ok "hybrid -> all on (knowledge)"  ($sHybrid.knowledge -eq $true)
Ok "hybrid -> all on (math)"       ($sHybrid.math -eq $true)

# unknown intent falls back to hybrid (== inject everything)
$sUnknown = SelectSources 'banana' @{}
Ok "unknown intent -> hybrid map"  ($sUnknown.fleet -eq $true -and $sUnknown.knowledge -eq $true)

# flag overrides force a source ON despite the classifier
$sOverrideFleet = SelectSources 'knowledge' @{ fleetLike = $true }
Ok "fleetLike override forces fleet" ($sOverrideFleet.fleet -eq $true)
$sOverrideFin = SelectSources 'general' @{ financeLike = $true }
Ok "financeLike forces finance"    ($sOverrideFin.finance -eq $true)
Ok "financeLike also forces fleet" ($sOverrideFin.fleet -eq $true)
$sOverrideMath = SelectSources 'general' @{ computeMode = $true }
Ok "computeMode forces math"       ($sOverrideMath.math -eq $true)
$sOverrideIngest = SelectSources 'math' @{ knowledgeIngestMode = $true }
Ok "ingestMode forces knowledge"   ($sOverrideIngest.knowledge -eq $true)

# ---- wordSet / jaccard ------------------------------------------------------
$wsA = WordSet 'Ibn Kathir describes the creation of the heavens'
Ok "wordSet drops stopwords"       (-not $wsA.ContainsKey('the'))
Ok "wordSet keeps content word"    ($wsA.ContainsKey('kathir'))
Ok "wordSet drops short tokens"    (-not (WordSet 'a to of').ContainsKey('to'))
Ok "jaccard identical = 1"         ((Jaccard (WordSet 'creation of heavens') (WordSet 'creation of heavens')) -eq 1.0)
Ok "jaccard disjoint = 0"          ((Jaccard (WordSet 'apple banana') (WordSet 'orange grape')) -eq 0.0)
Ok "jaccard empty both = 0"        ((Jaccard (WordSet '') (WordSet '')) -eq 0.0)
$jPartial = Jaccard (WordSet 'creation heavens earth') (WordSet 'creation heavens mountains')
Ok "jaccard partial in (0,1)"      ($jPartial -gt 0.0 -and $jPartial -lt 1.0)

# ---- mergeEvidence ----------------------------------------------------------
# two near-identical claims (one KG, one Memory) collapse to one
$kg1  = @(@{ content='The creation of the heavens took six days'; confidence=0.9 })
$mem1 = @(@{ content='creation of the heavens took six days'; confidence=0.4 })
$m1 = @(MergeEvidence $kg1 $mem1)   # @() guards PS single-element unwrap
Ok "merge collapses dup claim"     ($m1.Count -eq 1)
Ok "merge keeps higher-conf copy"  ([double]$m1[0].confidence -eq 0.9)
Ok "merge keeps KG source"         ($m1[0].source -eq 'KG')
Ok "merge marks merged=true"       ($m1[0].merged -eq $true)
Ok "merge records similarity"      ($null -ne $m1[0].similarity)

# distinct claims survive separately
$kg2  = @(@{ content='angels are made of light'; confidence=0.8 })
$mem2 = @(@{ content='the fleet did 4000 SAR last week'; confidence=0.5 })
$m2 = @(MergeEvidence $kg2 $mem2)
Ok "merge keeps distinct claims"   ($m2.Count -eq 2)

# string inputs split into rows
$m3 = @(MergeEvidence "claim one about jinn`nclaim two about angels" $null)
Ok "merge splits string rows"      ($m3.Count -eq 2)
Ok "merge empty inputs -> 0"       (@(MergeEvidence $null $null).Count -eq 0)

# lower-confidence dup does NOT overwrite the kept higher-confidence copy
$kgHi  = @(@{ content='zakat is two and a half percent'; confidence=0.95 })
$memLo = @(@{ content='zakat is two and a half percent'; confidence=0.30 })
$m4 = @(MergeEvidence $kgHi $memLo)
Ok "merge dup keeps best conf"     ([double]$m4[0].confidence -eq 0.95)

# ---- citationTag / confidenceNote / render ----------------------------------
Ok "tag KG with ref"               ((CitationTag 'KG' 'bn01') -eq '[KG: bn01]')
Ok "tag KG no ref"                 ((CitationTag 'KG' $null) -eq '[KG]')
Ok "tag Memory"                    ((CitationTag 'Memory' $null) -eq '[Memory]')
Ok "tag Entity"                    ((CitationTag 'Entity' $null) -eq '[Entity]')
Ok "tag Fleet"                     ((CitationTag 'Fleet' $null) -eq '[Fleet]')
Ok "confNote hedges below 0.75"    ((ConfidenceNote 0.72) -match 'supporting context')
Ok "confNote silent at/above 0.75" ((ConfidenceNote 0.80) -eq '')
Ok "confNote silent when null"     ((ConfidenceNote $null) -eq '')

# render produces tagged lines; a low-sim merged item carries the hedge
$kgR  = @(@{ content='the seven heavens are described in detail'; confidence=0.6 })
$memR = @(@{ content='seven heavens described detail somewhat differently here ok'; confidence=0.5 })
$rendered = RenderEvidenceBlock (MergeEvidence $kgR $memR -threshold 0.4)
Ok "render emits KG tag"           ($rendered -match '\[KG\]')
$renderSingle = RenderEvidenceBlock (MergeEvidence @(@{content='angels of light';confidence=0.7}) $null)
Ok "render single KG line"         ($renderSingle -match '^\[KG\] angels of light')
Ok "render empty -> empty string"  ((RenderEvidenceBlock (MergeEvidence $null $null)) -eq '')

# ---- summary ----------------------------------------------------------------
Write-Host ""
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed") -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
