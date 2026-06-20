# tests/B85c-reflector-verify.ps1
# PS-mirror of lib/reflector.js pure logic (Build-85c: Self-Reflection Loop).
# No local Node on this box -> verify the deterministic pieces via a faithful
# PowerShell port: buildReflectPrompt, buildRewritePrompt, parseScore (fenced /
# unquoted-key / garbage tolerant, relevance clamp), normalizeScore, issuesFromScore,
# stripUnverified, addMissedSourceNote, applyLightFixes, truncate. Plus static
# assertions that orchestrator.js wires the Build-85c block + gate, and the
# migration creates the table/index. Pure ASCII (PS 5.1 reads no-BOM as ANSI).

$script:pass = 0
$script:fail = 0
function Ok($name, $cond) {
  if ($cond) { $script:pass++; Write-Host ("PASS  " + $name) -ForegroundColor Green }
  else       { $script:fail++; Write-Host ("FAIL  " + $name) -ForegroundColor Red }
}

# ---- mirrored constants -----------------------------------------------------
$MISSED_SOURCE_NOTE = "Note: additional context may exist in knowledge base"
$UNVERIFIED_TAG     = "[unverified]"
$Q_CAP = 1000; $A_CAP = 4000; $S_CAP = 2000

# ---- pure-logic port --------------------------------------------------------
function Truncate($s, $n) {
  if ($null -eq $s) { $s = "" } else { $s = [string]$s }
  if ($s.Length -gt $n) { return $s.Substring(0, $n) }
  return $s
}

function BuildReflectPrompt($question, $answer, $sourcesUsed) {
  return (@(
    "Score this answer on 3 axes. Return JSON only:",
    "{relevance: 1-5, overclaim: true/false, missed_source: true/false}",
    ("Question: " + (Truncate $question $Q_CAP)),
    ("Answer: " + (Truncate $answer $A_CAP)),
    ("Sources used: " + (Truncate $sourcesUsed $S_CAP))
  ) -join "`n")
}

function BuildRewritePrompt($question, $answer, $issues) {
  $issueText = ""
  if ($issues -is [array]) { $issueText = ($issues -join "; ") }
  elseif ($null -ne $issues) { $issueText = [string]$issues }
  return ("Rewrite this answer fixing these issues: " + $issueText + ". " +
          "Keep the same facts, improve accuracy and sourcing. " +
          "Question: " + (Truncate $question $Q_CAP) + ". " +
          "Original: " + (Truncate $answer $A_CAP))
}

function NormalizeScore($obj) {
  if ($null -eq $obj) { return $null }
  $rel = 3
  if ($obj.ContainsKey('relevance')) {
    $parsed = 0
    if ([int]::TryParse([string]$obj['relevance'], [ref]$parsed)) { $rel = $parsed }
  }
  if ($rel -lt 1) { $rel = 1 }
  if ($rel -gt 5) { $rel = 5 }
  $truthy = {
    param($v)
    return ($v -eq $true -or $v -eq 'true' -or $v -eq 1 -or $v -eq '1')
  }
  return @{
    relevance     = $rel
    overclaim     = (& $truthy $obj['overclaim'])
    missed_source = (& $truthy $obj['missed_source'])
  }
}

# Faithful port of parseScore: strip fences, grab first {...}, parse (tolerating
# unquoted keys), normalize. Returns $null on garbage.
function ParseScore($raw) {
  if ($null -eq $raw) { return $null }
  $text = ([string]$raw).Trim()
  if ($text.Length -eq 0) { return $null }
  $text = ($text -replace '(?i)```json', '') -replace '```', ''
  $text = $text.Trim()
  $m = [regex]::Match($text, '\{[\s\S]*\}')
  if (-not $m.Success) { return $null }
  $json = $m.Value
  # quote bare keys: ([{,] ws) key : -> ... "key":
  $fixed = [regex]::Replace($json, '([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:', '$1"$2":')
  $obj = $null
  try {
    $parsed = $fixed | ConvertFrom-Json -ErrorAction Stop
    $obj = @{}
    foreach ($p in $parsed.PSObject.Properties) { $obj[$p.Name] = $p.Value }
  } catch {
    return $null
  }
  return (NormalizeScore $obj)
}

function IssuesFromScore($score) {
  $issues = @()
  if ($null -eq $score) { return $issues }
  if ($score['relevance'] -lt 3) { $issues += "the answer does not directly address the question" }
  if ($score['overclaim'])       { $issues += "the answer overclaims - states unverified things as established fact" }
  if ($score['missed_source'])   { $issues += "the answer may have missed relevant context in the knowledge base" }
  return ,$issues
}

function StripUnverified($answer) {
  if ($null -eq $answer) { $answer = "" }
  $a = ([string]$answer).Trim()
  if ($a.Length -eq 0) { return $a }
  if ($a.IndexOf($UNVERIFIED_TAG) -eq 0) { return $a }
  return ($UNVERIFIED_TAG + " " + $a)
}

function AddMissedSourceNote($answer) {
  if ($null -eq $answer) { $answer = "" }
  $a = [string]$answer
  if ($a.IndexOf($MISSED_SOURCE_NOTE) -ne -1) { return $a }
  return (($a -replace '\s+$', '') + "`n`n" + $MISSED_SOURCE_NOTE)
}

# Returns $null when nothing changed (caller keeps original byte-for-byte).
function ApplyLightFixes($answer, $score) {
  $out = $answer
  $changed = $false
  if ($null -ne $score -and $score['overclaim'])     { $out = StripUnverified $out;     $changed = $true }
  if ($null -ne $score -and $score['missed_source']) { $out = AddMissedSourceNote $out; $changed = $true }
  if ($changed) { return $out }
  return $null
}

Write-Host "`n=== B85c Reflector ===" -ForegroundColor Cyan

# ---- truncate ---------------------------------------------------------------
Ok "truncate null -> empty"        ((Truncate $null 5) -eq "")
Ok "truncate under cap unchanged"  ((Truncate "hello" 10) -eq "hello")
Ok "truncate over cap clips"       ((Truncate "0123456789" 4) -eq "0123")

# ---- buildReflectPrompt -----------------------------------------------------
$rp = BuildReflectPrompt "what is X?" "X is a thing" "KG | 2 memory rows"
Ok "reflect prompt has 3-axes line"   ($rp -match 'Score this answer on 3 axes')
Ok "reflect prompt JSON-only"         ($rp -match 'Return JSON only')
Ok "reflect prompt lists relevance"   ($rp -match 'relevance: 1-5')
Ok "reflect prompt lists overclaim"   ($rp -match 'overclaim: true/false')
Ok "reflect prompt lists missed_src"  ($rp -match 'missed_source: true/false')
Ok "reflect prompt embeds question"   ($rp -match 'Question: what is X\?')
Ok "reflect prompt embeds answer"     ($rp -match 'Answer: X is a thing')
Ok "reflect prompt embeds sources"    ($rp -match 'Sources used: KG \| 2 memory rows')

# ---- buildRewritePrompt -----------------------------------------------------
$wp = BuildRewritePrompt "what is X?" "X is a thing" @("issue one","issue two")
Ok "rewrite prompt fix preamble"   ($wp -match 'Rewrite this answer fixing these issues:')
Ok "rewrite prompt joins issues"   ($wp -match 'issue one; issue two')
Ok "rewrite prompt keep-facts"     ($wp -match 'Keep the same facts')
Ok "rewrite prompt embeds Q"       ($wp -match 'Question: what is X\?')
Ok "rewrite prompt embeds original"($wp -match 'Original: X is a thing')

# ---- normalizeScore / parseScore --------------------------------------------
$s1 = ParseScore '{"relevance": 4, "overclaim": false, "missed_source": true}'
Ok "parse clean JSON relevance"    ($s1['relevance'] -eq 4)
Ok "parse clean JSON overclaim"    ($s1['overclaim'] -eq $false)
Ok "parse clean JSON missed_src"   ($s1['missed_source'] -eq $true)

# fenced JSON (build the ```json ... ``` wrapper without backtick-quoting hell)
$nl = "`n"
$fence = ([char]0x60).ToString() * 3
$s2input = $fence + 'json' + $nl + '{"relevance": 2, "overclaim": true, "missed_source": false}' + $nl + $fence
$s2 = ParseScore $s2input
Ok "parse fenced JSON relevance"   ($s2['relevance'] -eq 2)
Ok "parse fenced JSON overclaim"   ($s2['overclaim'] -eq $true)

# unquoted keys (mirrors the prompt's own example shape)
$s3 = ParseScore '{relevance: 5, overclaim: false, missed_source: false}'
Ok "parse unquoted-key relevance"  ($s3['relevance'] -eq 5)
Ok "parse unquoted-key overclaim"  ($s3['overclaim'] -eq $false)

# relevance clamp + prose around JSON
$s4 = ParseScore 'Here is the score: {"relevance": 9, "overclaim": false, "missed_source": false} done'
Ok "parse clamps relevance to 5"   ($s4['relevance'] -eq 5)
$s5 = ParseScore '{"relevance": 0, "overclaim": false, "missed_source": false}'
Ok "parse clamps relevance to 1"   ($s5['relevance'] -eq 1)

# missing relevance -> neutral 3 (no rewrite)
$s6 = ParseScore '{"overclaim": true, "missed_source": false}'
Ok "missing relevance -> 3"        ($s6['relevance'] -eq 3)

# garbage / empty / null -> null
Ok "parse garbage -> null"         ($null -eq (ParseScore 'no json here at all'))
Ok "parse empty -> null"           ($null -eq (ParseScore ''))
Ok "parse null -> null"            ($null -eq (ParseScore $null))

# string 'true' coerces to boolean true
$s7 = ParseScore '{"relevance": 3, "overclaim": "true", "missed_source": "false"}'
Ok "string true coerces"           ($s7['overclaim'] -eq $true)
Ok "string false coerces"          ($s7['missed_source'] -eq $false)

# ---- issuesFromScore --------------------------------------------------------
$iLow = IssuesFromScore @{ relevance=2; overclaim=$false; missed_source=$false }
Ok "low relevance -> 1 issue"      ($iLow.Count -eq 1)
Ok "low relevance issue text"      ($iLow[0] -match 'does not directly address')
$iAll = IssuesFromScore @{ relevance=1; overclaim=$true; missed_source=$true }
Ok "all-bad -> 3 issues"           ($iAll.Count -eq 3)
$iClean = IssuesFromScore @{ relevance=5; overclaim=$false; missed_source=$false }
Ok "clean -> 0 issues"             ($iClean.Count -eq 0)
$iOver = IssuesFromScore @{ relevance=4; overclaim=$true; missed_source=$false }
Ok "overclaim-only -> 1 issue"     ($iOver.Count -eq 1)
Ok "overclaim issue text"          ($iOver[0] -match 'overclaims')

# ---- stripUnverified --------------------------------------------------------
Ok "strip wraps with tag"          ((StripUnverified "this is a claim") -eq "[unverified] this is a claim")
Ok "strip idempotent"              ((StripUnverified "[unverified] x") -eq "[unverified] x")
Ok "strip empty stays empty"       ((StripUnverified "") -eq "")

# ---- addMissedSourceNote ----------------------------------------------------
$an = AddMissedSourceNote "the answer body"
Ok "note appended"                 ($an -match 'Note: additional context may exist in knowledge base')
Ok "note starts with body"         ($an.StartsWith("the answer body"))
Ok "note idempotent"               ((AddMissedSourceNote $an) -eq $an)

# ---- applyLightFixes --------------------------------------------------------
Ok "clean score -> null (no change)" ($null -eq (ApplyLightFixes "body" @{ relevance=5; overclaim=$false; missed_source=$false }))
$lf1 = ApplyLightFixes "body" @{ relevance=4; overclaim=$true; missed_source=$false }
Ok "overclaim -> tagged"           ($lf1 -eq "[unverified] body")
$lf2 = ApplyLightFixes "body" @{ relevance=4; overclaim=$false; missed_source=$true }
Ok "missed_source -> note"         ($lf2 -match 'additional context may exist')
$lf3 = ApplyLightFixes "body" @{ relevance=4; overclaim=$true; missed_source=$true }
Ok "both -> tag AND note"          (($lf3 -match '^\[unverified\]') -and ($lf3 -match 'additional context may exist'))

# ---- static wiring assertions (orchestrator + migration + module) -----------
$root = Split-Path -Parent $PSScriptRoot
$orch = Get-Content (Join-Path $root 'lib\orchestrator.js') -Raw
Ok "orchestrator has START marker"   ($orch -match 'BUILD-85c START')
Ok "orchestrator has END marker"     ($orch -match 'BUILD-85c END')
Ok "orchestrator requires reflector" ($orch -match 'require\(.{1,3}\./reflector')
Ok "orchestrator calls reflect"      ($orch -match 'await reflect\(')
Ok "orchestrator gates on response"  ($orch -match 'reflectEligible')
Ok "gate excludes fleet"             ($orch -match '!fleetCtx\.text')
Ok "gate excludes finance"           ($orch -match '!financeCtx\.text')
Ok "gate excludes compute"           ($orch -match '!computeMode')
Ok "reflect uses effectiveMessage"   ($orch -match 'reflect\(effectiveMessage')
Ok "applies revised to response"     ($orch -match 'response = reflected\.revised')

$refl = Get-Content (Join-Path $root 'lib\reflector.js') -Raw
Ok "reflector exports reflect"       ($refl -match 'reflect,')
Ok "reflector exports rewrite"       ($refl -match 'rewrite,')
Ok "reflector exports logReflection" ($refl -match 'logReflection,')
Ok "reflector names gemini-2.5-flash"($refl -match 'gemini-2\.5-flash')
Ok "reflector score maxTokens 150"   ($refl -match 'maxOutputTokens: 150')
Ok "reflector rewrite maxTokens 500" ($refl -match 'maxOutputTokens: 500')
Ok "reflector score temp 0"          ($refl -match 'temperature: 0,')
Ok "reflector 2s budget default"     ($refl -match '"2000"')
Ok "logReflection fire-and-forget"   ($refl -match 'm8_reflections')

$mig = Get-Content (Join-Path $root 'migrations\B85c_reflections.sql') -Raw
Ok "migration creates table"         ($mig -match 'CREATE TABLE IF NOT EXISTS m8_reflections')
Ok "migration has relevance_score"   ($mig -match 'relevance_score int')
Ok "migration has overclaim_flag"    ($mig -match 'overclaim_flag boolean')
Ok "migration has missed_source"     ($mig -match 'missed_source_flag boolean')
Ok "migration has was_rewritten"     ($mig -match 'was_rewritten boolean')
Ok "migration indexes session_id"    ($mig -match 'INDEX.*m8_reflections\(session_id\)')

# ---- summary ----------------------------------------------------------------
Write-Host ""
Write-Host ("RESULT: " + $script:pass + " passed, " + $script:fail + " failed") -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
