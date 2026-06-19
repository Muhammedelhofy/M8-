# Build-65 Phase B2 offline verify -- pure PS, no Node, ASCII only
# Tests deck-type detection, chips clarification routing, and download URL formation.
# Run from repo root: .\tests\B2-pptx-verify.ps1

$pass = 0
$fail = 0
function ok($label, $cond) {
    if ($cond) { Write-Host "PASS: $label" -ForegroundColor Green; $script:pass++ }
    else        { Write-Host "FAIL: $label" -ForegroundColor Red;   $script:fail++ }
}

# ----- mirror of deckTypeFromMessage ----------------------------------------
$ANALYSIS    = [regex]"(?i)\b(analys[ie]s|analytical|data|deep.?dive|deep\s+look|detailed)\b"
$BOARD       = [regex]"(?i)\b(board|exec(utive)?|c.?suite|leadership|management|investor|stakeholder)\b"
$OPERATIONAL = [regex]"(?i)\b(op(eration)?s?|operational|daily|action|action.items?|call.list|who.to.call|what.to.do)\b"

function deckType($msg) {
    if ($ANALYSIS.IsMatch($msg))    { return "analysis" }
    if ($BOARD.IsMatch($msg))       { return "board" }
    if ($OPERATIONAL.IsMatch($msg)) { return "operational" }
    return $null
}

# ----- mirror of exportIntent -----------------------------------------------
$PPTX_RE = [regex]"(?i)\b(make|build|create|generate|prepare|give\s+me)\b.*?\b(ppt|pptx|powerpoint|presentation|deck|slides)\b|\b(ppt|pptx|powerpoint|presentation|deck|slides)\b.*?\b(fleet|report|export|file)\b"

function exportFmt($msg) {
    if ($PPTX_RE.IsMatch($msg)) { return "pptx" }
    return $null
}

# ----- Tests: deckTypeFromMessage -------------------------------------------
ok "Analysis keyword detected"     ((deckType "make me an Analysis fleet deck") -eq "analysis")
ok "Board keyword detected"        ((deckType "make me a Board fleet deck") -eq "board")
ok "Operational keyword detected"  ((deckType "make me an Operational fleet deck") -eq "operational")
ok "Exec keyword maps to board"    ((deckType "give me an executive deck") -eq "board")
ok "Ops keyword maps to operational" ((deckType "ops deck please") -eq "operational")
ok "Deep dive maps to analysis"    ((deckType "give me a deep dive deck") -eq "analysis")
ok "No keyword returns null"       ((deckType "make me a fleet deck") -eq $null)
ok "No keyword (pptx only)"        ((deckType "create a pptx") -eq $null)
ok "Data keyword maps to analysis" ((deckType "data deck") -eq "analysis")
ok "Management keyword board"      ((deckType "management presentation") -eq "board")

# ----- Tests: clarification routing (no type = chips) -----------------------
$cases = @(
    @{ msg="make me a fleet deck";         shouldAskType=$true  },
    @{ msg="create a pptx";                shouldAskType=$true  },
    @{ msg="generate a presentation";      shouldAskType=$true  },
    @{ msg="give me a powerpoint";         shouldAskType=$true  },
    @{ msg="make me an Analysis fleet deck"; shouldAskType=$false },
    @{ msg="build a Board deck";           shouldAskType=$false },
    @{ msg="Operational fleet deck please";shouldAskType=$false },
    @{ msg="give me the excel report";     shouldAskType=$false }  # xlsx not pptx
)
foreach ($c in $cases) {
    $fmt  = exportFmt $c.msg
    $type = deckType $c.msg
    $askType = ($fmt -eq "pptx") -and ($type -eq $null)
    $label = if ($c.shouldAskType) { "Chips shown for: $($c.msg)" } else { "No chips for: $($c.msg)" }
    ok $label ($askType -eq $c.shouldAskType)
}

# ----- Tests: download URL formation when type IS known ---------------------
function downloadUrl($msg) {
    $fmt  = exportFmt $msg
    if ($fmt -ne "pptx") { return $null }
    $type = deckType $msg
    if ($type -eq $null) { return $null }  # would have shown chips instead
    return "/api/fleet-export?format=pptx&type=$type"
}

ok "Analysis URL correct"     ((downloadUrl "make me an Analysis fleet deck") -eq "/api/fleet-export?format=pptx&type=analysis")
ok "Board URL correct"        ((downloadUrl "make me a Board fleet deck")     -eq "/api/fleet-export?format=pptx&type=board")
ok "Operational URL correct"  ((downloadUrl "make me an Operational fleet deck") -eq "/api/fleet-export?format=pptx&type=operational")
ok "No type → no URL (chips)" ((downloadUrl "make me a fleet deck") -eq $null)

# ----- Tests: type query param dispatch (mirrors fleet-export.js handler) ---
function dispatchType($queryType) {
    $valid = @("analysis","board","operational")
    if ($queryType -in $valid) { return $queryType }
    return "board"  # default fallback
}
ok "Dispatch analysis"      ((dispatchType "analysis")     -eq "analysis")
ok "Dispatch board"         ((dispatchType "board")        -eq "board")
ok "Dispatch operational"   ((dispatchType "operational")  -eq "operational")
ok "Dispatch unknown->board" ((dispatchType "xyz")         -eq "board")
ok "Dispatch empty->board"  ((dispatchType "")             -eq "board")

# ----- Summary --------------------------------------------------------------
Write-Host ""
$color = if ($fail -eq 0) { "Cyan" } else { "Red" }
Write-Host "B2-pptx-verify: $pass passed, $fail failed" -ForegroundColor $color
if ($fail -gt 0) { exit 1 } else { exit 0 }
