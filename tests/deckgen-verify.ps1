# M8 Deck Generator — renderer + detection + normalize port verification (no-node)
# The deck SPEC comes from the LLM, but the RENDERERS are pure/deterministic (code
# owns layout) — this ports them so the Marp/reveal structure is verified before
# deploy, plus looksDeck detection, planDeck template choice, and the spec
# normalization (cap bullets / drop empties / null on nothing). ASCII only.
#   Run:  powershell -File tests/deckgen-verify.ps1

$ErrorActionPreference = 'Stop'
$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ("$got" -eq "$expected") { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got '$got', expected '$expected')" -ForegroundColor Red }
}
function Has($name, $hay, $needle) {
  if ("$hay".Contains($needle)) { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (missing '$needle')" -ForegroundColor Red }
}
function HasNot($name, $hay, $needle) {
  if (-not "$hay".Contains($needle)) { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (should NOT contain '$needle')" -ForegroundColor Red }
}
$IC = [System.Text.RegularExpressions.RegexOptions]::IgnoreCase

# ---- ported pure helpers ----
function EscHtml($s) { $s = "$s"; $s = $s -replace '&','&amp;'; $s = $s -replace '<','&lt;'; $s = $s -replace '>','&gt;'; $s = $s -replace '"','&quot;'; return $s }

function RenderMarp($spec) {
  $head = (@("---","marp: true","theme: default","paginate: true","---") -join "`n")
  $blocks = @()
  for ($i = 0; $i -lt $spec.slides.Count; $i++) {
    $s = $spec.slides[$i]
    $t = if ($s.title) { $s.title } else { "Slide " + ($i + 1) }
    $lines = @("# $t")
    if ($spec.subtitle -and $i -eq 0) { $lines += ""; $lines += "### " + $spec.subtitle }
    if ($s.bullets.Count) { $lines += ""; foreach ($b in $s.bullets) { $lines += "- $b" } }
    if ($s.notes) { $lines += ""; $lines += "<!-- " + ($s.notes -replace '--+','-') + " -->" }
    $blocks += ($lines -join "`n")
  }
  return $head + "`n`n" + ($blocks -join "`n`n---`n`n") + "`n"
}

function RenderReveal($spec) {
  $sections = @()
  for ($i = 0; $i -lt $spec.slides.Count; $i++) {
    $s = $spec.slides[$i]
    $t = if ($s.title) { $s.title } else { "Slide " + ($i + 1) }
    $sub = if ($spec.subtitle -and $i -eq 0) { "<h3>" + (EscHtml $spec.subtitle) + "</h3>" } else { "" }
    $ul = ""
    if ($s.bullets.Count) { $li = ($s.bullets | ForEach-Object { "<li>" + (EscHtml $_) + "</li>" }) -join ""; $ul = "<ul>$li</ul>" }
    $notes = if ($s.notes) { '<aside class="notes">' + (EscHtml $s.notes) + "</aside>" } else { "" }
    $sections += "    <section><h2>" + (EscHtml $t) + "</h2>$sub$ul$notes</section>"
  }
  return "reveal.js@5 " + ($sections -join "`n")
}

function LooksDeck($m) { return [regex]::IsMatch($m, '\b(decks?|slides?|slide\s*deck|presentations?|pitch(?:\s*deck)?|power\s?point|ppt|pptx|keynote)\b', $IC) }
function PlanDeck($m) {
  $l = $m.ToLower()
  if ($l -match '\bproposal\b') { return 'deck_proposal' }
  if ($l -match '\b(status|update|progress|weekly|standup|stand-up)\b') { return 'deck_update' }
  return 'deck_brief'
}
# normalizeSpec: cap bullets at 6, drop empty slides, null when none
function NormalizeSlides($slides) {
  $out = @()
  foreach ($s in $slides) {
    $title = "$($s.title)".Trim()
    $bul = @(@($s.bullets) | ForEach-Object { "$_".Trim() } | Where-Object { $_ } | Select-Object -First 6)
    if ($title -or $bul.Count) { $out += @{ title = $title; bullets = $bul } }
  }
  return ,$out
}

# ---- (1) looksDeck detection ----
Write-Host "== (1) looksDeck: fires on deck/slides/pptx, not plain text ==" -ForegroundColor Cyan
Check "make me a deck"          (LooksDeck "make me a deck for the Q2 plan")       $true
Check "slides"                  (LooksDeck "turn this into slides")                $true
Check "pitch deck"              (LooksDeck "build a pitch deck for investors")     $true
Check "powerpoint / pptx"       (LooksDeck "export a powerpoint (pptx)")           $true
Check "presentation"            (LooksDeck "I need a presentation")                $true
Check "plain doc (not deck)"    (LooksDeck "write me a one-page plan")             $false
Check "plain chat (not deck)"   (LooksDeck "what's the fleet net today?")          $false

# ---- (2) planDeck template choice ----
Write-Host "== (2) planDeck: proposal / update / default brief ==" -ForegroundColor Cyan
Check "proposal -> deck_proposal" (PlanDeck "build a proposal deck") "deck_proposal"
Check "weekly update -> deck_update" (PlanDeck "a weekly status update deck") "deck_update"
Check "default -> deck_brief"      (PlanDeck "make a deck about the fleet") "deck_brief"

# ---- sample spec ----
$spec = @{ title = "Q2 Fleet Plan"; subtitle = "Riyadh ops"; slides = @(
  @{ title = "Title";       bullets = @();                                                  notes = "" },
  @{ title = "The Problem"; bullets = @("Acceptance < 70% & rising", "Cash gap 3,200 SAR"); notes = "Lead with the pain -- then the fix" }
) }

# ---- (3) renderMarp structure ----
$marp = RenderMarp $spec
Write-Host "== (3) renderMarp: frontmatter, slide separators, bullets, notes ==" -ForegroundColor Cyan
Has    "marp frontmatter"     $marp "marp: true"
Has    "title slide H1"       $marp "# Title"
Has    "subtitle on slide 0"  $marp "### Riyadh ops"
Has    "problem slide H1"     $marp "# The Problem"
Has    "bullet rendered"      $marp "- Acceptance < 70% & rising"
Has    "notes as HTML comment" $marp "<!-- Lead with the pain"
Has    "slide separator"      $marp "`n`n---`n`n"

# ---- (4) renderRevealHTML structure + escaping ----
$rev = RenderReveal $spec
Write-Host "== (4) renderRevealHTML: section per slide, h2, li, HTML-escaping ==" -ForegroundColor Cyan
Has    "reveal cdn"           $rev "reveal.js@5"
Has    "section + h2 title"   $rev "<section><h2>Title</h2>"
Has    "subtitle h3"          $rev "<h3>Riyadh ops</h3>"
Has    "bullet as li (escaped &)" $rev "<li>Acceptance &lt; 70% &amp; rising</li>"
Has    "speaker notes aside"  $rev 'aside class="notes"'
HasNot "no raw < leaked"      $rev "<li>Acceptance < 70%"

# escHtml direct
Check "escHtml < > & quote" (EscHtml '<b>"x"&y</b>') '&lt;b&gt;&quot;x&quot;&amp;y&lt;/b&gt;'

# ---- (5) normalizeSpec: cap bullets, drop empty slides, null when none ----
Write-Host "== (5) normalizeSpec: cap 6 bullets, drop empty slides, null on none ==" -ForegroundColor Cyan
$norm = NormalizeSlides @(
  @{ title = "Keep"; bullets = @("a","b","c","d","e","f","g","h") },   # 8 -> cap 6
  @{ title = "";     bullets = @() },                                   # empty -> dropped
  @{ title = "";     bullets = @("only a bullet, no title") }           # kept (has a bullet)
)
Check "dropped the empty slide -> 2 kept" $norm.Count 2
Check "bullets capped at 6"               $norm[0].bullets.Count 6
Check "bullet-only slide kept"            $norm[1].bullets[0] "only a bullet, no title"
$none = NormalizeSlides @( @{ title = ""; bullets = @() }, @{ title = "   "; bullets = @("") } )
Check "all-empty -> 0 (caller falls back)" $none.Count 0

# ---- (6) slugify: filesystem-safe filename base ----
function Slugify($s) {
  $x = ("$s").ToLower()
  $x = [regex]::Replace($x, '[^a-z0-9]+', '-')
  $x = [regex]::Replace($x, '^-+|-+$', '')
  if ($x.Length -gt 50) { $x = $x.Substring(0,50) }
  if (-not $x) { return 'deck' }
  return $x
}
Write-Host "== (6) slugify: deck title -> filename base ==" -ForegroundColor Cyan
Check "Q2 Fleet Plan -> q2-fleet-plan" (Slugify "Q2 Fleet Plan") "q2-fleet-plan"
Check "punctuation collapsed"          (Slugify "Proposal: Noon & Keeta!!") "proposal-noon-keeta"
Check "empty -> deck"                  (Slugify "") "deck"

Write-Host ""
if ($fail -eq 0) { Write-Host "ALL $pass CHECKS PASSED" -ForegroundColor Green }
else { Write-Host "$pass passed, $fail FAILED" -ForegroundColor Red; exit 1 }
