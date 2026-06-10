/**
 * M8 Deck Generator — lib/deckgen.js
 *
 * Operator-assistant breadth #2 (after the verified P&L): presentations.
 * Extends the docgen philosophy — TEMPLATE owns the slide skeleton, the LLM fills
 * CONTENT only — but emits a STRUCTURED DECK SPEC (not prose), so one planning
 * brain feeds MANY format renderers deterministically:
 *
 *   request → deck SPEC (LLM content on a fixed skeleton) → renderMarp / renderRevealHTML / (PPTX)
 *
 * The spec is the shared intermediate representation every delivery option reuses
 * (copy-ready text, Supabase-Storage file URLs, or future frontend download
 * buttons). Renderers are PURE + deterministic → port-verifiable with no node.
 *
 * GROUNDING: same contract as docgen — concrete content, NO placeholder filler,
 * and never invent figures (preserve real numbers/names from the request/memory).
 */
const { generate } = require("./llm");

// Fixed slide skeletons — code owns structure; the LLM never adds/removes slides.
const DECK_TEMPLATES = {
  deck_brief:    { title: "5-Slide Brief", slides: ["Title", "Current Situation", "The Problem", "Recommendation", "Next Steps"] },
  deck_proposal: { title: "Proposal Deck", slides: ["Title", "Executive Summary", "Current State", "Problems", "Proposed Solution", "Plan & Timeline", "Next Steps"] },
  deck_update:   { title: "Status Update", slides: ["Title", "Where We Are", "What Shipped", "Metrics", "Risks & Blockers", "Next Steps"] },
};

// Detection — is this a deck/presentation request?
const DECK_RE = /\b(decks?|slides?|slide\s*deck|presentations?|pitch(?:\s*deck)?|power\s?point|ppt|pptx|keynote)\b/i;
function looksDeck(message) { return DECK_RE.test(message || ""); }

// Deterministic template choice (no LLM): proposal vs status-update vs default brief.
function planDeck(message) {
  const m = (message || "").toLowerCase();
  if (/\bproposal\b/.test(m)) return "deck_proposal";
  if (/\b(status|update|progress|weekly|standup|stand-up)\b/.test(m)) return "deck_update";
  return "deck_brief";
}

function parseJsonLoose(text) {
  if (!text || typeof text !== "string") return null;
  let s = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}

// Normalize an LLM spec to a SAFE shape: cap lengths, cap bullets, drop empty
// slides, never trust the LLM to have produced valid structure. Returns null if
// nothing usable came back (caller falls back).
function normalizeSpec(parsed, tpl) {
  const rawSlides = Array.isArray(parsed?.slides) ? parsed.slides : [];
  const slides = rawSlides.map((s) => ({
    title: String(s?.title || "").trim().slice(0, 120),
    bullets: (Array.isArray(s?.bullets) ? s.bullets : [])
      .map((b) => String(b == null ? "" : b).trim().slice(0, 200))
      .filter(Boolean)
      .slice(0, 6),
    notes: s?.notes ? String(s.notes).trim().slice(0, 400) : "",
  })).filter((s) => s.title || s.bullets.length);
  if (!slides.length) return null;
  return {
    title: String(parsed?.title || tpl.title).trim().slice(0, 120),
    subtitle: String(parsed?.subtitle || "").trim().slice(0, 160),
    slides,
  };
}

async function generateDeckSpec({ message, history, memoryBlock }) {
  const key = planDeck(message);
  const tpl = DECK_TEMPLATES[key];
  const skeleton = tpl.slides.map((s, i) => `${i + 1}. ${s}`).join("\n");

  const system =
`You are M8 producing a ${tpl.title} for Muhammad ("Boss") — operations manager in Riyadh (Bolt KSA bike fleet; courier supply for Hunger Station / Noon / Keeta / Uber; also YouTube + AI building).
Output ONLY JSON — no prose, no markdown, no code fences:
{"title":"<deck title>","subtitle":"<one line>","slides":[{"title":"<slide title>","bullets":["<tight bullet>", ...],"notes":"<1-2 sentence speaker notes>"}]}

Use EXACTLY this slide sequence — do NOT add, remove, reorder, or rename slides:
${skeleton}

Rules:
- Concrete content tailored to his request and context. NO placeholders, NO "[insert]", NO filler.
- 3-5 tight, parallel bullets per slide (the Title slide may have 0-2). Keep bullets short — they are projected, not read as paragraphs.
- "notes" = brief talking points for that slide.
- Preserve real numbers, names, and dates from the request/memory EXACTLY; do NOT invent figures or facts. If a number isn't given, speak qualitatively rather than inventing one.${memoryBlock ? "\n- Use the RELEVANT MEMORY for personalization where it fits." : ""}`;

  const userMsg = memoryBlock
    ? `Request: ${message}\n\nRELEVANT MEMORY:\n${memoryBlock}`
    : `Request: ${message}`;

  let out;
  try {
    out = await generate({
      systemInstruction: system,
      contents: [{ role: "user", parts: [{ text: userMsg }] }],
      providerOrder: process.env.DOC_PROVIDER_ORDER || "gemini,gemini2,groq,cerebras,openrouter",
      genConfig: { temperature: 0.5, maxOutputTokens: 3000 },
    });
  } catch (err) {
    console.error("[M8] deck spec gen error (non-fatal):", err.message);
    return null;
  }
  const spec = normalizeSpec(parseJsonLoose(out), tpl);
  if (spec) spec.template = key;
  return spec;
}

// ── RENDERERS (pure + deterministic — code owns layout) ──────────────────────
function escHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Marp markdown — the universal source: human-readable AND converts to PPTX/PDF/
// HTML via `marp deck.md --pptx`. Frontmatter, then one slide per `---` block.
function renderMarp(spec) {
  const head = ["---", "marp: true", "theme: default", "paginate: true", "---"];
  const blocks = spec.slides.map((s, i) => {
    const lines = [`# ${s.title || "Slide " + (i + 1)}`];
    if (spec.subtitle && i === 0) lines.push("", `### ${spec.subtitle}`);
    if (s.bullets.length) { lines.push(""); for (const b of s.bullets) lines.push(`- ${b}`); }
    if (s.notes) lines.push("", `<!-- ${s.notes.replace(/--+/g, "—")} -->`);
    return lines.join("\n");
  });
  return head.join("\n") + "\n\n" + blocks.join("\n\n---\n\n") + "\n";
}

// Self-contained reveal.js deck (CDN) — opens and presents in any browser.
function renderRevealHTML(spec) {
  const sections = spec.slides.map((s, i) => {
    const sub = (spec.subtitle && i === 0) ? `<h3>${escHtml(spec.subtitle)}</h3>` : "";
    const ul = s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${escHtml(b)}</li>`).join("")}</ul>` : "";
    const notes = s.notes ? `<aside class="notes">${escHtml(s.notes)}</aside>` : "";
    return `    <section><h2>${escHtml(s.title || "Slide " + (i + 1))}</h2>${sub}${ul}${notes}</section>`;
  }).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(spec.title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/theme/black.css">
</head>
<body>
<div class="reveal"><div class="slides">
${sections}
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/dist/reveal.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5/plugin/notes/notes.js"></script>
<script>Reveal.initialize({ hash: true, plugins: [RevealNotes] });</script>
</body>
</html>`;
}

// A short, readable outline for the chat bubble (plain text — the chat renders
// textContent). Lets M8 SHOW the deck it built without dumping full source.
function renderOutline(spec) {
  const lines = [`${spec.title}${spec.subtitle ? " — " + spec.subtitle : ""} (${spec.slides.length} slides)`];
  spec.slides.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.title}`);
    for (const b of s.bullets) lines.push(`   • ${b}`);
  });
  return lines.join("\n");
}

// Filesystem-safe filename base from the deck title (e.g. "Q2 Fleet Plan" → "q2-fleet-plan").
function slugify(s) {
  return (String(s || "deck").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50)) || "deck";
}

// Orchestrator/endpoint entry point: generate the spec ONCE, render every format
// the frontend can download. Returns { ok, title, base, outline, spec, marp, html }
// (or { ok:false } when the spec couldn't be built). The frontend builds the
// actual files client-side (Blob for .md/.html, pptxgenjs in-browser for .pptx)
// — the SPEC is the shared source for all three. Never throws.
async function buildDeck({ message, history, memoryBlock }) {
  try {
    const spec = await generateDeckSpec({ message, history, memoryBlock });
    if (!spec) return { ok: false };
    return {
      ok: true,
      title: spec.title,
      base: slugify(spec.title),
      template: spec.template,
      outline: renderOutline(spec),
      spec,
      marp: renderMarp(spec),
      html: renderRevealHTML(spec),
    };
  } catch (err) {
    console.error("[M8] buildDeck error (non-fatal):", err.message);
    return { ok: false };
  }
}

module.exports = {
  looksDeck, planDeck, generateDeckSpec, normalizeSpec, buildDeck, slugify,
  renderMarp, renderRevealHTML, renderOutline, escHtml,
  DECK_TEMPLATES,
};
