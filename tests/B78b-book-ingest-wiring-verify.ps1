# B78b-book-ingest-wiring-verify.ps1 -- Build-78 wiring ship gate.
# PS mirror of detectBookIngest + parseBookIngestMessage in lib/knowledge-intake.js
# (the chat-command detection/parsing the orchestrator uses to route an
# "ingest this as a book" + document attachment to the resumable engine).
# No DB, no Gemini, no network. Pure ASCII, no ternary. ASCII-only comments.

$pass = 0; $fail = 0
function CheckTrue([string]$label, $cond) {
  if ($cond) { $script:pass++; Write-Host "  PASS  $label" -ForegroundColor Green }
  else        { $script:fail++; Write-Host "  FAIL  $label" -ForegroundColor Red }
}
function CheckFalse([string]$label, $cond) { CheckTrue $label (-not $cond) }
function CheckEq([string]$label, $expected, $actual) {
  CheckTrue ($label + " (exp=" + $expected + " got=" + $actual + ")") ($expected -eq $actual)
}

# ==== mirror: BOOK_INGEST_RE / detectBookIngest ================================
$BOOK_INGEST_RE = [regex]'(?i)\bingest\b[\s\S]*\bbook\b'
function Detect-BookIngest([string]$message) {
  return $BOOK_INGEST_RE.IsMatch([string]$message)
}

# ==== mirror: normalizeSourceClass ============================================
$VALID_CLASS = @('established','speculative')
function Normalize-SourceClass($c) {
  $v = ([string]$c).Trim().ToLower()
  if ($v -eq 'fringe') { return 'speculative' }
  if ($VALID_CLASS -contains $v) { return $v }
  return $null
}
$CLASS_RE = [regex]'(?i)\b(established|speculative|fringe)\b'

# ==== mirror: parseBookIngestMessage ==========================================
function Parse-BookIngestMessage([string]$message) {
  $s = [string]$message
  function Grab([string]$key, [string]$text) {
    $re = [regex]("(?i)" + $key + "\s*[=:]\s*(.+?)(?=\s*(?:,|\n|$|\b(?:title|author|year|source_class|class)\s*[=:]))")
    $m = $re.Match($text)
    if ($m.Success) {
      $v = $m.Groups[1].Value.Trim()
      $v = $v.Trim('"').Trim("'")
      return $v
    }
    return $null
  }
  $title  = Grab 'title' $s
  $author = Grab 'author' $s
  $year   = Grab 'year' $s
  $clsRaw = Grab 'source_class' $s
  if ($null -eq $clsRaw) { $clsRaw = Grab 'class' $s }
  $sc = Normalize-SourceClass $clsRaw
  if ($null -eq $sc) {
    $m = $CLASS_RE.Match($s)
    if ($m.Success) { $sc = Normalize-SourceClass $m.Groups[1].Value }
  }
  return [pscustomobject]@{ title = $title; author = $author; year = $year; source_class = $sc }
}

Write-Host "`n-- detectBookIngest: positives --" -ForegroundColor Cyan
CheckTrue "ingest this as a book"       (Detect-BookIngest "ingest this as a book: title=X, source_class=established")
CheckTrue "please ingest the book"      (Detect-BookIngest "please ingest the book bn01")
CheckTrue "ingest ... a whole book"     (Detect-BookIngest "ingest this attachment as a whole book")

Write-Host "`n-- detectBookIngest: negatives (must NOT steal these) --" -ForegroundColor Cyan
CheckFalse "plain paper ingest"         (Detect-BookIngest "ingest this paper")
CheckFalse "ingest a document"          (Detect-BookIngest "ingest this document please")
CheckFalse "book mentioned before verb" (Detect-BookIngest "the book is great, can you ingest it")
CheckFalse "no ingest verb"             (Detect-BookIngest "add this book to the shelf")

Write-Host "`n-- parseBookIngestMessage: full key=value form --" -ForegroundColor Cyan
$p = Parse-BookIngestMessage "ingest this as a book: title=The Beginning and the End, author=Ibn Kathir, year=774 AH, source_class=established"
CheckEq "title parsed"        "The Beginning and the End" $p.title
CheckEq "author parsed"       "Ibn Kathir" $p.author
CheckEq "year parsed"         "774 AH" $p.year
CheckEq "source_class parsed" "established" $p.source_class

Write-Host "`n-- parseBookIngestMessage: order independent + quotes stripped --" -ForegroundColor Cyan
$p = Parse-BookIngestMessage 'ingest as a book source_class=speculative, title="Arktos", author=Godwin'
CheckEq "title with quotes stripped" "Arktos" $p.title
CheckEq "speculative class"          "speculative" $p.source_class

Write-Host "`n-- parseBookIngestMessage: colon syntax + fringe folds --" -ForegroundColor Cyan
$p = Parse-BookIngestMessage "ingest this as a book title: My Title class: fringe"
CheckEq "colon title"        "My Title" $p.title
CheckEq "fringe -> speculative" "speculative" $p.source_class

Write-Host "`n-- parseBookIngestMessage: bare class word fallback --" -ForegroundColor Cyan
$p = Parse-BookIngestMessage "ingest this as a book: title=Foo (this is an established work)"
CheckEq "bare established picked up" "established" $p.source_class

Write-Host "`n-- parseBookIngestMessage: missing pieces -> null (route asks for them) --" -ForegroundColor Cyan
$p = Parse-BookIngestMessage "ingest this as a book please"
CheckTrue "no title -> null"  ($null -eq $p.title)
CheckTrue "no class -> null"  ($null -eq $p.source_class)

Write-Host "`n================ B78b RESULT ================" -ForegroundColor Cyan
Write-Host ("  PASS: " + $pass) -ForegroundColor Green
Write-Host ("  FAIL: " + $fail) -ForegroundColor Red
if ($fail -gt 0) { exit 1 } else { Write-Host "  ALL GREEN" -ForegroundColor Green; exit 0 }
