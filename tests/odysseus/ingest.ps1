# Odysseus Probe Ingestor -- tests/odysseus/ingest.ps1
#
# Converts a validated probe spec JSON into formatted JS and PS entries,
# then (with -Apply) inserts them into probes.js and run-eval-live.ps1.
# Without -Apply: prints the snippets so you can review before committing.
#
# Usage:
#   powershell -File tests/odysseus/ingest.ps1 -File path/to/spec.json          # preview
#   powershell -File tests/odysseus/ingest.ps1 -File path/to/spec.json -Apply   # insert
#   powershell -File tests/odysseus/ingest.ps1 -File path/to/spec.json -Probe rt.my_id -Apply

param(
  [Parameter(Mandatory)][string]$File,
  [string]$Probe  = "",     # filter to one probe id from the file
  [switch]$Apply            # actually insert into probes.js + run-eval-live.ps1
)
$ErrorActionPreference = 'Stop'

$scriptDir  = $PSScriptRoot
$testsDir   = Split-Path $scriptDir -Parent
$evalDir    = Join-Path $testsDir 'eval'
$probesJs   = Join-Path $evalDir 'probes.js'
$runnerPs   = Join-Path $evalDir 'run-eval-live.ps1'

# -- Validate first ------------------------------------------------------------
Write-Host "Running contract validation..."
$validateScript = Join-Path $scriptDir 'validate.ps1'
& powershell -File $validateScript -File (Resolve-Path $File).Path
if ($LASTEXITCODE -ne 0) { Write-Error "Validation failed. Fix errors before ingesting."; exit 1 }

# -- Load probe(s) -------------------------------------------------------------
$content = Get-Content $File -Raw | ConvertFrom-Json
$probes  = if ($content -is [array]) { $content } else { @($content) }
if ($Probe) { $probes = @($probes | Where-Object { $_.id -eq $Probe }) }
if ($probes.Count -eq 0) { Write-Error "No probe(s) to ingest (check -Probe filter)."; exit 1 }

# -- Formatting helpers ---------------------------------------------------------

# Escape a string for use inside a JS regex literal (wraps in /pattern/i)
function JsRe([string]$re) { return "/$re/i" }

# Escape a string for JS double-quoted string
function JsStr([string]$s) { return $s -replace '\\','\\' -replace '"','\"' }

# Format a single check object as JS (indented)
function FormatJsCheck($c, [string]$indent) {
  $k = $c.kind
  if ($k -eq 'anyOf') {
    $subLines = @($c.checks | ForEach-Object { FormatJsCheck $_ "$indent  " })
    $subBlock = $subLines -join ",`n"
    $lbl = JsStr $c.label
    return "${indent}{ kind: `"anyOf`", label: `"$lbl`", checks: [`n$subBlock`n${indent}] }"
  }
  $lbl = JsStr $c.label
  switch ($k) {
    'present'         { return "${indent}{ kind: `"present`", re: $(JsRe $c.re), label: `"$lbl`" }" }
    'absent'          { return "${indent}{ kind: `"absent`",  re: $(JsRe $c.re), label: `"$lbl`" }" }
    'refusal'         { return "${indent}{ kind: `"refusal`", label: `"$lbl`" }" }
    'flagsAssumption' { return "${indent}{ kind: `"flagsAssumption`", label: `"$lbl`" }" }
    'citesNumber'     { return "${indent}{ kind: `"citesNumber`", label: `"$lbl`" }" }
    default           { return "${indent}{ kind: `"$k`", label: `"$lbl`" }" }
  }
}

# Format a full probe as a JS object literal (2-space indented, ready to paste)
function FormatJsProbe($p) {
  $date = (Get-Date).ToString('yyyy-MM-dd')
  $sb = [System.Text.StringBuilder]::new()
  [void]$sb.AppendLine("  // Odysseus-generated probe ($date)")
  [void]$sb.AppendLine("  {")
  [void]$sb.AppendLine("    id: `"$($p.id)`",")
  [void]$sb.AppendLine("    category: `"$($p.category)`",")
  $titleSafe = JsStr $p.title
  [void]$sb.AppendLine("    title: `"$titleSafe`",")
  [void]$sb.AppendLine("    weight: $($p.weight),")
  [void]$sb.AppendLine("    turns: [")
  $turns = @($p.turns)
  for ($i = 0; $i -lt $turns.Count; $i++) {
    $t = $turns[$i]
    $sendSafe = JsStr $t.send
    $isLast   = ($i -eq $turns.Count - 1)
    if (-not $t.checks -or @($t.checks).Count -eq 0) {
      $comma = if ($isLast) { '' } else { ',' }
      [void]$sb.AppendLine("      { send: `"$sendSafe`" }$comma")
    } else {
      [void]$sb.AppendLine("      { send: `"$sendSafe`",")
      [void]$sb.AppendLine("        checks: [")
      $chks = @($t.checks)
      for ($j = 0; $j -lt $chks.Count; $j++) {
        $chkLine = FormatJsCheck $chks[$j] "          "
        $comma   = if ($j -eq $chks.Count - 1) { '' } else { ',' }
        [void]$sb.AppendLine("$chkLine$comma")
      }
      [void]$sb.AppendLine("        ],")
      $comma = if ($isLast) { '' } else { ',' }
      [void]$sb.AppendLine("      }$comma")
    }
  }
  [void]$sb.AppendLine("    ],")
  $noteSafe = JsStr $p.note
  [void]$sb.AppendLine("    note: `"$noteSafe`",")
  [void]$sb.Append("  }")
  return $sb.ToString()
}

# -- PS helpers -----------------------------------------------------------------

# Format a regex string for PS (escape single-quotes by doubling)
function PsRe([string]$re) { return $re -replace "'","''" }

# Format a label for PS (escape single-quotes)
function PsLbl([string]$s) { return $s -replace "'","''" }

# Format a send string for PS (use double-quotes; escape $)
function PsSend([string]$s) { return $s -replace '"','""' -replace '\$',"`$$" }

# Format a single check as a PS Ck() call
function FormatPsCheck($c) {
  $k = $c.kind
  if ($k -eq 'anyOf') {
    $subs = @($c.checks | ForEach-Object { FormatPsCheck $_ }) -join ", "
    $lbl  = PsLbl $c.label
    return "(Ck 'anyOf' `$null '$lbl' @($subs))"
  }
  $lbl = PsLbl $c.label
  switch ($k) {
    'present'         { return "(Ck 'present' `"$(PsRe $c.re)`" '$lbl')" }
    'absent'          { return "(Ck 'absent' `"$(PsRe $c.re)`" '$lbl')" }
    'refusal'         { return "(Ck 'refusal' `$null '$lbl')" }
    'flagsAssumption' { return "(Ck 'flagsAssumption' `$null '$lbl')" }
    'citesNumber'     { return "(Ck 'citesNumber' `$null '$lbl')" }
    default           { return "(Ck '$k' `$null '$lbl')" }
  }
}

# Format a full probe as a PS hashtable entry
function FormatPsProbe($p) {
  $date = (Get-Date).ToString('yyyy-MM-dd')
  $sb   = [System.Text.StringBuilder]::new()
  [void]$sb.AppendLine("  # -- Odysseus-generated ($date) --")
  [void]$sb.Append("  @{ id='$($p.id)'; cat='$($p.category)'; turns=@(")
  $turns = @($p.turns)
  for ($i = 0; $i -lt $turns.Count; $i++) {
    $t     = $turns[$i]
    $send  = PsSend $t.send
    $isLast = ($i -eq $turns.Count - 1)
    if (-not $t.checks -or @($t.checks).Count -eq 0) {
      [void]$sb.Append("`n    @{ send=`"$send`" }")
      if (-not $isLast) { [void]$sb.Append(",") }
    } else {
      [void]$sb.Append("`n    @{ send=`"$send`"; checks=@(")
      $chks = @($t.checks)
      $ckLines = $chks | ForEach-Object { FormatPsCheck $_ }
      [void]$sb.Append($ckLines -join ",`n      ")
      $comma = if ($isLast) { '' } else { ',' }
      [void]$sb.Append(" ) }$comma")
    }
  }
  [void]$sb.Append(" ) }")
  return $sb.ToString()
}

# -- Process each probe ---------------------------------------------------------
foreach ($p in $probes) {
  Write-Host "`n== Probe: $($p.id) =="
  $jsSnippet = FormatJsProbe $p
  $psSnippet = FormatPsProbe $p

  if (-not $Apply) {
    Write-Host "`n-- probes.js entry (insert before the closing ]; ) -----------------------"
    Write-Host $jsSnippet -ForegroundColor Cyan
    Write-Host "`n-- run-eval-live.ps1 entry (insert before 'if (`$Only)') ----------------"
    Write-Host $psSnippet -ForegroundColor Cyan
    Write-Host "`nAdd -Apply to insert into the files."
    continue
  }

  # -- Apply to probes.js -------------------------------------------------------
  $jsContent = Get-Content $probesJs -Raw
  # Insert before the last ]; (the PROBES array close)
  $closingJs = '];'
  $idx = $jsContent.LastIndexOf($closingJs)
  if ($idx -lt 0) { Write-Error "Cannot find the closing ]; in probes.js"; exit 1 }
  # Place a comma after the last probe entry then the new entry then ];
  $jsContent = $jsContent.Substring(0, $idx) + "`n`n$jsSnippet,`n" + $jsContent.Substring($idx)
  Set-Content $probesJs -Value $jsContent -Encoding utf8 -NoNewline
  Write-Host "  -> appended to probes.js" -ForegroundColor Green

  # -- Apply to run-eval-live.ps1 -----------------------------------------------
  $psContent = Get-Content $runnerPs -Raw
  # Insert before the 'if ($Only)' line that filters the probe list
  $markerPs = "`nif (`$Only)"
  $idx2 = $psContent.IndexOf($markerPs)
  if ($idx2 -lt 0) { Write-Error "Cannot find 'if (`$Only)' in run-eval-live.ps1"; exit 1 }
  # Add the PS snippet before the closing ) of $probes = @(...)
  # The $probes array closes with a line containing just )
  # Find the last ) that precedes the if ($Only) line
  $before = $psContent.Substring(0, $idx2)
  $after  = $psContent.Substring($idx2)
  $lastParen = $before.LastIndexOf("`n)")
  if ($lastParen -lt 0) { Write-Error "Cannot find closing ) of `$probes array in run-eval-live.ps1"; exit 1 }
  $psContent = $before.Substring(0, $lastParen) + "`n$psSnippet" + $before.Substring($lastParen) + $after
  Set-Content $runnerPs -Value $psContent -Encoding utf8 -NoNewline
  Write-Host "  -> appended to run-eval-live.ps1" -ForegroundColor Green

  Write-Host "  Probe $($p.id) ingested."
}

if ($Apply) {
  Write-Host "`nDone. Verify the new probes:"
  Write-Host "  powershell -File tests/eval/run-eval-live.ps1 -Only odysseus_redteam"
} else {
  Write-Host "`nReview the snippets above, then rerun with -Apply."
}
