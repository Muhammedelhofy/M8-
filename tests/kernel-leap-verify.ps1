# ============================================================================
# M8 Build-42 -- Kernel/Leap decomposition (D3): PS mirror of the pure predicates
# ----------------------------------------------------------------------------
# No local Node, so resolveKernelStanding / parseDecomposition / the co-retrieval
# force-pull are MIRRORED here against lib/knowledge-intake.js + lib/memory-graph.js.
# Keep in lockstep with the JS. Pure ASCII.
#   powershell -File tests/kernel-leap-verify.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$script:pass = 0; $script:fail = 0
function Ok($cond, $label) {
  if ($cond) { $script:pass++; Write-Host ("  PASS  " + $label) -ForegroundColor DarkGreen }
  else       { $script:fail++; Write-Host ("  FAIL  " + $label) -ForegroundColor Red }
}

Write-Host "`nM8 Build-42 -- kernel/leap decomposition (D3) mirror`n"

# ============================================================================
# resolveKernelStanding (mirror of lib/knowledge-intake.js)
#   established match >= 0.82 -> 'use-existing' ; else flag -> 'established' ; else 'speculative'
# ============================================================================
$KERNEL_MATCH_SIM = 0.82
function Resolve-KernelStanding($matchSim, $matchIsEstablished, $flag) {
  if ($matchIsEstablished -and ($matchSim -ne $null) -and ($matchSim -ge $KERNEL_MATCH_SIM)) { return 'use-existing' }
  if ($flag) { return 'established' }
  return 'speculative'
}
Write-Host "-- resolveKernelStanding --"
Ok ((Resolve-KernelStanding 0.86 $true  $false) -eq 'use-existing') "established match @0.86 -> use-existing (link to existing node)"
Ok ((Resolve-KernelStanding 0.82 $true  $false) -eq 'use-existing') "established match @ boundary 0.82 -> use-existing"
Ok ((Resolve-KernelStanding 0.81 $true  $false) -eq 'speculative')  "established match @0.81 (below threshold) -> speculative (honest default)"
Ok ((Resolve-KernelStanding 0.95 $false $false) -eq 'speculative')  "high sim but match NOT established -> speculative"
Ok ((Resolve-KernelStanding 0.40 $false $true)  -eq 'established')  "no match + explicit human flag -> established (minted)"
Ok ((Resolve-KernelStanding 0.86 $true  $true)  -eq 'use-existing') "established match dominates the flag -> use-existing"
Ok ((Resolve-KernelStanding $null $false $false) -eq 'speculative') "no match, no flag -> speculative"

# ============================================================================
# parseDecomposition (mirror): valid pair -> object ; missing half / 'null' -> null
# ============================================================================
function Parse-Decomposition($raw) {
  $s = ([string]$raw).Trim()
  if ($s -match '(?is)```(?:json)?\s*(.*?)```') { $s = $Matches[1].Trim() }
  if ($s -match '^(?i)null$') { return $null }
  $a = $s.IndexOf('{'); $b = $s.LastIndexOf('}')
  if ($a -lt 0 -or $b -le $a) { return $null }
  try { $obj = ($s.Substring($a, $b - $a + 1) | ConvertFrom-Json) } catch { return $null }
  function OkPart($p) { return ($p -and $p.label -is [string] -and $p.label.Trim().Length -ge 3 -and $p.content -is [string] -and $p.content.Trim().Length -ge 3) }
  if (-not (OkPart $obj.kernel) -or -not (OkPart $obj.leap)) { return $null }
  return $obj
}
Write-Host "`n-- parseDecomposition --"
$good = '{"kernel":{"label":"digital root cycles mod 9","content":"the digital root of n cycles with period 9 -- real arithmetic"},"leap":{"label":"numbers encode energy geometry","content":"therefore numbers encode the energy-geometry of reality"}}'
$pd = Parse-Decomposition $good
Ok ($pd -ne $null -and $pd.kernel.label -eq 'digital root cycles mod 9') "valid {kernel,leap} JSON -> parsed pair"
Ok ((Parse-Decomposition 'null') -eq $null) "'null' (no separable core) -> null"
Ok ((Parse-Decomposition '{"kernel":{"label":"x","content":"y"}}') -eq $null) "missing leap half -> null"
Ok ((Parse-Decomposition 'here is the split: not json') -eq $null) "prose / no JSON -> null"
$fenced = '```json' + "`n" + $good + "`n" + '```'
Ok ((Parse-Decomposition $fenced) -ne $null) "fenced ```json block -> still parsed"

# ============================================================================
# Co-retrieval force-pull (mirror of buildGraphContext): for each matched LEAP,
# its kernel joins the render set if missing; cap = 4; a matched kernel w/ no leap
# pulls nothing; a non-leap match pulls nothing.
# ============================================================================
function CoRetrievePull($matchIds, $links) {   # links: hashtable leapId -> kernelId
  $present = @{}; foreach ($id in $matchIds) { $present[$id] = $true }
  $wantedKernels = @()
  foreach ($leap in $matchIds) { if ($links.ContainsKey($leap)) { $wantedKernels += $links[$leap] } }
  $missing = @(); $seen = @{}
  foreach ($k in $wantedKernels) { if (-not $present.ContainsKey($k) -and -not $seen.ContainsKey($k)) { $seen[$k] = $true; $missing += $k } }
  return @($missing | Select-Object -First 4)
}
Write-Host "`n-- co-retrieval force-pull --"
# 2 leaps, kernels absent -> both pulled
$pulled = CoRetrievePull @('leapA','leapB') @{ leapA='kern1'; leapB='kern2' }
Ok (($pulled -join ',') -eq 'kern1,kern2') "two matched leaps -> both kernels force-pulled"
# kernel already present in matches -> not re-pulled
$pulled2 = CoRetrievePull @('leapA','kern1') @{ leapA='kern1' }
Ok ($pulled2.Count -eq 0) "leap whose kernel is ALREADY in matches -> nothing extra pulled"
# non-leap match -> nothing
$pulled3 = CoRetrievePull @('plainNode') @{ }
Ok ($pulled3.Count -eq 0) "a matched kernel / plain node with no leap -> pulls nothing"
# cap at 4
$links6 = @{}; $ids6 = @(); 1..6 | ForEach-Object { $links6["leap$_"] = "kern$_"; $ids6 += "leap$_" }
$pulled4 = CoRetrievePull $ids6 $links6
Ok ($pulled4.Count -eq 4) "six leaps -> forced kernel pulls capped at 4"

# leap inline annotation shape (mirror of renderGraphPacket bits.push)
function LeapAnnotation($kernelLabel, $kernelClass) {
  return ('decomposed-from kernel "{0}" [{1}] -- speculative LEAP, only meaningful beside its kernel' -f $kernelLabel, ([string]$kernelClass).ToUpper())
}
$ann = LeapAnnotation 'digital root cycles mod 9' 'established'
Ok ($ann -match 'decomposed-from kernel "digital root cycles mod 9" \[ESTABLISHED\]') "leap line annotated with kernel label + UPPER class"

# ============================================================================
# D2 regression: the decomposition relation is derived_from (ALLOWED for a
# speculative endpoint); a leap--supports-->kernel would be BANNED.
# ============================================================================
Write-Host "`n-- D2 consistency (edge model) --"
$EVIDENCE_BEARING_RELS = @('supports','formalizes')
function Is-Spec($c) { return ($c -eq 'speculative' -or $c -eq 'fringe') }
function Edge-Allowed($rel, $s, $d) { if (-not ($EVIDENCE_BEARING_RELS -contains $rel)) { return $true } return (-not ((Is-Spec $s) -or (Is-Spec $d))) }
Ok (Edge-Allowed 'derived_from' 'speculative' 'established') "leap(speculative) --derived_from--> kernel -> ALLOWED (decomposition relation)"
Ok (-not (Edge-Allowed 'supports' 'speculative' 'established')) "leap(speculative) --supports--> kernel -> BANNED by D2 (would be evidentiary)"

Write-Host ("`n==== kernel-leap-verify: {0} passed, {1} failed ====" -f $script:pass, $script:fail) -ForegroundColor Cyan
if ($script:fail -gt 0) { exit 1 }
