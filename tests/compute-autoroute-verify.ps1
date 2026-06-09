# M8 Build-3 compute auto-route - PowerShell .NET-regex port
# Mirrors COMPUTE_TRIGGER + COMPUTE_HEURISTIC in lib/orchestrator.js.
# The NEGATIVES are the load-bearing test: auto-route must NOT fire on
# conversational / opinion / fleet / unit-less text.
# Run: powershell -ExecutionPolicy Bypass -File tests/compute-autoroute-verify.ps1

$ErrorActionPreference = 'Stop'
$opts = [Text.RegularExpressions.RegexOptions]::IgnoreCase

$TRIGGER = '^\s*(compute|calc(?:ulate)?|run\s+(?:the\s+)?code|simulate|crunch(?:\s+the\s+numbers)?)\b[\s:,\-]+'

# Same alternation as the JS new RegExp([...].join("|"))
$HEUR = @(
  '\b(?:factorial|fibonacci|how many (?:primes?|digits|combinations|permutations)|prime factor|nth (?:prime|digit)|verify\s+\w+\s+(?:up\s+)?to\s+\d|sum of (?:the\s+)?(?:first|all|integers)|monte[\s-]?carlo|standard deviation|compound (?:interest|growth)|amortiz|to the power of|square\s+roots?|cube\s+roots?|sqrt)\b',
  '\d+\s*!\B',
  '\d+\s*(?:\^|\*\*)\s*\d+',
  '\d+(?:\.\d+)?\s*%\s+of\s+[\d$,]',
  '\bconvert\s+\$?[\d.,]+',
  '\bhow many\s+(?:seconds?|minutes?|hours?|days?|weeks?|months?|years?|milliseconds?|grams?|kilograms?|kg|met(?:er|re)s?|km|miles?|feet|foot|inches|inch|ounces?|pounds?|lit(?:er|re)s?|ml|gallons?|bytes?|[kmg]b)\b',
  '\b\d{3,}\s*(?:x|times|multiplied\s+by|divided\s+by)\s+\d'
) -join '|'

function Fires([string]$m) {
  if ([regex]::IsMatch($m, $TRIGGER, $opts)) { return $true }
  if ([regex]::IsMatch($m, $HEUR, $opts))    { return $true }
  return $false
}

$pass = 0; $fail = 0
function Check($name, $got, $expected) {
  if ($got -eq $expected) { $script:pass++ }
  else { $script:fail++; Write-Host "  FAIL: $name (got $got, expected $expected)" -ForegroundColor Red }
}

Write-Host "`n-- POSITIVES: explicit prefix --"
Check "compute:"        (Fires "compute: 7^13") $true
Check "calc"            (Fires "calculate the variance of these") $true
Check "run the code"    (Fires "run the code for this") $true
Check "simulate"        (Fires "simulate 1000 dice rolls") $true

Write-Host "`n-- POSITIVES: auto-route (no prefix) --"
Check "power-of words"  (Fires "what is 7 to the power of 13?") $true
Check "caret power"     (Fires "what's 2^50") $true
Check "double-star pow" (Fires "what is 7**13") $true
Check "square root"     (Fires "what is the square root of 152399025?") $true
Check "cube root"       (Fires "the cube root of 1728") $true
Check "sqrt"            (Fires "sqrt of 9801") $true
Check "percent of"      (Fires "what is 15% of 84,320?") $true
Check "percent decimal" (Fires "what's 7.5% of 12000") $true
Check "convert num"     (Fires "convert 250 km to miles") $true
Check "convert dollar"  (Fires "convert `$1500 to euros") $true
Check "how many seconds"(Fires "how many seconds in 38 years?") $true
Check "how many ml"     (Fires "how many ml in 3 gallons") $true
Check "big multiply"    (Fires "what is 987654 times 123456") $true
Check "big divided"     (Fires "what is 1000000 divided by 7") $true
Check "factorial word"  (Fires "the factorial of 20") $true
Check "factorial bang"  (Fires "what is 20!") $true
Check "monte carlo"     (Fires "estimate pi with monte carlo") $true
Check "fibonacci"       (Fires "the 100th fibonacci number") $true

Write-Host "`n-- NEGATIVES: must NOT fire (conversational / opinion / fleet / unitless) --"
Check "fleet net"        (Fires "how much did the fleet make yesterday") $false
Check "fleet drivers"    (Fires "how many drivers do we have") $false
Check "fleet count2"     (Fires "how many drivers are in the fleet") $false
Check "opinion hire"     (Fires "what do you think about hiring 20 drivers") $false
Check "should I buy"     (Fires "should I buy Aramco stock") $false
Check "weather"          (Fires "what's the weather in Riyadh") $false
Check "how are you"      (Fires "how are you doing today") $false
Check "summarize"        (Fires "summarize this report for me") $false
Check "translate"        (Fires "translate hello to arabic") $false
Check "convert doc"      (Fires "convert this document to pdf") $false
Check "power metaphor"   (Fires "I want to learn about the power of compounding") $false
Check "square city"      (Fires "tell me about the old square in the city") $false
Check "trivial 2 plus 2" (Fires "what is 2 plus 2") $false
Check "small multiply"   (Fires "what is 47 times 89") $false
Check "how many people"  (Fires "how many people live in Riyadh") $false
Check "how many emails"  (Fires "how many emails did I get") $false
Check "percent no num"   (Fires "what percent of drivers are active") $false
Check "year mention"     (Fires "what happened in the year 2050") $false

Write-Host ""
$total = $pass + $fail
if ($fail -eq 0) { Write-Host "ALL $total TESTS PASSED" -ForegroundColor Green }
else { Write-Host "$fail/$total FAILED" -ForegroundColor Red; exit 1 }
