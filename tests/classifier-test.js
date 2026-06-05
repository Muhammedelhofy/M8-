/**
 * M8 Classifier Test Suite — tests/classifier-test.js
 *
 * Run: node tests/classifier-test.js
 * Tests all 6 intent categories with 33 realistic queries.
 */

const { classifyIntent, INTENT } = require("../api/intentClassifier");

const testCases = [
  // ── LIVE_DATA ──────────────────────────────────────────────────
  { query: "can you help me find cheap flights from riyadh to alexandria",  expected: "LIVE_DATA" },
  { query: "cheap flights riyadh to alexandria",                            expected: "LIVE_DATA" },
  { query: "i want to book a flight from riyadh to alexandria on june 7",   expected: "LIVE_DATA" },
  { query: "what is the current stock price for uber",                      expected: "LIVE_DATA" },
  { query: "exchange rate sar to egp today",                               expected: "LIVE_DATA" },
  { query: "weather in riyadh tomorrow",                                    expected: "LIVE_DATA" },

  // ── LOOKUP ─────────────────────────────────────────────────────
  { query: "best school near munsiyah riyadh",                             expected: "LOOKUP" },
  { query: "what restaurants are open near me right now",                   expected: "LOOKUP" },
  { query: "price of iphone 16 in saudi arabia",                           expected: "LOOKUP" },
  { query: "nearby logistics companies in north riyadh",                    expected: "LOOKUP" },
  { query: "how much does it cost to ship from riyadh to jeddah",          expected: "LOOKUP" },
  { query: "find me a good gym near al malqa",                             expected: "LOOKUP" },
  { query: "list the top 5 logistics companies in saudi arabia",           expected: "LOOKUP" },
  { query: "top 3 courier services operating in riyadh",                   expected: "LOOKUP" },

  // ── NEWS ───────────────────────────────────────────────────────
  { query: "latest keeta news",                                            expected: "NEWS" },
  { query: "what happened in the saudi logistics sector this week",        expected: "NEWS" },
  { query: "recent updates from bolt ksa",                                 expected: "NEWS" },

  // ── FACT_CHECK ─────────────────────────────────────────────────
  { query: "did keeta launch in bahrain",                                  expected: "FACT_CHECK" },
  { query: "has noon food expanded to north riyadh",                       expected: "FACT_CHECK" },
  { query: "was uber eats available in riyadh last year",                  expected: "FACT_CHECK" },
  { query: "is the riyadh metro fully operational on all lines",           expected: "FACT_CHECK" },
  { query: "is uber eats available in riyadh",                             expected: "FACT_CHECK" },

  // ── RESEARCH ───────────────────────────────────────────────────
  { query: "explain rider utilization metrics",                            expected: "RESEARCH" },
  { query: "summarize atomic habits book",                                 expected: "RESEARCH" },
  { query: "what is supply chain optimization",                            expected: "RESEARCH" },
  { query: "best logistics books to read",                                 expected: "RESEARCH" },
  { query: "tell me about last mile delivery models",                      expected: "RESEARCH" },

  // ── NONE ───────────────────────────────────────────────────────
  { query: "who am i",                                                     expected: "NONE" },
  { query: "what did we discuss about keeta last month",                   expected: "NONE" },
  { query: "how are you",                                                  expected: "NONE" },
  { query: "remind me what we agreed on for the drivers",                  expected: "NONE" },
  { query: "thanks",                                                       expected: "NONE" },
  { query: "my fleet performance this week",                               expected: "NONE" },
  { query: "my drivers stats today",                                       expected: "NONE" },
];

// ── Runner ─────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

console.log("\nM8 Classifier Test Suite");
console.log("=".repeat(72));

for (const { query, expected } of testCases) {
  const got = classifyIntent(query);
  const ok  = got === expected;
  if (ok) {
    passed++;
    console.log(`  ✅  [${expected.padEnd(10)}]  ${query}`);
  } else {
    failed++;
    failures.push({ query, expected, got });
    console.log(`  ❌  [${expected.padEnd(10)}] → got ${got.padEnd(10)}  ${query}`);
  }
}

console.log("=".repeat(72));
console.log(`\nResults: ${passed}/${testCases.length} passed`);

if (failures.length > 0) {
  console.log("\nFailed cases:");
  failures.forEach(({ query, expected, got }) => {
    console.log(`  Expected ${expected}, got ${got}: "${query}"`);
  });
  process.exit(1);
} else {
  console.log("All tests passed.\n");
}
