# B-gen-extract-verify.ps1 -- General Extraction Mode ship gate.
# PS 5.1 mirror of the PURE logic added to lib/knowledge-intake.js:
#   deriveExtractionMode, selectExtractionSystem, generalTypeToKind,
#   parseExtractionOutput (general + math branches), and the extraction_mode
#   override in parseBookIngestMessage. No DB, no Gemini, no network. Pure ASCII.
#
# Why this build exists: the only extractor was math-specific, so non-math books
# (Islamic history, biography) returned 0 candidates. General mode normalizes a
# {label,content,type} item into the SAME candidate shape the math path emits
# (node_type in claim|entity, confidence in high|medium|low) so the nodes flow
# straight through populateGraph -- schema-free (m8_graph_nodes has no type col).

$pass = 0; $fail = 0

function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }
function CheckEq([string]$label, $expected, $actual) {
  CheckTrue ($label + " (exp=" + $expected + " got=" + $actual + ")") ($expected -eq $actual)
}

# Canonical value sets (mirror VALID_KIND / VALID_CONF in knowledge-intake.js)
$VALID_KIND = @("claim","entity")
$VALID_CONF = @("high","medium","low")

# Safe property read off a ConvertFrom-Json object: $null for a missing prop
# (mirrors JS reading an absent field as undefined).
function Prop($obj, [string]$name) {
  if ($null -eq $obj) { return $null }
  $p = $obj.PSObject.Properties[$name]
  if ($p) { return $p.Value }
  return $null
}

# ==== mirror: deriveExtractionMode(cls, explicitMode) =========================
function Derive-ExtractionMode($cls, $explicitMode) {
  $m = ([string]$explicitMode).Trim().ToLower()
  if ($m -eq "math")    { return "math" }
  if ($m -eq "general") { return "general" }
  if ($cls -eq "mathematical") { return "math" }
  return "general"
}

# ==== mirror: selectExtractionSystem(mode) ===================================
# Returns a TAG naming the chosen const (PS can't hold the JS string itself).
function Select-ExtractionSystem($mode) {
  if ($mode -eq "math") { return "EXTRACTION_SYSTEM" }
  return "GENERAL_EXTRACTION_SYSTEM"
}

# ==== mirror: generalTypeToKind(type) ========================================
function General-TypeToKind($type) {
  $t = ([string]$type).Trim().ToLower()
  if ($t -eq "person" -or $t -eq "place" -or $t -eq "concept") { return "entity" }
  return "claim"
}

# ==== mirror: parseJsonArrayLoose(raw) =======================================
# Tolerant array extraction: strips ```json fences, accepts a clean array, else
# salvages the first [ ... ] block out of surrounding prose. Returns the array
# text (or $null). Mirrors the JS fix for silent 0-extractions.
function Extract-ArrayText([string]$raw) {
  $s = ([string]$raw).Trim()
  if ([string]::IsNullOrEmpty($s)) { return $null }
  $m = [regex]::Match($s, '(?is)```(?:json)?\s*(.*?)```')
  if ($m.Success) { $s = $m.Groups[1].Value.Trim() }
  if ($s.StartsWith("[") -and $s.EndsWith("]")) { return $s }
  $start = $s.IndexOf("["); $end = $s.LastIndexOf("]")
  if ($start -ge 0 -and $end -gt $start) { return $s.Substring($start, $end - $start + 1) }
  return $null
}

# ==== mirror: parseExtractionOutput(raw, source_class, source_doc_id, mode) ===
# Emits one pscustomobject per accepted item. Callers wrap with @() for a
# reliable .Count (PS unrolls collections on output).
function Parse-ExtractionOutput([string]$raw, [string]$sourceClass, $sourceDocId, [string]$mode) {
  $arrText = Extract-ArrayText $raw
  if ($null -eq $arrText) { return }
  $arr = $null
  try { $arr = $arrText | ConvertFrom-Json } catch { return }
  if ($null -eq $arr) { return }
  foreach ($item in @($arr)) {
    if ($null -eq $item) { continue }
    $label = ([string](Prop $item 'label')).Trim()
    if ([string]::IsNullOrEmpty($label)) { continue }
    $content = [string](Prop $item 'content')
    if ([string]::IsNullOrEmpty($content)) { $content = $label }

    if ($mode -eq "general") {
      $kind = General-TypeToKind (Prop $item 'type')
      $conf = "high"
      $itemConf = ([string](Prop $item 'confidence')).ToLower()
      if ($VALID_CONF -contains $itemConf) { $conf = $itemConf }
      [pscustomobject]@{
        node_type = $kind; label = $label; content = $content
        extraction_confidence = $conf; source_class = $sourceClass; source_doc_id = $sourceDocId
      }
    } else {
      $nodeType = [string](Prop $item 'node_type')
      $conf     = [string](Prop $item 'confidence')
      if ($VALID_KIND -notcontains $nodeType) { continue }
      if ($VALID_CONF -notcontains $conf)     { continue }
      [pscustomobject]@{
        node_type = $nodeType; label = $label; content = $content
        extraction_confidence = $conf; source_class = $sourceClass; source_doc_id = $sourceDocId
      }
    }
  }
}

# ==== mirror: extraction_mode grab in parseBookIngestMessage =================
# Same grab() lookahead as the JS (comma / EOL / next-known-key delimited).
function Grab-Key([string]$key, [string]$text) {
  $re = [regex]("(?i)" + $key + "\s*[=:]\s*(.+?)(?=\s*(?:,|\n|$|\b(?:title|author|year|source_class|class)\s*[=:]))")
  $m = $re.Match($text)
  if ($m.Success) { return $m.Groups[1].Value.Trim().Trim('"').Trim("'") }
  return $null
}
function Parse-ExtractionModeFromCommand([string]$message) {
  $raw = Grab-Key "extraction_mode" $message
  if ($null -eq $raw) { $raw = Grab-Key "mode" $message }
  if (([string]$raw).ToLower() -eq "math") { return "math" }
  return "general"
}

# ============================================================================
# 1. mode selection from source_class (cls -> mode)
# ============================================================================
Write-Host "`n-- 1. deriveExtractionMode: cls -> mode --" -ForegroundColor Cyan
CheckEq "cls=mathematical -> math"  "math"    (Derive-ExtractionMode "mathematical" $null)
CheckEq "cls=established -> general" "general" (Derive-ExtractionMode "established"  $null)
CheckEq "cls=speculative -> general" "general" (Derive-ExtractionMode "speculative" $null)
CheckEq "cls=null -> general"        "general" (Derive-ExtractionMode $null          $null)
CheckEq "cls=unknown -> general"     "general" (Derive-ExtractionMode "biography"    $null)

Write-Host "`n-- 1b. deriveExtractionMode: explicit override wins over cls --" -ForegroundColor Cyan
CheckEq "explicit math beats established cls" "math"    (Derive-ExtractionMode "established"  "math")
CheckEq "explicit general beats math-ish cls" "general" (Derive-ExtractionMode "mathematical" "general")
CheckEq "explicit MATH (case-insens)"         "math"    (Derive-ExtractionMode "established"  "MATH")
CheckEq "garbage explicit falls back to cls"  "math"    (Derive-ExtractionMode "mathematical" "banana")
CheckEq "garbage explicit + est cls=general"  "general" (Derive-ExtractionMode "established"  "banana")

# ============================================================================
# 2. prompt selection (mode -> system prompt)
# ============================================================================
Write-Host "`n-- 2. selectExtractionSystem: mode -> prompt --" -ForegroundColor Cyan
CheckEq "math -> EXTRACTION_SYSTEM"        "EXTRACTION_SYSTEM"         (Select-ExtractionSystem "math")
CheckEq "general -> GENERAL_EXTRACTION_SYSTEM" "GENERAL_EXTRACTION_SYSTEM" (Select-ExtractionSystem "general")
CheckEq "default (null) -> GENERAL"        "GENERAL_EXTRACTION_SYSTEM" (Select-ExtractionSystem $null)
CheckEq "unknown mode -> GENERAL"          "GENERAL_EXTRACTION_SYSTEM" (Select-ExtractionSystem "xyz")

# ============================================================================
# 2b. generalTypeToKind mapping (general 'type' -> claim|entity)
# ============================================================================
Write-Host "`n-- 2b. generalTypeToKind: type -> kind --" -ForegroundColor Cyan
CheckEq "person -> entity"  "entity" (General-TypeToKind "person")
CheckEq "place -> entity"   "entity" (General-TypeToKind "place")
CheckEq "concept -> entity" "entity" (General-TypeToKind "concept")
CheckEq "fact -> claim"     "claim"  (General-TypeToKind "fact")
CheckEq "event -> claim"    "claim"  (General-TypeToKind "event")
CheckEq "date -> claim"     "claim"  (General-TypeToKind "date")
CheckEq "ruling -> claim"   "claim"  (General-TypeToKind "ruling")
CheckEq "missing -> claim"  "claim"  (General-TypeToKind $null)
CheckEq "PERSON case-insens -> entity" "entity" (General-TypeToKind "PERSON")

# ============================================================================
# 3. parseExtractionOutput, GENERAL mode (with + without type field)
# ============================================================================
Write-Host "`n-- 3. parseExtractionOutput (general): type field present --" -ForegroundColor Cyan
$g1 = @(Parse-ExtractionOutput '[{"label":"battle_of_badr","content":"The Battle of Badr occurred in 2 AH.","type":"event"}]' "established" 7 "general")
CheckEq "one candidate parsed"          1 $g1.Count
CheckEq "event type -> node_type claim" "claim" $g1[0].node_type
CheckEq "label preserved"               "battle_of_badr" $g1[0].label
CheckEq "content preserved"             "The Battle of Badr occurred in 2 AH." $g1[0].content
CheckEq "default confidence high"       "high" $g1[0].extraction_confidence
CheckEq "source_class threaded"         "established" $g1[0].source_class
CheckEq "source_doc_id threaded"        7 $g1[0].source_doc_id

Write-Host "`n-- 3b. parseExtractionOutput (general): person type -> entity --" -ForegroundColor Cyan
$g2 = @(Parse-ExtractionOutput '[{"label":"ibn_kathir","content":"Ibn Kathir was a historian.","type":"person"}]' "established" 7 "general")
CheckEq "person -> entity node_type" "entity" $g2[0].node_type

Write-Host "`n-- 3c. parseExtractionOutput (general): type MISSING still parses --" -ForegroundColor Cyan
$g3 = @(Parse-ExtractionOutput '[{"label":"some_fact","content":"A self-contained claim."}]' "established" 9 "general")
CheckEq "still one candidate"           1 $g3.Count
CheckEq "no type -> default claim"      "claim" $g3[0].node_type
CheckEq "label parsed without type"     "some_fact" $g3[0].label
CheckEq "content parsed without type"   "A self-contained claim." $g3[0].content

Write-Host "`n-- 3d. parseExtractionOutput (general): content missing -> falls back to label --" -ForegroundColor Cyan
$g4 = @(Parse-ExtractionOutput '[{"label":"hijra_year","type":"date"}]' "established" 9 "general")
CheckEq "label-only item still parses" 1 $g4.Count
CheckEq "content defaults to label"    "hijra_year" $g4[0].content

Write-Host "`n-- 3e. parseExtractionOutput (general): empty label dropped --" -ForegroundColor Cyan
$g5 = @(Parse-ExtractionOutput '[{"label":"  ","content":"x","type":"fact"},{"label":"good_one","content":"y","type":"fact"}]' "established" 9 "general")
CheckEq "blank-label item dropped, good kept" 1 $g5.Count
CheckEq "kept the good one" "good_one" $g5[0].label

Write-Host "`n-- 3f. CRUX: every general candidate is populateGraph-compatible --" -ForegroundColor Cyan
$gc = @(Parse-ExtractionOutput '[{"label":"a","content":"x","type":"event"},{"label":"b","content":"y","type":"person"},{"label":"c","content":"z","type":"ruling"},{"label":"d","content":"w"}]' "established" 3 "general")
CheckEq "all four parsed" 4 $gc.Count
$kindOk = $true; $confOk = $true
foreach ($c in $gc) {
  if ($VALID_KIND -notcontains $c.node_type) { $kindOk = $false }
  if ($VALID_CONF -notcontains $c.extraction_confidence) { $confOk = $false }
}
CheckTrue "every node_type in VALID_KIND (claim|entity)" $kindOk
CheckTrue "every confidence in VALID_CONF (writable)"    $confOk

# ============================================================================
# 4. parseExtractionOutput, MATH mode (existing shape still parses + strict)
# ============================================================================
Write-Host "`n-- 4. parseExtractionOutput (math): existing shape parses --" -ForegroundColor Cyan
$m1 = @(Parse-ExtractionOutput '[{"node_type":"claim","label":"collatz_stops","content":"All tested n reach 1.","confidence":"high"}]' "established" 5 "math")
CheckEq "math item parsed"        1 $m1.Count
CheckEq "math node_type kept"     "claim" $m1[0].node_type
CheckEq "math confidence kept"    "high" $m1[0].extraction_confidence

Write-Host "`n-- 4b. parseExtractionOutput (math): strict filter drops bad shapes --" -ForegroundColor Cyan
$m2 = @(Parse-ExtractionOutput '[{"label":"no_kind","content":"x","type":"event"}]' "established" 5 "math")
CheckEq "general-shaped item rejected by math mode" 0 $m2.Count
$m3 = @(Parse-ExtractionOutput '[{"node_type":"claim","label":"no_conf","content":"x"}]' "established" 5 "math")
CheckEq "math item missing confidence dropped"      0 $m3.Count
$m4 = @(Parse-ExtractionOutput '[{"node_type":"banana","label":"bad_kind","content":"x","confidence":"high"}]' "established" 5 "math")
CheckEq "math item with invalid node_type dropped"  0 $m4.Count

Write-Host "`n-- 4c. parseExtractionOutput: non-array + empty inputs -> 0 --" -ForegroundColor Cyan
$n1 = @(Parse-ExtractionOutput '{"label":"x","content":"y","type":"fact"}' "established" 1 "general")
CheckEq "single object (non-array) rejected" 0 $n1.Count
$n2 = @(Parse-ExtractionOutput "" "established" 1 "general")
CheckEq "empty raw -> 0" 0 $n2.Count
$n3 = @(Parse-ExtractionOutput "not json at all" "established" 1 "general")
CheckEq "garbage -> 0"   0 $n3.Count

# ============================================================================
# 4d. THE FIX: tolerant parsing of prose-wrapped / fenced LLM output
# ============================================================================
Write-Host "`n-- 4d. parseJsonArrayLoose: wrapped/fenced output now parses --" -ForegroundColor Cyan
# Array wrapped in stray prose (a provider ignoring 'JSON only') used to yield 0.
$w1 = @(Parse-ExtractionOutput 'Here are the items you asked for: [{"label":"a","content":"x","type":"fact"}] Hope this helps!' "established" 1 "general")
CheckEq "prose-wrapped array now parses (was 0)" 1 $w1.Count
CheckEq "wrapped item maps correctly" "claim" $w1[0].node_type
# Fenced block (single-quoted to keep the backticks literal -- no PS escaping)
$w2 = @(Parse-ExtractionOutput '```json[{"label":"b","content":"y","type":"person"}]```' "established" 1 "general")
CheckEq "fenced array parses"     1 $w2.Count
CheckEq "fenced person -> entity" "entity" $w2[0].node_type
# Two items wrapped in prose, math mode (strict shape) still salvaged from prose
$w3 = @(Parse-ExtractionOutput 'Sure: [{"node_type":"claim","label":"c","content":"z","confidence":"high"},{"node_type":"entity","label":"d","content":"w","confidence":"medium"}]' "established" 1 "math")
CheckEq "wrapped math array salvaged (2 items)" 2 $w3.Count
# Extract-ArrayText edge cases
CheckEq "clean array passes through" '[{"label":"a"}]' (Extract-ArrayText '[{"label":"a"}]')
CheckTrue "no-bracket text -> null" ($null -eq (Extract-ArrayText "no brackets here"))

# ============================================================================
# 5. extraction_mode override in the book command parser
# ============================================================================
Write-Host "`n-- 5. parseBookIngestMessage extraction_mode override --" -ForegroundColor Cyan
CheckEq "extraction_mode=math parsed" "math" `
  (Parse-ExtractionModeFromCommand "ingest this as a book: title=Test Book, source_class=established, extraction_mode=math")
CheckEq "no extraction_mode -> general default" "general" `
  (Parse-ExtractionModeFromCommand "ingest this as a book: title=Test Book, source_class=established")
CheckEq "bare mode=math alias parsed" "math" `
  (Parse-ExtractionModeFromCommand "ingest this as a book: title=X, source_class=established, mode=math")
CheckEq "extraction_mode=general explicit" "general" `
  (Parse-ExtractionModeFromCommand "ingest this as a book: title=X, source_class=established, extraction_mode=general")
CheckEq "extraction_mode=MATH case-insensitive" "math" `
  (Parse-ExtractionModeFromCommand "title=X, source_class=established, extraction_mode=MATH")
# Guard: adding extraction_mode parsing must NOT corrupt source_class extraction.
Write-Host "`n-- 5b. extraction_mode does not swallow neighbouring fields --" -ForegroundColor Cyan
$clsRe = [regex]'(?i)source_class\s*[=:]\s*(.+?)(?=\s*(?:,|\n|$|\b(?:title|author|year|source_class|class)\s*[=:]))'
$cm = $clsRe.Match("ingest this as a book: title=Test Book, source_class=established, extraction_mode=math")
CheckEq "source_class still parses cleanly next to extraction_mode" "established" ($cm.Groups[1].Value.Trim())

# ============================================================================
# 6. extractConceptsWithStatus quota path is preserved WITH a mode param
# ============================================================================
# The mode param only selects the prompt/parser; the quota-break semantics are
# unchanged. Mirror: a quota error still stops the loop regardless of mode.
function IsGeminiQuotaError([string]$msg) {
  $x = $msg.ToLower()
  return ($x.Contains("429") -or $x.Contains("resource_exhausted") -or `
          $x.Contains("quota_exceeded") -or $x.Contains("rate limit") -or `
          $x.Contains("too many requests"))
}
function ExtractWithStatusMirror([object[]]$chunkResults, [string]$mode) {
  $candidates = [System.Collections.Generic.List[string]]::new()
  $quota = $false
  # mode is threaded but does not change loop control -- assert that invariant.
  foreach ($r in $chunkResults) {
    if ($r.error) {
      if (IsGeminiQuotaError $r.error) { $quota = $true; break }
      continue
    }
    $candidates.Add($r.raw)
  }
  return [pscustomobject]@{ candidates = $candidates; quota_exhausted = $quota; mode = $mode }
}
Write-Host "`n-- 6. quota path intact with mode param --" -ForegroundColor Cyan
$q = ExtractWithStatusMirror @(
  @{ error=""; raw="n1" },
  @{ error="429 resource_exhausted"; raw="" },
  @{ error=""; raw="n2" }
) "general"
CheckTrue "quota_exhausted true (general mode)" $q.quota_exhausted
CheckEq   "stopped before post-quota chunk"     1 $q.candidates.Count
CheckEq   "mode threaded through"               "general" $q.mode
$qm = ExtractWithStatusMirror @( @{ error=""; raw="a" }, @{ error=""; raw="b" } ) "math"
CheckFalse "no quota -> false (math mode)" $qm.quota_exhausted
CheckEq    "both chunks collected (math)"  2 $qm.candidates.Count

# ============================================================================
# 7. ingestBookText mode derivation (cls -> mode at the book level)
# ============================================================================
Write-Host "`n-- 7. ingestBookText derives mode from cls --" -ForegroundColor Cyan
# ingestBookText calls deriveExtractionMode(cls, extraction_mode) once, then
# threads it to every chapter's extractConceptsWithStatus call.
CheckEq "book cls=established -> general extraction" "general" (Derive-ExtractionMode "established" $null)
CheckEq "book cls=speculative -> general extraction" "general" (Derive-ExtractionMode "speculative" $null)
CheckEq "book cls=mathematical -> math extraction"   "math"    (Derive-ExtractionMode "mathematical" $null)
CheckEq "book explicit extraction_mode=math wins"    "math"    (Derive-ExtractionMode "established" "math")

Write-Host "`n================ B-GEN-EXTRACT RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
