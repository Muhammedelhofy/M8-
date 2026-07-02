# Build-168 — context-packet telemetry (E2 step 1: MEASURE)
# PS 5.1 mirror of lib/context-telemetry.js analyzePacket() + static wiring checks.
# Node is ABSENT on this host: the mirror re-implements the pure classifier and
# asserts against by-construction expected values, then greps the JS for the
# safety invariants (kill switch, awaited insert, tight timeout, 2 call sites).

$ErrorActionPreference = "Stop"
$pass = 0; $fail = 0
function Check([string]$name, [bool]$ok) {
  if ($ok) { $script:pass++; Write-Host "PASS  $name" }
  else     { $script:fail++; Write-Host "FAIL  $name" -ForegroundColor Red }
}

# ── mirror of MARKERS (keep in sync with lib/context-telemetry.js) ────────────
$MARKERS = @(
  @("SYS",      "CURRENT DATE:"),
  @("MEM",      "RELEVANT MEMORY"),
  @("HH",       "HOUSEHOLD ("),
  @("CONFLICT", ("NOTE " + [char]0x2014 + " possible conflicting")),
  @("EVID",     "GROUNDED EVIDENCE"),
  @("KG",       "KNOWLEDGE GRAPH"),
  @("ENT",      "KNOWN ENTITIES"),
  @("BRIDGE",   "ENTITY <-> GRAPH LINKS"),
  @("TOPICS",   "RECURRING TOPICS"),
  @("CARD",     "ENTITY CARD"),
  @("WEB",      "WEB SEARCH RESULTS"),
  @("FLEET",    "FLEET "),
  @("COMPANY",  "COMPANY "),
  @("EOSB",     "EOSB "),
  @("RESEARCH", "RESEARCH ")
)

function Analyze-Packet([string]$s) {
  $hits = New-Object System.Collections.ArrayList
  foreach ($m in $MARKERS) {
    $label = $m[0]; $prefix = $m[1]
    if ($s.StartsWith($prefix)) { [void]$hits.Add((New-Object PSObject -Property @{ label = $label; start = 0 })) }
    $needle = "`n`n" + $prefix
    $from = 0
    while ($true) {
      if ($from -ge $s.Length) { break }
      $idx = $s.IndexOf($needle, $from)
      if ($idx -lt 0) { break }
      [void]$hits.Add((New-Object PSObject -Property @{ label = $label; start = $idx }))
      $from = $idx + $needle.Length
    }
  }
  $sorted = @($hits | Sort-Object -Property start)
  # de-dupe identical starts
  $uniq = New-Object System.Collections.ArrayList
  for ($i = 0; $i -lt $sorted.Count; $i++) {
    if ($i -eq 0) { [void]$uniq.Add($sorted[$i]) }
    elseif ($sorted[$i].start -ne $sorted[$i - 1].start) { [void]$uniq.Add($sorted[$i]) }
  }
  $byLabel = @{}
  for ($i = 0; $i -lt $uniq.Count; $i++) {
    if ($i + 1 -lt $uniq.Count) { $end = $uniq[$i + 1].start } else { $end = $s.Length }
    $size = $end - $uniq[$i].start
    if ($byLabel.ContainsKey($uniq[$i].label)) { $byLabel[$uniq[$i].label] = $byLabel[$uniq[$i].label] + $size }
    else { $byLabel[$uniq[$i].label] = $size }
  }
  if ($uniq.Count -gt 0) { $head = $uniq[0].start } else { $head = $s.Length }
  return New-Object PSObject -Property @{ total = $s.Length; sections = $byLabel; head = $head }
}

# ── Case 1: SYS + MEM + WEB — exact by-construction sizes ─────────────────────
$sys = "CURRENT DATE: Today is Thursday. SYSTEM PROMPT body here."
$mem = "`n`nRELEVANT MEMORY (past sessions):`nBoss prefers structured answers"
$web = "`n`nWEB SEARCH RESULTS (live, retrieved now):`nsnippet one`nsnippet two"
$a1 = Analyze-Packet ($sys + $mem + $web)
Check "c1 total"      ($a1.total -eq ($sys.Length + $mem.Length + $web.Length))
Check "c1 head=0"     ($a1.head -eq 0)
Check "c1 SYS size"   ($a1.sections["SYS"] -eq $sys.Length)
Check "c1 MEM size"   ($a1.sections["MEM"] -eq $mem.Length)
Check "c1 WEB size"   ($a1.sections["WEB"] -eq $web.Length)
Check "c1 3 sections" ($a1.sections.Keys.Count -eq 3)

# ── Case 2: marker WORD inside content (no \n\n boundary) must NOT split ──────
$mem2 = "`n`nRELEVANT MEMORY (past):`nwe reviewed FLEET numbers and KNOWLEDGE GRAPH ideas inline"
$a2 = Analyze-Packet ($sys + $mem2)
Check "c2 no FLEET section" (-not $a2.sections.ContainsKey("FLEET"))
Check "c2 no KG section"    (-not $a2.sections.ContainsKey("KG"))
Check "c2 MEM absorbs tail" ($a2.sections["MEM"] -eq $mem2.Length)

# ── Case 3: real \n\n-boundary FLEET packet IS split; repeated label merges ───
$fl1 = "`n`nFLEET DATA " + [char]0x2014 + " snapshot day one"
$fl2 = "`n`nFLEET ALERT " + [char]0x2014 + " tier slip"
$a3 = Analyze-Packet ($sys + $fl1 + $mem + $fl2)
Check "c3 FLEET merged size" ($a3.sections["FLEET"] -eq ($fl1.Length + $fl2.Length))
Check "c3 MEM intact"        ($a3.sections["MEM"] -eq $mem.Length)

# ── Case 4: packet not starting with a marker → head counted ──────────────────
$pre = "unlabelled preamble text"
$a4 = Analyze-Packet ($pre + $mem)
Check "c4 head size" ($a4.head -eq $pre.Length)

# ── Static wiring checks ──────────────────────────────────────────────────────
$root = Split-Path -Parent $PSScriptRoot
$jsPath = Join-Path $root "lib\context-telemetry.js"
$orch   = Join-Path $root "lib\orchestrator.js"
$js  = Get-Content $jsPath -Raw
$or  = Get-Content $orch -Raw

Check "s1 kill switch M8_CTX_TELEMETRY"      ($js.Contains("M8_CTX_TELEMETRY"))
Check "s2 lane ctx:packet"                   ($js.Contains('"ctx:packet"'))
Check "s3 tight 1500ms timeout"              ($js.Contains("1500"))
Check "s4 insert is awaited"                 ($js.Contains("await poster(row)"))
Check "s5 sizes-only privacy note"           ($js.Contains("labels+counts only"))
$callCount = ([regex]::Matches($or, "recordPacket\(\{")).Count
Check "s6 exactly 2 orchestrator call sites" ($callCount -eq 2)
$requireCount = ([regex]::Matches($or, 'require\("./context-telemetry"\)')).Count
Check "s7 both sites require the module"     ($requireCount -eq 2)
# both call sites must sit inside try{} so telemetry can never gate a reply
$guarded = ([regex]::Matches($or, "(?s)try \{\s*\r?\n\s*const \{ recordPacket \}")).Count
Check "s8 both call sites try-guarded"       ($guarded -eq 2)

# ── mirror-sync check: JS MARKERS list contains every mirrored label ──────────
$allLabels = $true
foreach ($m in $MARKERS) {
  if (-not $js.Contains('"' + $m[0] + '"')) { $allLabels = $false; Write-Host ("missing label in JS: " + $m[0]) }
}
Check "s9 marker labels in sync" $allLabels

Write-Host ""
Write-Host ("RESULT: {0} passed, {1} failed" -f $pass, $fail)
if ($fail -gt 0) { exit 1 } else { exit 0 }
