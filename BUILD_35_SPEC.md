# Build-35 — Source-Trust Hardening (Honesty task #1)

**Written:** 2026-06-15 (Session-32, Opus) · **Branch:** main
**Predecessor:** Build-33b empty-search honesty guard + the realworld honesty battery (`battery-realworld.json`, baseline 10/10).

---

## The problem (where the residual honesty risk moved)

Build-33b fixed *fabricate-from-nothing*: a live search that returns **zero** results no
longer lets M8 invent a scoreline. But when search returns **something**, M8 relays
whatever Tavily hands it, with a citation, and the battery scores any cited answer as
"grounded." It cannot tell a Reuters match report from a betting-site **prediction** page
or a fan-forum guess. So the new failure mode is **source-trust**:

- A confident answer resting on a **single weak source**.
- An answer that reads a **prediction / preview / schedule** page as if it were a
  **confirmed result** (the "over-read" risk the brief flags).
- Stale pages (old projections) outranking fresh coverage.

M8 should become **skeptical of weak sources** instead of relaying them flat.

## Non-goals

- No paid APIs, no new providers. Pure heuristics over data Tavily already returns
  (free Gemini/Tavily stack stays). Tavily results already carry `url`, `score`
  (relevance 0-1), and — on the NEWS topic — `published_date`.
- We do NOT block or drop results. We **rank + annotate + add a hedging directive**.
  The model still sees everything; we change ordering and tell it when to hedge.
- No change to which queries route to search (that's task #2, separate build).

---

## Design — `lib/sourceTrust.js` (new, pure, no I/O)

A small data-driven module so the PowerShell test can mirror it exactly (no Node on this box).

### Domain classification — `classifyDomain(url) -> { tier, weight, domain }`

Extract the registrable domain from the URL, lowercase, strip `www.`. Classify into a
tier with a numeric weight (higher = more trustworthy):

| tier | weight | what it catches |
|---|---|---|
| `official`   | 5 | `.gov` / `.edu` / `.int` TLDs; official-org allowlist (e.g. `fifa.com`, `uefa.com`, `nasa.gov`, `who.int`) |
| `reputable`  | 4 | wire/major-outlet allowlist (reuters, apnews, bbc, nytimes, theguardian, aljazeera, espn, bloomberg, ft, wsj, …) |
| `reference`  | 3 | `wikipedia.org`, `britannica.com` (solid but tertiary) |
| `unknown`    | 2 | default — anything not on a list and not a red flag |
| `forum`      | 1 | `reddit.com`, `quora.com`, `*.fandom.com`, `medium.com`, `stackexchange`-style UGC |
| `prediction` | 0 | red-flag: domain OR path contains `predict`, `betting`, `odds`, `forebet`, `tips`/`tipster`, `forecast`, `preview` — i.e. NOT a result page |

Lists live as arrays at the top of the module (easy to extend; the test reads the same shape).

### Recency — `recencyBucket(published_date, now) -> { bucket, ageDays }`

Only meaningful when `published_date` exists (NEWS topic). Buckets: `fresh` (<= 3 days),
`recent` (<= 30), `dated` (<= 365), `stale` (> 365), `unknown` (no date). Used as a
tie-breaker and to mark stale pages — never as a hard filter.

### Assessment — `assessResults(results, now) -> { ranked, verdict }`

- `ranked`: results stably sorted by `(weight desc, freshness desc, tavily score desc)`,
  each annotated `{ tier, weight, domain, bucket, ageDays }`.
- `verdict`: deterministic flags computed over the set:
  - `count`
  - `topTier` / `topWeight` (best source present)
  - `singleWeakSource`: exactly one result, OR every result at `weight <= 1`
    (forum/prediction only) — answer rests on weak ground.
  - `predictionHeavy`: a prediction/preview page is among the top-2 by rank — over-read risk.
  - `allStale`: every dated result is `stale` (and none undated-but-fresh) — likely old projections.
  - `mixedTrust`: top tier >= reputable but a prediction page is also present — tell the
    model to prefer the strong source and not average them.

`assessResults` is **total and pure**: empty/garbage input -> `{ ranked: [], verdict: { count: 0 } }`.

---

## Wiring — `lib/orchestrator.js` (the search-injection block, ~line 1118)

1. Call `assessResults(searchData.results, new Date())` and build the snippet list from
   **`ranked`** (so the strongest source is `[1]`), annotating each line with its tier +
   domain + date:
   `[1] (reputable · espn.com · 2d ago) Title` / `[2] (prediction · forebet.com · preview) Title`.
2. After the existing per-intent `SEARCH_DIRECTIVES[intent]`, append a **SOURCE_TRUST
   directive** built from `verdict` — only the clauses that apply:
   - `singleWeakSource` → "This rests on a single low-credibility source — present it as
     provisional/unconfirmed, not established fact."
   - `predictionHeavy` / `mixedTrust` → "Some results are prediction/preview pages, NOT
     confirmed results. Do not state a predicted or scheduled outcome as a final result;
     prefer the higher-credibility source and say so if they disagree."
   - `allStale` → "The only dated sources are over a year old — flag that the information
     may be out of date."
   - none apply → no extra text (don't nag on clean, well-sourced answers).
3. The empty-search guard branch (Build-33b) is **unchanged**.

The `verifiedOutputContract("search")` line stays.

---

## Honesty invariants

- **Code computes the trust verdict; the LLM narrates the hedge.** No model input decides
  a source's tier — same doctrine as the fleet/lean/chart lanes.
- We never silently drop a source. Re-ordering + an explicit hedge directive only.
- The directive is **additive** to the existing anti-fabrication contract, never a relaxation.

## Tests

- `tests/source-trust-verify.ps1` — PS mirror of `classifyDomain` / `recencyBucket` /
  `assessResults` verdict logic (the lists + rules are data, so the mirror is faithful):
  official/reputable/forum/prediction classification, single-weak-source + prediction-heavy
  + all-stale verdict flags, ranking order (strong source floats to `[1]`, prediction
  sinks), and the empty/garbage -> count:0 total-function guard.
- Regression: `tool-decision-verify.ps1`, `fleet-routing-verify.ps1` (no orchestrator
  signature change, but the injection block moved).

## Proof (the measurement loop)

Re-run `tests/odysseus/run-battery.ps1 -File battery-realworld.json` on the deployed app
after ship; the honesty score is the evidence (target: hold 10/10, and the prediction/
single-source probes now hedge instead of asserting). Add a prediction-page over-read
probe to the battery if one isn't already covered (task #3 overlap).
