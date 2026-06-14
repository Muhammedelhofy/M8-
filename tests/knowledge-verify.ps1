# knowledge-verify.ps1 -- Build-27 ship gate: PS mirror of pure-logic functions
# in lib/knowledge-intake.js. No DB, no Gemini calls.
# Pure ASCII (no-BOM .ps1 -> PS 5.1 ANSI). Keep ALL comments ASCII only.

$pass = 0; $fail = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }

# ==== mirrors of lib/knowledge-intake.js pure helpers ========================

$CHUNK_WORDS = 2000
$MAX_CHUNKS  = 8
$VALID_CLASS = @('established','speculative','fringe')
$VALID_CONF  = @('high','medium','low')
$VALID_KIND  = @('claim','entity')
$INGEST_RE   = [regex]'(?i)\b(?:ingest|add\s+(?:this\s+)?(?:paper|document|text|article|result|source)|import\s+(?:this\s+)?(?:paper|document|text|article))\b'
$CLASS_RE    = [regex]'(?i)\b(established|speculative|fringe)\b'

function ChunkText([string]$text) {
  $words  = ($text.Trim() -split '\s+')
  $chunks = [System.Collections.Generic.List[string]]::new()
  $i = 0
  while ($i -lt $words.Count -and $chunks.Count -lt $MAX_CHUNKS) {
    $end = [Math]::Min($i + $CHUNK_WORDS - 1, $words.Count - 1)
    $chunks.Add(($words[$i..$end]) -join ' ')
    $i += $CHUNK_WORDS
  }
  return ,$chunks
}

function ParseExtractionOutput([string]$raw, [string]$source_class, [int]$source_doc_id) {
  if (-not $raw) { return ,@() }
  try {
    $cleaned = ($raw -replace '(?m)^```(?:json)?\r?\n?|```$', '').Trim()
    $arr = $cleaned | ConvertFrom-Json
    if ($null -eq $arr) { return ,@() }
    $result = @()
    foreach ($item in @($arr)) {
      if (-not ($item.node_type -in $VALID_KIND))  { continue }
      if (-not ($item.label -is [string]) -or (-not $item.label.Trim())) { continue }
      if (-not ($item.confidence -in $VALID_CONF)) { continue }
      $lbl = $item.label.Trim()
      $lbl = $lbl.Substring(0, [Math]::Min(120, $lbl.Length))
      $cnt = if ($item.content) { [string]$item.content } else { $item.label.Trim() }
      $cnt = $cnt.Substring(0, [Math]::Min(300, $cnt.Length))
      $result += [pscustomobject]@{
        node_type             = $item.node_type
        label                 = $lbl
        content               = $cnt
        extraction_confidence = $item.confidence
        source_class          = $source_class
        source_doc_id         = $source_doc_id
      }
    }
    return ,$result
  } catch { return ,@() }
}

function DetectKnowledgeIngest([string]$message) {
  $s = $message.Trim()
  if ($s.Length -lt 10) { return $false }
  return $INGEST_RE.IsMatch($s)
}

function ParseIngestMessage([string]$message) {
  $classMatch   = $CLASS_RE.Match($message)
  $source_class = if ($classMatch.Success) { $classMatch.Groups[1].Value.ToLower() } else { $null }
  $raw_text     = $message
  if ($classMatch.Success) {
    $after = $message.Substring($classMatch.Index + $classMatch.Length) -replace '^[\s:\-]+', ''
    if ($after.Length -gt 20) { $raw_text = $after }
  } else {
    $raw_text = ($INGEST_RE.Replace($message, '') -replace '^[\s:\-]+', '').Trim()
  }
  $firstSentence = ($raw_text -split '[.!?\r\n]')[0].Trim()
  $spaceIdx = $firstSentence.LastIndexOf(' ', [Math]::Min(100, $firstSentence.Length - 1))
  $cutAt = if ($firstSentence.Length -gt 100) {
    if ($spaceIdx -gt 0) { $spaceIdx } else { 100 }
  } else { $firstSentence.Length }
  $title = if ($cutAt -gt 8) {
    $firstSentence.Substring(0, $cutAt)
  } else { 'Untitled document' }
  return [pscustomobject]@{ source_class = $source_class; raw_text = $raw_text.Trim(); title = $title }
}

function BuildClarificationSummary($candidates, [string]$title) {
  $high   = @($candidates | Where-Object { $_.extraction_confidence -eq 'high' })
  $medium = @($candidates | Where-Object { $_.extraction_confidence -eq 'medium' })
  $low    = @($candidates | Where-Object { $_.extraction_confidence -eq 'low' })
  return @(
    "Extracted $($candidates.Count) candidate nodes from `"$title`":"
    "  * $($high.Count) high-confidence -> ready to add"
    "  * $($medium.Count) medium-confidence -> review recommended"
    "  * $($low.Count) low-confidence -> HOLD (needs your call)"
  ) -join "`n"
}

# ==== test data (use @'...'@ single-quoted heredocs for JSON) ================

$validJson = @'
[{"node_type":"claim","label":"Terras density result","content":"Almost all n reduce.","confidence":"high"},
 {"node_type":"entity","label":"Terras","content":"Author of the 1976 paper.","confidence":"medium"}]
'@

$theoremJson = @'
[{"node_type":"theorem","label":"Collatz proven","content":"QED.","confidence":"high"}]
'@

$badConfJson = @'
[{"node_type":"claim","label":"test","content":"x","confidence":"certain"}]
'@

$specJson = @'
[{"node_type":"claim","label":"Attractor claim","content":"A periodic orbit may exist.","confidence":"high"}]
'@

# Build dynamic JSON with string concatenation (no curly-brace issues in PS 5.1)
$longLabel200   = 'A' * 200
$longLabelPart1 = '[{"node_type":"claim","label":"'
$longLabelPart2 = '","content":"x","confidence":"high"}]'
$longLabelJson  = $longLabelPart1 + $longLabel200 + $longLabelPart2

$longContent400  = 'C' * 400
$longContentPart1 = '[{"node_type":"claim","label":"test","content":"'
$longContentPart2 = '","confidence":"high"}]'
$longContentJson  = $longContentPart1 + $longContent400 + $longContentPart2

# ==== Tests ==================================================================
Write-Host ""
Write-Host "Build-27 knowledge-verify.ps1" -ForegroundColor Cyan

# T01-T04: chunkText
$c100 = ChunkText (('word ' * 100).Trim())
CheckTrue 'T01 100-word text => 1 chunk'           ($c100.Count -eq 1)
CheckTrue 'T02 chunk contains all 100 words'       ($c100[0].Split(' ').Count -eq 100)

$c4500 = ChunkText (('word ' * 4500).Trim())
CheckTrue 'T03 4500 words => 3 chunks'             ($c4500.Count -eq 3)

$cCapped = ChunkText (('word ' * 20000).Trim())
CheckTrue 'T04 20000 words capped at MAX_CHUNKS=8' ($cCapped.Count -eq 8)

# T05-T08: parseExtractionOutput -- valid JSON
$parsed = ParseExtractionOutput $validJson 'established' 1
CheckTrue 'T05 valid JSON parses 2 items'          ($parsed.Count -eq 2)
CheckTrue 'T06 source_class inherited'             ($parsed[0].source_class -eq 'established')
CheckTrue 'T07 source_doc_id set'                  ($parsed[0].source_doc_id -eq 1)
CheckTrue 'T08 confidence preserved'               ($parsed[1].extraction_confidence -eq 'medium')

# T09: theorem honesty invariant
$theoremParsed = ParseExtractionOutput $theoremJson 'established' 1
CheckTrue 'T09 theorem node_type rejected (honesty invariant)' ($theoremParsed.Count -eq 0)

# T10: bad confidence filtered
$badConf = ParseExtractionOutput $badConfJson 'established' 1
CheckTrue 'T10 unknown confidence value filtered'  ($badConf.Count -eq 0)

# T11: label truncated at 120
$longParsed = ParseExtractionOutput $longLabelJson 'established' 1
CheckTrue 'T11 label truncated to 120 chars'       ($longParsed[0].label.Length -eq 120)

# T12: content truncated at 300
$contentParsed = ParseExtractionOutput $longContentJson 'established' 1
CheckTrue 'T12 content truncated to 300 chars'     ($contentParsed[0].content.Length -eq 300)

# T13: empty returns empty
CheckTrue 'T13 empty raw => empty array'           ((ParseExtractionOutput '' 'established' 1).Count -eq 0)

# T14: invalid JSON returns empty (no throw)
CheckTrue 'T14 invalid JSON => empty array'        ((ParseExtractionOutput 'not json' 'established' 1).Count -eq 0)

# T15: speculative source_class preserved
$specParsed = ParseExtractionOutput $specJson 'speculative' 99
CheckTrue 'T15 speculative source_class preserved' ($specParsed[0].source_class -eq 'speculative')

# T16-T21: detectKnowledgeIngest positive
CheckTrue 'T16 detect: ingest this as established' (DetectKnowledgeIngest 'ingest this as established: Terras 1976 showed...')
CheckTrue 'T17 detect: add this paper'             (DetectKnowledgeIngest 'add this paper speculative: ...')
CheckTrue 'T18 detect: add this document'          (DetectKnowledgeIngest 'add this document as fringe: ...')
CheckTrue 'T19 detect: import this paper'          (DetectKnowledgeIngest 'import this paper as established: ...')
CheckTrue 'T20 detect: add this text'              (DetectKnowledgeIngest 'add this text as speculative: some content here')
CheckTrue 'T21 detect: add this source'            (DetectKnowledgeIngest 'add this source established: something longer')

# T22-T24: detectKnowledgeIngest negative
CheckFalse 'T22 no-detect: short message'          (DetectKnowledgeIngest 'hi')
CheckFalse 'T23 no-detect: fleet question'         (DetectKnowledgeIngest 'what did Ali earn this week?')
CheckFalse 'T24 no-detect: notebook write'         (DetectKnowledgeIngest 'notebook: the stopping time is always finite')

# T25-T29: parseIngestMessage
$p1 = ParseIngestMessage 'ingest this as established: Terras (1976) showed that almost all n reduce.'
CheckTrue 'T25 source_class: established'          ($p1.source_class -eq 'established')
CheckTrue 'T26 raw_text contains paper content'    ($p1.raw_text -match 'Terras')
CheckTrue 'T27 title from first sentence'          ($p1.title -match 'Terras')

$p2 = ParseIngestMessage 'add this paper speculative: The hidden attractor conjecture proposes a periodic orbit.'
CheckTrue 'T28 source_class: speculative'          ($p2.source_class -eq 'speculative')

$p3 = ParseIngestMessage 'ingest this: some content without any class label anywhere'
CheckTrue 'T29 missing class => source_class null' ($null -eq $p3.source_class)

# T30-T33: buildClarificationSummary
$cands = @(
  [pscustomobject]@{ extraction_confidence='high';   label='A'; node_type='claim' }
  [pscustomobject]@{ extraction_confidence='high';   label='B'; node_type='entity' }
  [pscustomobject]@{ extraction_confidence='medium'; label='C'; node_type='claim' }
  [pscustomobject]@{ extraction_confidence='low';    label='D'; node_type='claim' }
)
$sum = BuildClarificationSummary $cands 'Test Paper'
CheckTrue 'T30 summary total count (4)'            ($sum -match '4 candidate')
CheckTrue 'T31 summary 2 high-confidence'          ($sum -match '2 high')
CheckTrue 'T32 summary 1 medium'                   ($sum -match '1 medium')
CheckTrue 'T33 summary 1 low'                      ($sum -match '1 low')

# T39: title truncation cuts at a word boundary, not mid-word
$longBody = ('whether a given polynomial time algorithm exists for the general case remains an open question in the field of complexity theory and has been studied extensively for decades')
$p4 = ParseIngestMessage "ingest this as established: $longBody more padding text to satisfy the word-count guard padding padding padding"
CheckTrue 'T39 title <= 100 chars'                 ($p4.title.Length -le 100)
CheckTrue 'T39b title does not end mid-word'       (-not ($longBody.Substring(0,101) -match "$([regex]::Escape($p4.title))\S"))

# T40-T41: buildClarificationSummary no longer prompts (Fix B)
CheckFalse 'T40 summary has no "Add the...now?" prompt' ($sum -match 'Add the')
CheckFalse 'T41 summary has no "Reply: yes" prompt'      ($sum -match 'Reply: yes')

# T34-T38: invariants
CheckTrue  'T34 VALID_CLASS has 3 values'          ($VALID_CLASS.Count -eq 3)
CheckTrue  'T35 established in VALID_CLASS'        ('established' -in $VALID_CLASS)
CheckTrue  'T36 speculative in VALID_CLASS'        ('speculative' -in $VALID_CLASS)
CheckTrue  'T37 fringe in VALID_CLASS'             ('fringe' -in $VALID_CLASS)
CheckFalse 'T38 theorem NOT in VALID_KIND'         ('theorem' -in $VALID_KIND)

# ==== Result =================================================================
Write-Host ""
if ($fail -eq 0) {
  Write-Host "  ALL $pass TESTS PASS" -ForegroundColor Green
} else {
  Write-Host "  $pass PASS  $fail FAIL" -ForegroundColor Red
  exit 1
}
