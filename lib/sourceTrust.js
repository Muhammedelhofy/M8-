/**
 * M8 Source-Trust — lib/sourceTrust.js  (Build-35)
 *
 * Pure, no-I/O heuristics that rank + flag web-search (Tavily) results by source
 * CREDIBILITY and RECENCY before they are injected into the prompt.
 *
 * WHY THIS EXISTS: the empty-search guard (Build-33b) stopped M8 from inventing an
 * answer when search returns NOTHING. But when search returns SOMETHING, M8 used to
 * relay whatever Tavily handed it — a Reuters match report and a betting-site
 * PREDICTION page looked identical to the model, and the honesty battery scored any
 * cited answer as "grounded." This module makes the SET of results legible: it sorts
 * the strongest source to [1], tags each with a tier + recency, and computes a
 * deterministic verdict the orchestrator turns into a hedging directive.
 *
 * DOCTRINE: code computes the trust verdict, the LLM narrates the hedge. No model
 * input decides a source's tier. We NEVER drop a result — only re-order + annotate +
 * (when warranted) tell the model to hedge. Same "code computes / LLM narrates"
 * pattern as the fleet, lean, and chart lanes.
 *
 * Data-driven on purpose: the domain lists + rules are plain arrays/thresholds so the
 * PowerShell test (no Node on this box) can mirror the logic faithfully.
 */

// ── Domain lists (extend freely; the test reads the same shape) ──────────────
// Registrable-domain substrings. Matched against the host with `www.` stripped.

// Official primary sources (also: any .gov/.edu/.int TLD, handled in classifyDomain).
const OFFICIAL_DOMAINS = [
  "fifa.com", "uefa.com", "olympics.com", "olympic.org",
  "nasa.gov", "esa.int", "who.int", "un.org", "europa.eu",
  "premierleague.com", "nba.com", "fiba.basketball", "icc-cricket.com",
];

// Reputable wires / major outlets.
const REPUTABLE_DOMAINS = [
  "reuters.com", "apnews.com", "bbc.com", "bbc.co.uk", "nytimes.com",
  "theguardian.com", "aljazeera.com", "espn.com", "espn.co.uk",
  "bloomberg.com", "ft.com", "wsj.com", "cnn.com", "npr.org",
  "washingtonpost.com", "economist.com", "skysports.com", "goal.com",
  "arabnews.com", "thenationalnews.com", "spa.gov.sa",
];

// Solid but tertiary reference works.
const REFERENCE_DOMAINS = ["wikipedia.org", "britannica.com"];

// User-generated / forum content — real but unvetted.
const FORUM_DOMAINS = [
  "reddit.com", "quora.com", "fandom.com", "medium.com",
  "stackexchange.com", "stackoverflow.com", "answers.com", "wikihow.com",
  "facebook.com", "twitter.com", "x.com", "instagram.com", "tiktok.com",
];

// Red-flag tokens (in the host OR the path) that mark a PREDICTION / preview /
// betting page — i.e. NOT a result/fact page. These dominate any list membership.
const PREDICTION_TOKENS = [
  "predict", "betting", "bet365", "odds", "forebet", "tipster", "tips",
  "forecast", "preview", "wager", "bookmaker", "punter", "accumulator",
];

const TIER_WEIGHT = {
  official:   5,
  reputable:  4,
  reference:  3,
  unknown:    2,
  forum:      1,
  prediction: 0,
};

// ── URL → domain ─────────────────────────────────────────────────────────────
function domainOf(url) {
  if (typeof url !== "string" || !url) return "";
  let host = url.trim();
  // strip scheme
  host = host.replace(/^[a-z]+:\/\//i, "");
  // drop path/query/fragment
  host = host.split(/[/?#]/)[0];
  // drop port + userinfo
  host = host.split("@").pop().split(":")[0];
  host = host.toLowerCase().replace(/^www\./, "");
  return host;
}

function pathOf(url) {
  if (typeof url !== "string" || !url) return "";
  const noScheme = url.trim().replace(/^[a-z]+:\/\//i, "");
  const slash = noScheme.indexOf("/");
  return (slash === -1 ? "" : noScheme.slice(slash)).toLowerCase();
}

function hostMatches(host, list) {
  return list.some((d) => host === d || host.endsWith("." + d));
}

// ── classifyDomain(url) → { tier, weight, domain } ───────────────────────────
function classifyDomain(url) {
  const domain = domainOf(url);
  if (!domain) return { tier: "unknown", weight: TIER_WEIGHT.unknown, domain: "" };

  const haystack = domain + " " + pathOf(url);
  // Prediction/preview red flag dominates — a betting site's match "result" page is
  // still a prediction, and a reputable outlet's /preview/ URL is not a result.
  if (PREDICTION_TOKENS.some((t) => haystack.includes(t))) {
    return { tier: "prediction", weight: TIER_WEIGHT.prediction, domain };
  }

  const tld = domain.split(".").pop();
  if (tld === "gov" || tld === "edu" || tld === "int" || hostMatches(domain, OFFICIAL_DOMAINS)) {
    return { tier: "official", weight: TIER_WEIGHT.official, domain };
  }
  if (hostMatches(domain, REPUTABLE_DOMAINS)) {
    return { tier: "reputable", weight: TIER_WEIGHT.reputable, domain };
  }
  if (hostMatches(domain, REFERENCE_DOMAINS)) {
    return { tier: "reference", weight: TIER_WEIGHT.reference, domain };
  }
  if (hostMatches(domain, FORUM_DOMAINS)) {
    return { tier: "forum", weight: TIER_WEIGHT.forum, domain };
  }
  return { tier: "unknown", weight: TIER_WEIGHT.unknown, domain };
}

// ── recencyBucket(published_date, now) → { bucket, ageDays } ──────────────────
const DAY_MS = 24 * 60 * 60 * 1000;
function recencyBucket(publishedDate, now) {
  if (!publishedDate) return { bucket: "unknown", ageDays: null };
  const t = Date.parse(publishedDate);
  if (Number.isNaN(t)) return { bucket: "unknown", ageDays: null };
  const ref = (now instanceof Date ? now.getTime() : Date.parse(now)) || Date.now();
  const ageDays = Math.max(0, Math.round((ref - t) / DAY_MS));
  let bucket;
  if      (ageDays <= 3)   bucket = "fresh";
  else if (ageDays <= 30)  bucket = "recent";
  else if (ageDays <= 365) bucket = "dated";
  else                     bucket = "stale";
  return { bucket, ageDays };
}

// freshness rank for sorting (higher = fresher); unknown sits in the middle so an
// undated result never outranks a fresh one nor sinks below a stale one.
const FRESH_RANK = { fresh: 4, recent: 3, unknown: 2, dated: 1, stale: 0 };

// ── assessResults(results, now) → { ranked, verdict } ────────────────────────
function assessResults(results, now) {
  if (!Array.isArray(results) || results.length === 0) {
    return { ranked: [], verdict: { count: 0, topTier: null, topWeight: null,
      singleWeakSource: false, predictionHeavy: false, allStale: false, mixedTrust: false } };
  }

  const annotated = results.map((r, idx) => {
    const c = classifyDomain(r && r.url);
    const rec = recencyBucket(r && (r.published_date || r.publishedDate), now);
    const score = typeof (r && r.score) === "number" ? r.score : 0;
    return {
      ...r,
      _idx: idx,            // stable-sort tiebreak (preserve Tavily order on full ties)
      tier: c.tier,
      weight: c.weight,
      domain: c.domain,
      bucket: rec.bucket,
      ageDays: rec.ageDays,
      _score: score,
    };
  });

  const ranked = annotated.slice().sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    const fr = FRESH_RANK[b.bucket] - FRESH_RANK[a.bucket];
    if (fr !== 0) return fr;
    if (b._score !== a._score) return b._score - a._score;
    return a._idx - b._idx;
  });

  const weights = ranked.map((r) => r.weight);
  const topWeight = weights[0];
  const topTier = ranked[0].tier;

  const datedOrWorse = ranked.filter((r) => r.bucket === "dated" || r.bucket === "stale");
  const anyFresh = ranked.some((r) => r.bucket === "fresh" || r.bucket === "recent");

  const verdict = {
    count: ranked.length,
    topTier,
    topWeight,
    // one result, or every result forum/prediction-grade (weight <= 1)
    singleWeakSource: ranked.length === 1 || weights.every((w) => w <= 1),
    // a prediction/preview page sits in the top 2 by rank — over-read risk
    predictionHeavy: ranked.slice(0, 2).some((r) => r.tier === "prediction"),
    // every dated source is over a year old and nothing fresh is present
    allStale: datedOrWorse.length > 0 && datedOrWorse.every((r) => r.bucket === "stale") && !anyFresh,
    // a strong source AND a prediction page coexist — don't average them
    mixedTrust: topWeight >= TIER_WEIGHT.reputable && ranked.some((r) => r.tier === "prediction"),
  };

  return { ranked, verdict };
}

// ── buildSourceTrustDirective(verdict) → string ('' when nothing to flag) ─────
function buildSourceTrustDirective(verdict) {
  if (!verdict || !verdict.count) return "";
  const clauses = [];
  if (verdict.singleWeakSource) {
    clauses.push(
      "This answer rests on a single low-credibility source. Present it as provisional " +
      "and unconfirmed — not as established fact — and say so plainly."
    );
  }
  if (verdict.predictionHeavy || verdict.mixedTrust) {
    clauses.push(
      "Some of these results are prediction / preview / betting pages, NOT confirmed " +
      "results. Do NOT state a predicted or scheduled outcome as a final result. Prefer " +
      "the higher-credibility source, and if the sources disagree, say which you trust and why."
    );
  }
  if (verdict.allStale) {
    clauses.push(
      "The only dated sources here are over a year old — warn that this information may " +
      "be out of date and offer to re-check."
    );
  }
  if (clauses.length === 0) return "";
  return "SOURCE-TRUST CHECK (code-assessed, follow it): " + clauses.join(" ");
}

// short human label for the snippet annotation, e.g. "reputable · espn.com · 2d ago"
function trustLabel(r) {
  const parts = [r.tier, r.domain || "?"];
  if (r.bucket && r.bucket !== "unknown") {
    parts.push(r.ageDays === 0 ? "today" : r.ageDays != null ? `${r.ageDays}d ago` : r.bucket);
  }
  return parts.join(" · ");
}

module.exports = {
  classifyDomain,
  recencyBucket,
  assessResults,
  buildSourceTrustDirective,
  trustLabel,
  domainOf,
  // exported for the test mirror / future tuning
  TIER_WEIGHT, OFFICIAL_DOMAINS, REPUTABLE_DOMAINS, REFERENCE_DOMAINS,
  FORUM_DOMAINS, PREDICTION_TOKENS,
};
