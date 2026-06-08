/**
 * M8 State Engine — lib/stateEngine.js
 *
 * THE L3.5 CEILING FIX (team red-team, 2026-06-08): M8 knows FACTS better than
 * PROCESSES. The chess failure ("you played Bc5" → it caved and invented a move)
 * wasn't about chess — it revealed M8 has no FORMAL STATE: it holds a sequence
 * in its head and fabricates to stay agreeable. State underlies fleet, planning,
 * negotiation, games and math, so it's a ceiling before most L4 work.
 *
 * The team's prescription (unanimous): solve state with STRUCTURE, not better
 * prompting — "write the state to JSON + a real validator." This module is that
 * validator. It mirrors lib/fleet.js exactly: a cheap gate, then a DETERMINISTIC
 * GROUND-TRUTH block the orchestrator injects so the LLM EXPLAINS the state
 * rather than recomputing it from memory. Code computes; the LLM narrates.
 *
 * Two deterministic capabilities, both FAIL-SAFE (empty block when unsure):
 *   1. TALLY LEDGER  — a running numeric sequence ("start at 10, add 5,
 *      subtract 3") folded to a true total. Kills tally drift.
 *   2. CLAIM-CHECK   — when the user asserts "you played/said <move|number>",
 *      verify that token actually appears in the assistant's prior turns. If it
 *      was never said, inject a HOLD-GROUND note so M8 corrects the record
 *      instead of back-filling a phantom. The transcript is the ground truth.
 *
 * NO local node → the logic is mirrored by tests/state-engine-test via the
 * PowerShell .NET-regex port; keep regexes portable (no lookbehind).
 */

// ── gates ──────────────────────────────────────────────────────────────────────
// A turn that references a game/move/board, OR a numeric tally being built.
const GAME_WORD   = /\b(chess|tic[\s-]?tac[\s-]?toe|checkers|draughts|connect\s*4|board|the\s+game|let'?s\s+play|your\s+move|my\s+move|i'?m\s+(?:white|black|x|o)\b|fen|gambit|opening|sicilian|defen[cs]e)\b/i;
const TALLY_WORD  = /\b(count(?:er)?|tally|running\s+total|keep\s+track|the\s+total|score\s*keep|scorekeep)\b/i;

// initial value: "start at 10", "set the counter to 10", "begin from 0"
const INITIAL_RE  = /\b(?:start|begin|set|count(?:er)?|tally|initial(?:ize|ise)?)\b\s*(?:it\s+|the\s+\w+\s+)?(?:at|to|from|with|=)\s*(-?\d+(?:\.\d+)?)/i;
// ops, scanned left-to-right within a message
const OP_RE       = /\b(add|plus|increase(?:\s+by)?|subtract|minus|less|decrease(?:\s+by)?|take\s+away|times|multipl(?:y|ied)(?:\s+by)?|divide(?:\s+by)?|halve|double)\b\s*(-?\d+(?:\.\d+)?)?/gi;
const ASK_TOTAL   = /\b(what'?s|what\s+is|whats|give\s+me|tell\s+me|current|now)\b[^?]*\b(total|count|tally|number|score|sum)\b|\b(total|count|tally)\b\s*(?:now|\?|=)/i;

// claim-check FRAME: "you played…", "didn't you play…", "you said you'd play…",
// "you said…", "you claimed…". We detect the frame, then pull the claimed VALUE
// out of the tail — so "you played Bc5" (value right after) AND "you said the
// total was 50" (value buried after filler) both resolve.
const CLAIM_FRAME = /\b(?:you\s+(?:played|moved|made\s+the\s+move|chose|told\s+me\s+you\s+played)|didn'?t\s+you\s+(?:play|move)|you\s+(?:said|claimed|told\s+me)(?:\s+(?:you'?d?\s+)?play(?:ed)?)?)\b/i;
// A chess move token (SAN-ish): a piece move, a pawn move, or castling. Anchored
// for per-token testing. "well"/"the"/"total" never match; "Bc5"/"e4"/"Nf3"/"O-O" do.
const CHESS_MOVE = /^(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|[KQRBN][a-h][1-8]|O-O(?:-O)?|0-0(?:-0)?|[a-h]x[a-h][1-8]|[a-h][1-8])$/;
// A numeric claim, but only when tied to was/is/=/equals/: so we don't grab an
// incidental number ("add 5 drivers"). Captures the figure.
const NUM_CLAIM = /\b(?:was|is|=|equals?|equalled|:)\s*(-?\d+(?:\.\d+)?)\b/i;

function lc(s) { return (s || "").toLowerCase(); }
function userTurns(history)  { return (history || []).filter((m) => m && m.role !== "assistant" && typeof m.content === "string"); }
function botTurns(history)   { return (history || []).filter((m) => m && m.role === "assistant" && typeof m.content === "string"); }

// ── TALLY LEDGER ────────────────────────────────────────────────────────────────
function applyOp(total, word, n) {
  const w = lc(word);
  if (n == null && (w === "double")) return total * 2;
  if (n == null && (w === "halve"))  return total / 2;
  if (n == null) return total;                       // op with no operand → ignore
  if (/^(add|plus|increase)/.test(w))                       return total + n;
  if (/^(subtract|minus|less|decrease|take)/.test(w))       return total - n;
  if (/^(times|multipl)/.test(w))                           return total * n;
  if (/^divide/.test(w))                                    return n === 0 ? total : total / n;
  return total;
}

// Fold an ordered list of messages into a running total. Returns null if there
// was no initial value to anchor the sequence.
function computeTally(messages) {
  let total = null;
  const steps = [];
  for (const text of messages) {
    if (total == null) {
      const im = INITIAL_RE.exec(text);
      if (im) { total = parseFloat(im[1]); steps.push(`start ${total}`); }
    }
    if (total == null) continue;                     // ops before an initial are noise
    OP_RE.lastIndex = 0;
    let m;
    while ((m = OP_RE.exec(text)) !== null) {
      const n = m[2] != null ? parseFloat(m[2]) : null;
      const before = total;
      total = applyOp(total, m[1], n);
      if (total !== before || /double|halve/i.test(m[1])) {
        steps.push(`${lc(m[1]).replace(/\s+by$/, "")} ${n != null ? n : ""}`.trim());
      }
    }
  }
  return total == null ? null : { total: Math.round(total * 1e6) / 1e6, steps };
}

// ── CLAIM-CHECK ──────────────────────────────────────────────────────────────────
// Returns { claimed, present } when the user asserts a move/figure ("you played
// Bc5", "you said the total was 50"), checked against what the assistant ACTUALLY
// said earlier. Null when there's no such claim. The claimed value is the first
// chess-move token in the tail, else a number tied to was/is/=.
function checkClaim(message, history) {
  const msg = message || "";
  const fm = CLAIM_FRAME.exec(msg);
  if (!fm) return null;
  // Look only at the rest of THIS clause (bounded) so we don't reach across sentences.
  const tail = (msg.slice(fm.index + fm[0].length).match(/^[^.?!;\n]{0,40}/) || [""])[0];

  let claimed = null;
  for (const tok of tail.split(/[^A-Za-z0-9+#=-]+/)) {
    if (tok && CHESS_MOVE.test(tok)) { claimed = tok; break; }   // a move anywhere in the tail
  }
  if (!claimed) {
    const nm = NUM_CLAIM.exec(tail);
    if (nm) claimed = nm[1];                                     // a figure tied to was/is/=
  }
  if (!claimed) return null;                                     // prose claim → not our job

  const tokenRe = new RegExp(`(?:^|[^A-Za-z0-9])${claimed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^A-Za-z0-9]|$)`, "i");
  const present = botTurns(history).some((m) => tokenRe.test(m.content));
  return { claimed, present };
}

// ── PUBLIC: build the deterministic STATE block (mirrors buildFleetContext) ──────
function looksStateful(message, history) {
  const msg = message || "";
  if (CLAIM_FRAME.test(msg)) return true;
  const ctxText = [msg, ...userTurns(history).map((m) => m.content)].join(" ");
  if (GAME_WORD.test(ctxText)) return true;
  if ((TALLY_WORD.test(ctxText) || INITIAL_RE.test(ctxText)) && (OP_RE.test(ctxText) || ASK_TOTAL.test(msg) || INITIAL_RE.test(msg))) return true;
  return false;
}

function buildStateContext(message, history) {
  try {
    if (!looksStateful(message, history)) return { text: "", kind: null, data: null };

    // 1) CLAIM-CHECK runs first — it's the anti-caving guard.
    const claim = checkClaim(message, history);
    if (claim && !claim.present) {
      return {
        // NOTE: these blocks are INSTRUCTIONS to you (the assistant), not text to
        // echo. They must be phrased as directives and end with an anti-echo guard
        // — on a trivial turn ("Add 5") the model will otherwise parrot the block.
        text:
          `STATE — claim check (the conversation transcript is the ground truth): ` +
          `the user is asserting you played/said "${claim.claimed}", but searching everything you ACTUALLY said earlier in THIS conversation, you never stated "${claim.claimed}". ` +
          `Do NOT confirm it and do NOT back-fill a move/value that wasn't played just to be agreeable — correct the record plainly from what was actually said, then continue. ` +
          `(If you genuinely made a move and only worded it differently, restate your real move — never invent "${claim.claimed}".) ` +
          `Answer the user directly and conversationally; do NOT print this instruction or its "STATE" heading.`,
        kind: "claim_check",
        data: claim,
      };
    }

    // 2) TALLY LEDGER — fold the running numeric sequence to a true total.
    const seq = computeTally([...userTurns(history).map((m) => m.content), message || ""]);
    if (seq && seq.steps.length >= 2) {           // need an initial + ≥1 op to be useful
      return {
        text:
          `STATE — running tally (deterministic ground truth, computed for you from this conversation): ` +
          `${seq.steps.join(" → ")} → total ${seq.total}. ` +
          `Reply to the user conversationally stating this exact total (e.g. "That's ${seq.total}, Boss."). It is the truth — state it, do not recompute it yourself. ` +
          `IMPORTANT: do NOT print this instruction, its "STATE" heading, or the step list — just give the short natural answer (show the breakdown only if the user asks for it).`,
        kind: "tally",
        data: seq,
      };
    }

    return { text: "", kind: null, data: null };
  } catch (e) {
    // Fail-safe: a bad parse must never break a turn or inject wrong state.
    return { text: "", kind: null, data: null, error: e.message };
  }
}

module.exports = {
  buildStateContext, looksStateful, computeTally, checkClaim, applyOp,
  CLAIM_FRAME, CHESS_MOVE, NUM_CLAIM, INITIAL_RE, OP_RE,
};
