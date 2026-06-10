/**
 * M8 End-of-Service (EOSB) + notice calculator — lib/eosb.js
 *
 * Operator-assistant breadth: the verified-compute lane pointed at a real legal
 * number. The honest split that makes this OK (vs the legal playbook's "never
 * state the formula from memory"):
 *   - CODE owns the ARITHMETIC — deterministic, exact (like the fleet/finance spine).
 *   - The packet is TRANSPARENT about the RULE it applied and FLAGS it to verify
 *     (rules change), names the assumptions (wage basis, contract type), and
 *     ESCALATES for an actual payout/dispute. It NEVER presents the figure as a
 *     definitive legal entitlement.
 * So this is "under the standard Labour-Law formula [stated], the math gives X —
 * confirm the rule is current", NOT "the law says exactly X".
 *
 * Standard Saudi Labour Law end-of-service AWARD (the long-standing formula):
 *   - ½ month's wage per year for the first 5 years of service,
 *   - 1 month's wage per year for each year beyond 5,
 *   - partial years pro-rated.
 * Resignation (employee-initiated, unlimited-term contract) REDUCES the award:
 *   - under 2 years  → nothing
 *   - 2 to under 5   → one-third
 *   - 5 to under 10  → two-thirds
 *   - 10 years+      → full
 * Employer termination (not for cause) / end of a fixed term → the full award.
 *
 * buildEOSBContext(message) → { text, data } (empty when not an EOSB turn).
 * Never throws.
 */

// ── input extraction ─────────────────────────────────────────────────────────
// Monthly wage: a number tied to salary/wage/earns/month, or a bare amount with SAR.
function extractWage(message) {
  const s = message || "";
  const pats = [
    /\b(?:salary|wage|pay|earns?|earning|making|makes|paid)\s*(?:of|is|=|:|at)?\s*(?:sar|﷼|riyals?)?\s*([\d][\d,\.]*)/i,
    /\b([\d][\d,\.]*)\s*(?:sar|﷼|riyals?)\s*(?:\/?\s*(?:a\s+)?month|monthly|per\s+month|\/mo)?/i,
    /\b([\d][\d,\.]*)\s*(?:\/?\s*(?:a\s+)?month|monthly|per\s+month|\/mo)/i,
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

// Years of service: "7 years", "4.5 yrs", optionally "+ N months"; or bare "N months".
function extractYears(message) {
  const s = message || "";
  let years = null;
  const ym = s.match(/\b(\d+(?:\.\d+)?)\s*(?:years?|yrs?|yr)\b/i);
  if (ym) years = parseFloat(ym[1]);
  const mm = s.match(/\b(\d+(?:\.\d+)?)\s*(?:months?|mos?)\b/i);
  if (mm) {
    const months = parseFloat(mm[1]);
    if (!isNaN(months)) years = (years || 0) + months / 12;
  }
  return (years != null && !isNaN(years) && years >= 0) ? years : null;
}

// Reason: resignation vs employer-termination (default termination = full award).
const RESIGN_RE = /\b(resign\w*|quit\w*|stepp?ing?\s+down|left\s+(?:voluntarily|on\s+(?:his|her|their)\s+own)|hands?\s+in\s+(?:his|her|their)\s+notice)\b/i;
const TERMINATE_RE = /\b(fir(?:e|ed|ing)|terminat\w*|let\s+(?:him|her|them|go)|lay(?:ing)?\s*off|laid\s+off|dismiss\w*|made\s+redundant|end(?:ing)?\s+(?:his|her|their|the)\s+contract|contract\s+end\w*|not\s+renew\w*)\b/i;
function extractReason(message) {
  const s = message || "";
  if (RESIGN_RE.test(s)) return "resignation";
  if (TERMINATE_RE.test(s)) return "termination";
  return null; // unknown → caller defaults to termination but flags the assumption
}

// ── detection ────────────────────────────────────────────────────────────────
// Fires on an end-of-service / severance ASK (not a generic "end of service"
// mention) — needs the EOSB topic AND either a calc verb or the numeric inputs.
const EOSB_TOPIC = /\b(end[\s-]?of[\s-]?service|eosb|gratuity|severance|نهاية\s*الخدمة|مكافأة\s*نهاية)\b/i;
const EOSB_CALC_VERB = /\b(calculate|compute|work\s+out|how\s+much|what'?s|figure\s+out|owe|entitled|payout|pay\s+out)\b/i;
function looksEOSB(message) {
  const s = message || "";
  if (!EOSB_TOPIC.test(s)) return false;
  return EOSB_CALC_VERB.test(s) || (extractWage(s) != null && extractYears(s) != null);
}

// ── the deterministic computation (code owns the arithmetic) ──────────────────
function computeEOSB({ wage, years, reason }) {
  const w = Number(wage), y = Number(years);
  const first5 = Math.min(y, 5);
  const beyond5 = Math.max(0, y - 5);
  const baseAward = first5 * 0.5 * w + beyond5 * 1.0 * w;   // full award (termination basis)

  let fraction = 1;
  let fractionLabel = "full award (employer termination / end of fixed term)";
  if (reason === "resignation") {
    if (y < 2)       { fraction = 0;     fractionLabel = "nothing (resigned with under 2 years' service)"; }
    else if (y < 5)  { fraction = 1 / 3; fractionLabel = "one-third (resigned, 2 to under 5 years)"; }
    else if (y < 10) { fraction = 2 / 3; fractionLabel = "two-thirds (resigned, 5 to under 10 years)"; }
    else             { fraction = 1;     fractionLabel = "full award (resigned with 10+ years)"; }
  }
  const amount = baseAward * fraction;
  return { wage: w, years: y, reason, first5, beyond5, baseAward, fraction, fractionLabel, amount };
}

// ── packet (ground truth arithmetic + transparent, flagged rule) ──────────────
function fmtSar(v) { return (v == null || isNaN(v)) ? "?" : Math.round(v).toLocaleString("en-US"); }

function renderEOSBPacket(c, assumedReason) {
  const r = computeEOSB(c);
  const reasonWord = c.reason === "resignation" ? "resignation" : "employer termination / end of contract";
  const lines = [
    `EOSB CALCULATION (the ARITHMETIC below is deterministic ground truth — quote it; the RULE is the standard Saudi Labour Law end-of-service formula, which must be confirmed current).`,
    `Inputs: wage ${fmtSar(r.wage)} SAR/month · ${r.years} year(s) of service · reason: ${reasonWord}.`,
    `Rule applied: ½ month's wage per year for the first 5 years + 1 month's wage per year beyond 5${c.reason === "resignation" ? ", then the resignation reduction" : ""}.`,
    `Full award (before any reduction): ${fmtSar(r.baseAward)} SAR  [first 5 yrs: ${fmtSar(r.first5 * 0.5 * r.wage)} SAR + beyond 5 (${r.beyond5} yr): ${fmtSar(r.beyond5 * r.wage)} SAR].`,
    `Applied: ${r.fractionLabel}.`,
    `ESTIMATED END-OF-SERVICE AWARD: ${fmtSar(r.amount)} SAR.`,
    `YOU MUST STATE these caveats (do not present this as a definitive legal entitlement): (1) the arithmetic is exact, but CONFIRM the formula is current and the exact WAGE BASIS on Qiwa/MHRSD — the Labour Law's "wage" can include allowances (housing/transport), not just basic, which changes the number; (2) this assumes an UNLIMITED-TERM contract — a fixed-term contract's resignation/end rules differ; (3) for an actual payout or any dispute, verify with a licensed Saudi lawyer or MHRSD. Offer to recompute on the basic-vs-full wage or different inputs.`,
  ];
  if (assumedReason) {
    lines.push(`NOTE: the reason (resignation vs termination) wasn't stated, so this assumed EMPLOYER TERMINATION (the full award). If the worker RESIGNED, the award is reduced — tell Boss and offer to recompute.`);
  }
  return lines.join("\n");
}

function renderNeedInputs(missing, have) {
  const haveBits = [];
  if (have.wage != null) haveBits.push(`wage ${fmtSar(have.wage)} SAR/month`);
  if (have.years != null) haveBits.push(`${have.years} year(s) of service`);
  if (have.reason) haveBits.push(`reason: ${have.reason}`);
  return [
    `EOSB CALCULATION — missing inputs (do NOT guess them; ask Boss for the missing piece, then it computes exactly).`,
    haveBits.length ? `Have: ${haveBits.join(" · ")}.` : `Have: nothing parseable yet.`,
    `Need: ${missing.join(" and ")}.`,
    `Ask for the missing input(s) in one short line. Once you have the monthly wage and the years of service (and whether the worker resigned or was let go), the end-of-service award is a deterministic calculation. (Standard Saudi Labour Law formula — ½ month/yr for the first 5 years, 1 month/yr after; resignation reduces it — confirm it's current on Qiwa/MHRSD.)`,
  ].join("\n");
}

// ── orchestrator entry point ──────────────────────────────────────────────────
function buildEOSBContext(message) {
  if (!looksEOSB(message)) return { text: "", data: null };
  try {
    const wage = extractWage(message);
    const years = extractYears(message);
    let reason = extractReason(message);
    const assumedReason = reason == null;
    if (reason == null) reason = "termination";

    const missing = [];
    if (wage == null) missing.push("the monthly wage (SAR)");
    if (years == null) missing.push("the years of service");
    if (missing.length) {
      return { text: renderNeedInputs(missing, { wage, years, reason: extractReason(message) }), data: { wage, years, missing }, mode: "need_inputs" };
    }

    const data = computeEOSB({ wage, years, reason });
    return { text: renderEOSBPacket({ wage, years, reason }, assumedReason), data, mode: "computed" };
  } catch (err) {
    console.error("[M8] eosb error (non-fatal):", err.message);
    return { text: "", data: null };
  }
}

module.exports = {
  buildEOSBContext, looksEOSB, computeEOSB,
  extractWage, extractYears, extractReason,
  renderEOSBPacket, renderNeedInputs,
};
