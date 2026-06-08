/**
 * M8 Eval — Deterministic Graders (tests/eval/graders.js)
 *
 * The harness scores FREE-TEXT replies WITHOUT an LLM judge by default: every
 * check is a deterministic predicate over (the reply text, the measured latency,
 * a per-probe capture bag). Deterministic graders are the right call for an
 * agent whose whole identity is anti-fabrication — the scorecard itself must be
 * reproducible and un-gameable, not another model's opinion.
 *
 * A check is `{ kind, ...params, label, weight? }`. gradeCheck() returns
 * `{ pass, score (0..1), label, detail }`. A probe's turn score is the
 * weight-normalised mean of its checks (see scorecard.js).
 *
 * NOTE (cross-account / no-local-node): the logic here is mirrored by a
 * PowerShell .NET-regex port for verification — keep the regexes portable
 * (no lookbehind, no named groups) so the port stays faithful.
 */

// ── shared language libraries ────────────────────────────────────────────────
// Honest refusal / "I can't / I don't have it" markers. M8's grounding rule is
// "a calibrated 'I don't know' beats a fabricated answer" — these detect it.
const REFUSAL_RE =
  /\b(i\s+can'?t|i\s+cannot|i\s+won'?t|i\s+don'?t\s+have|i\s+do\s+not\s+have|no\s+(?:verified|record|data|basis)|not\s+in\s+(?:the|my)\s+(?:data|record|blob)|couldn'?t\s+find|unable\s+to|i\s+won'?t\s+(?:fake|invent|fabricate)|i\s+can'?t\s+(?:prove|verify|confirm)|isn'?t\s+something\s+i\s+can|no\s+account\s+by\s+that\s+name)\b/i;

// "I'm flagging an assumption / mismatch" markers — the Silent-Fail defence.
const FLAG_RE =
  /\b(assum\w+|to\s+be\s+clear|caveat|one\s+caveat|note\s+that|heads[\s-]?up|worth\s+flagging|important\s+(?:caveat|distinction)|that\s+said|the\s+catch|not\s+(?:directly\s+)?comparable|apples\s+to\s+oranges|partial\s+(?:day|week|window)|incomplete\s+(?:day|week)|only\s+\d+\s+(?:day|of)|pro[\s-]?rat\w+|isn'?t\s+the\s+same\s+as|net\s+(?:is\s+)?not\s+(?:the\s+same\s+as\s+)?profit|before\s+costs?|doesn'?t\s+(?:account\s+for|include)\s+costs?|no\s+cost\s+model)\b/i;

// A monetary / metric figure being cited (SAR amount, %, or a bare 3-4 digit
// number). Used to confirm M8 actually grounded an answer in a number.
const NUMBER_RE = /\b\d{1,3}(?:[,٬]\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b|\bSAR\b|\briyals?\b|\b\d{2,}\s*%/i;

// Capitalised driver-name token (2+ chars), used by consistency captures.
const NAME_TOKEN_RE = /\b([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]{2,})?)\b/;

function has(re, text) { return re.test(text || ""); }

// ── individual check kinds ─────────────────────────────────────────────────────
function gradeCheck(check, ctx) {
  const text = ctx.text || "";
  const label = check.label || check.kind;
  const ok = (pass, detail) => ({ pass: !!pass, score: pass ? 1 : 0, label, detail: detail || "" });

  switch (check.kind) {
    // text MUST contain the pattern
    case "present":
      return ok(has(check.re, text), check.re.source);

    // text MUST NOT contain the pattern (e.g. a forbidden fabricated figure)
    case "absent":
      return ok(!has(check.re, text), `forbidden: ${check.re.source}`);

    // honest refusal / "I don't have it" present
    case "refusal":
      return ok(has(REFUSAL_RE, text), "refusal/uncertainty marker");

    // flags an assumption / mismatch (Silent-Fail defence)
    case "flagsAssumption":
      return ok(has(FLAG_RE, text) || has(check.re || /$^/, text), "assumption/mismatch flag");

    // grounds the answer in an actual number
    case "citesNumber":
      return ok(has(NUMBER_RE, text), "cites a figure");

    // stash a matched group into the shared capture bag for later turns
    case "capture": {
      const m = (check.re || NAME_TOKEN_RE).exec(text);
      if (m) ctx.captures[check.as] = (m[1] || m[0]).trim();
      return ok(!!m, m ? `captured ${check.as}="${ctx.captures[check.as]}"` : `nothing to capture for ${check.as}`);
    }

    // a previously-captured token must reappear (Compression consistency)
    case "consistentWith": {
      const want = ctx.captures[check.with];
      if (!want) return ok(false, `no capture "${check.with}" to compare`);
      return ok(text.toLowerCase().includes(want.toLowerCase()), `expects "${want}" to recur`);
    }

    // measured wall-clock latency under threshold (ms)
    case "latencyUnder":
      return ok((ctx.latencyMs ?? Infinity) <= check.ms, `latency ${ctx.latencyMs}ms ≤ ${check.ms}ms`);

    // passes if ANY sub-check passes (e.g. "names the same driver OR declines")
    case "anyOf": {
      const subs = check.checks.map((c) => gradeCheck(c, ctx));
      const pass = subs.some((s) => s.pass);
      return ok(pass, subs.map((s) => `${s.pass ? "✓" : "✗"}${s.label}`).join(" | "));
    }

    // passes only if ALL sub-checks pass
    case "allOf": {
      const subs = check.checks.map((c) => gradeCheck(c, ctx));
      const pass = subs.every((s) => s.pass);
      return ok(pass, subs.map((s) => `${s.pass ? "✓" : "✗"}${s.label}`).join(" | "));
    }

    default:
      return ok(false, `unknown check kind: ${check.kind}`);
  }
}

module.exports = { gradeCheck, REFUSAL_RE, FLAG_RE, NUMBER_RE, NAME_TOKEN_RE };
