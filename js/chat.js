// ── Lean status badges (Build-23) ───────────────────────────────────────
// M8's M4 lemma-DAG scaffold (lib/lemma-dag.js renderScaffoldPacket) and the
// single-statement Lean lane (lib/lean.js narrate) emit fixed, literal status
// substrings into otherwise-plain chat text. We scan rendered assistant text
// for those EXACT strings and wrap them in small colored badge spans — the
// underlying text is untouched (still searchable/honest), just visually
// scannable. Everything else stays a plain text node (no markdown rendering,
// no innerHTML of model output).
const LEAN_BADGE_RE = new RegExp(
  [
    "(LEAF — ✓ Lean-verified \\(this leaf only\\))",
    "(LEAF — statement type-checks, proof admitted \\(sorry\\) — NOT proven)",
    "(LEAF — ✗ Lean rejected)",
    "(LEAF — could not be faithfully formalized \\(nothing submitted\\))",
    "(LEAF — checker cold/slow, not confirmed this turn)",
    "(PARENT — scaffolded \\(sorry, NOT proven\\))",
    "(\\*\\*verified\\*\\*)",
    "(\\*\\*rejected\\*\\*)",
    "(\\*\\*statement type-checks\\*\\*)",
    "(`lean_rejected`)",
    // Build-28: epistemic classification tags emitted by the research-memory
    // graph packet (lib/memory-graph.js renderGraphPacket / noveltySemanticPass)
    // for ingested-document claims, per Build-27 source_class.
    "(\\[ESTABLISHED\\])",
    "(\\[SPECULATIVE\\])",
    "(\\[FRINGE\\])",
  ].join("|"),
  "g"
);
// Per-group (1-indexed in the match array) CSS class + display label.
// Groups 7-10 (the markdown-bold/backtick verdict words from the single-Lean
// lane) are deduped to at most one badge per message — they restate the same
// overall verdict the LEAF/PARENT lines already badge per-leaf in M4 output.
const LEAN_BADGE_META = [
  { cls: "verified",       label: null,                        dedupe: false },
  { cls: "stated",         label: null,                        dedupe: false },
  { cls: "rejected",       label: null,                        dedupe: false },
  { cls: "unformalizable", label: null,                        dedupe: false },
  { cls: "pending",        label: null,                        dedupe: false },
  { cls: "scaffolded",     label: null,                        dedupe: false },
  { cls: "verified",       label: "✓ lean_verified",           dedupe: true },
  { cls: "rejected",       label: "✗ lean_rejected",           dedupe: true },
  { cls: "stated",         label: "◑ lean_stated",             dedupe: true },
  { cls: "rejected",       label: "✗ lean_rejected",           dedupe: true },
  { cls: "established",    label: null,                        dedupe: false },
  { cls: "speculative",    label: null,                        dedupe: false },
  { cls: "fringe",         label: null,                        dedupe: false },
];

// Appends `text` to `bubble` as a mix of plain text nodes and `.lean-badge`
// spans for any recognized Lean/M4 status markers. Safe: only ever creates
// text nodes plus spans whose class/text we set ourselves — never innerHTML.
function appendWithLeanBadges(bubble, text) {
  const re = LEAN_BADGE_RE;
  re.lastIndex = 0;
  let lastIndex = 0;
  let m;
  const dedupeSeen = new Set();
  while ((m = re.exec(text)) !== null) {
    let gi = -1;
    for (let i = 0; i < LEAN_BADGE_META.length; i++) {
      if (m[i + 1] !== undefined) { gi = i; break; }
    }
    if (gi === -1) continue;
    const meta = LEAN_BADGE_META[gi];
    if (meta.dedupe && dedupeSeen.has(meta.label)) continue;
    if (m.index > lastIndex) bubble.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    const span = document.createElement("span");
    span.className = "lean-badge lean-badge--" + meta.cls;
    span.textContent = meta.label || m[0];
    bubble.appendChild(span);
    if (meta.dedupe) dedupeSeen.add(meta.label);
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) bubble.appendChild(document.createTextNode(text.slice(lastIndex)));
}

// ── Charts (Build-31) ────────────────────────────────────────────────────
// lib/fleet.js (via lib/orchestrator.js appendChartMarker) appends a single
// literal `<!--M8-CHART:{...json...}-->` marker to the end of an assistant
// reply when the user asked for a chart/graph/plot of a fleet earnings range.
// The JSON is a small, code-computed {type,title,labels,data,datasetLabel}
// spec — never produced or seen by the LLM. We strip the marker from the
// displayed text and render a <canvas> Chart.js chart in its place.
const M8_CHART_RE    = /<!--M8-CHART:(\{[\s\S]*?\})-->/;
const M8_DOWNLOAD_RE = /<!--M8-DOWNLOAD:(\{[\s\S]*?\})-->/;

// Renders a styled download button for fleet file exports (XLSX / PPTX).
// spec = { url, filename, label, format } — all code-computed, never LLM.
function renderM8Download(bubble, spec) {
  const wrap = document.createElement("div");
  wrap.className = "m8-download-wrap";

  const isPptx = (spec.format || spec.filename || "").toLowerCase().includes("pptx");
  const icon   = isPptx
    ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M8 7h3a2 2 0 0 1 0 4H8z"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`;

  const btn = document.createElement("a");
  btn.href     = spec.url;
  btn.download = spec.filename || "fleet-report";
  btn.className = "m8-download-btn";
  btn.innerHTML = `${icon}<span>${spec.label || "Download Report"}</span>`;
  btn.addEventListener("click", () => {
    btn.classList.add("m8-download-btn--clicked");
    setTimeout(() => btn.classList.remove("m8-download-btn--clicked"), 2000);
  });

  wrap.appendChild(btn);
  bubble.appendChild(wrap);
}

function _ensureChartJs() {
  if (window.Chart) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js";
    s.onload = resolve;
    s.onerror = () => reject(new Error("Chart.js failed to load"));
    document.head.appendChild(s);
  });
}

function renderM8Chart(bubble, spec) {
  const wrap = document.createElement("div");
  wrap.className = "m8-chart-wrap";
  const canvas = document.createElement("canvas");
  canvas.className = "m8-chart";
  wrap.appendChild(canvas);
  bubble.appendChild(wrap);
  _ensureChartJs()
    .then(() => {
      new window.Chart(canvas, {
        type: spec.type || "bar",
        data: {
          labels: spec.labels || [],
          datasets: [{
            label: spec.datasetLabel || "",
            data: spec.data || [],
            backgroundColor: "rgba(79, 142, 247, 0.5)",
            borderColor: "rgba(79, 142, 247, 1)",
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false },
            title: { display: !!spec.title, text: spec.title || "", color: "#e5e7eb" },
          },
          scales: {
            x: { ticks: { color: "#7b88a8" }, grid: { color: "rgba(79, 142, 247, 0.08)" } },
            y: { beginAtZero: true, ticks: { color: "#7b88a8" }, grid: { color: "rgba(79, 142, 247, 0.08)" } },
          },
        },
      });
    })
    .catch((err) => {
      wrap.textContent = "Chart failed to load: " + err.message;
    });
}

// Strips M8 marker(s) from text, returns {cleanText, chartSpec, downloadSpec}.
function _parseM8Markers(text) {
  let cleanText = text;
  let chartSpec = null;
  let downloadSpec = null;

  const cm = M8_CHART_RE.exec(cleanText);
  if (cm) {
    cleanText = (cleanText.slice(0, cm.index) + cleanText.slice(cm.index + cm[0].length)).replace(/\s+$/, "");
    try { chartSpec = JSON.parse(cm[1]); } catch (_) {}
  }
  const dm = M8_DOWNLOAD_RE.exec(cleanText);
  if (dm) {
    cleanText = (cleanText.slice(0, dm.index) + cleanText.slice(dm.index + dm[0].length)).replace(/\s+$/, "");
    try { downloadSpec = JSON.parse(dm[1]); } catch (_) {}
  }
  return { cleanText, chartSpec, downloadSpec };
}

// Strips M8-CHART / M8-DOWNLOAD markers from `text`, renders the cleaned text
// via appendWithLeanBadges, then renders chart and/or download button below.
function appendWithCharts(bubble, text) {
  const { cleanText, chartSpec, downloadSpec } = _parseM8Markers(text);
  appendWithLeanBadges(bubble, cleanText);
  if (chartSpec)    renderM8Chart(bubble, chartSpec);
  if (downloadSpec) renderM8Download(bubble, downloadSpec);
}

// For the copy-to-clipboard button: strip all M8 markers so raw JSON never
// lands on the clipboard, just the spoken/displayed text.
function stripM8ChartMarker(text) {
  return _parseM8Markers(text).cleanText;
}

// ── Copy-to-clipboard (small button under every message) ───────────────────
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const COPY_ICON_DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const REPLY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>';

// ── Reply-to-message (Build-60b) ─────────────────────────────────────────────
// State for the active reply context. When set, the next sent message is
// prefixed with "[Replying to: <quoted>]\n\n" so M8 has the reference.
const _replyState = { active: false, quote: "" };

function _getReplyBar()    { return document.getElementById("reply-bar"); }
function _getReplyQuote()  { return document.getElementById("reply-quote"); }
function _getReplyCancel() { return document.getElementById("reply-cancel"); }

function setReply(fullText) {
  const clean = stripM8ChartMarker(fullText || "").replace(/\s+/g, " ").trim();
  const preview = clean.length > 120 ? clean.slice(0, 120) + "…" : clean;
  _replyState.active = true;
  _replyState.quote  = clean;
  const bar   = _getReplyBar();
  const quote = _getReplyQuote();
  if (bar)   bar.classList.remove("reply-bar--hidden");
  if (quote) quote.textContent = preview;
  const inp = document.getElementById("text-input");
  if (inp) inp.focus();
}

function clearReply() {
  _replyState.active = false;
  _replyState.quote  = "";
  const bar = _getReplyBar();
  if (bar) bar.classList.add("reply-bar--hidden");
}

// Wire the cancel button once DOM is ready.
document.addEventListener("DOMContentLoaded", () => {
  const cancel = _getReplyCancel();
  if (cancel) cancel.addEventListener("click", clearReply);
});

class ChatManager {
  constructor(container) {
    this.container = container;
    this.messages = [];
    this.sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  // `attachments` (Build-33): optional [{name}] list of files attached to a
  // user message — display-only chips, not part of msg.content/history.
  addMessage(role, content, attachments) {
    const msg = { role, content, timestamp: new Date() };
    if (attachments && attachments.length) msg.attachments = attachments;
    this.messages.push(msg);
    this._renderMessage(msg);
    this._scrollToBottom();
    return msg;
  }

  _renderMessage(msg) {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${msg.role}`;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    appendWithCharts(bubble, msg.content);

    wrapper.appendChild(bubble);
    if (msg.attachments && msg.attachments.length) {
      const list = document.createElement("div");
      list.className = "message-attachments";
      msg.attachments.forEach((att) => {
        const chip = document.createElement("div");
        chip.className = "attachment-chip";
        if (att.kind === "image" && att.thumb) {
          const thumb = document.createElement("img");
          thumb.className = "attachment-thumb";
          thumb.src = att.thumb;
          thumb.alt = att.name;
          chip.appendChild(thumb);
          const name = document.createElement("span");
          name.className = "attachment-name";
          name.textContent = `🖼️ ${att.name}`;
          chip.appendChild(name);
        } else {
          chip.textContent = `📎 ${att.name}`;
        }
        list.appendChild(chip);
      });
      wrapper.appendChild(list);
    }
    this._addFooter(wrapper, msg);
    this.container.appendChild(wrapper);
  }

  // Timestamp + copy-to-clipboard button, shared by every message type.
  _addFooter(wrapper, msg) {
    const footer = document.createElement("div");
    footer.className = "message-footer";

    const timeEl = document.createElement("div");
    timeEl.className = "message-time";
    timeEl.textContent = msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.title = "Copy";
    copyBtn.innerHTML = COPY_ICON;
    copyBtn.addEventListener("click", () => this._copyMessage(msg, copyBtn));

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.className = "reply-btn";
    replyBtn.title = "Reply to this message";
    replyBtn.innerHTML = REPLY_ICON;
    replyBtn.addEventListener("click", () => setReply(msg.content || ""));

    footer.appendChild(timeEl);
    footer.appendChild(copyBtn);
    footer.appendChild(replyBtn);
    wrapper.appendChild(footer);
    return footer;
  }

  _copyMessage(msg, btn) {
    const text = stripM8ChartMarker(msg.content || "");
    const done = () => {
      btn.innerHTML = COPY_ICON_DONE;
      btn.classList.add("copied");
      setTimeout(() => {
        btn.innerHTML = COPY_ICON;
        btn.classList.remove("copied");
      }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this._fallbackCopy(text, done));
    } else {
      this._fallbackCopy(text, done);
    }
  }

  // execCommand fallback for browsers/contexts where navigator.clipboard is
  // unavailable or denied (e.g. non-secure origins).
  _fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      console.error("copy failed", e);
    }
    ta.remove();
  }

  showTyping() {
    this.hideTyping();
    const wrapper = document.createElement("div");
    wrapper.className = "message assistant";
    wrapper.id = "m8-typing";

    const bubble = document.createElement("div");
    bubble.className = "message-bubble typing-bubble";
    bubble.innerHTML = "<span></span><span></span><span></span>";

    wrapper.appendChild(bubble);
    this.container.appendChild(wrapper);
    this._scrollToBottom();
  }

  hideTyping() {
    const el = document.getElementById("m8-typing");
    if (el) el.remove();
  }

  _scrollToBottom() {
    requestAnimationFrame(() => {
      this.container.scrollTop = this.container.scrollHeight;
    });
  }

  // ── streaming support (SSE) ──────────────────────────────────────
  // Create an empty assistant bubble we can grow as token chunks arrive.
  addStreamingMessage() {
    const msg = { role: "assistant", content: "", timestamp: new Date() };
    this.messages.push(msg);

    const wrapper = document.createElement("div");
    wrapper.className = "message assistant";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    wrapper.appendChild(bubble);
    this._addFooter(wrapper, msg);
    this.container.appendChild(wrapper);

    msg._bubble = bubble;
    this._scrollToBottom();
    return msg;
  }

  appendToStreaming(msg, delta) {
    msg.content += delta;
    if (msg._bubble) msg._bubble.textContent = msg.content;
    this._scrollToBottom();
  }

  // On completion, ALWAYS take the server's authoritative `full` text — it is
  // the true returned reply, so it corrects any streamed-then-superseded partial
  // (the double-emit splice) even if that garbled accumulation was longer.
  finalizeStreaming(msg, fullText) {
    if (typeof fullText === "string" && fullText.trim()) msg.content = fullText;
    if (msg._bubble) {
      msg._bubble.innerHTML = "";
      appendWithCharts(msg._bubble, msg.content);
    }
    this._scrollToBottom();
  }

  // ── deck artifact (download buttons + client-side file build) ────────────
  // Renders the deck OUTLINE in a bubble + a row of download buttons. The files
  // are built in the browser from the spec/renderers the server returned: .md and
  // .html are Blobs of the Marp/reveal strings; .pptx is built with pptxgenjs
  // (lazy-loaded from CDN) so a real, editable PowerPoint is produced client-side.
  addDeckMessage(deck) {
    const msg = { role: "assistant", content: deck.outline || (deck.title + " deck"), timestamp: new Date(), _deck: deck };
    this.messages.push(msg);

    const wrapper = document.createElement("div");
    wrapper.className = "message assistant";
    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const text = document.createElement("div");
    text.className = "deck-outline";
    text.textContent = msg.content;
    bubble.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "deck-actions";
    actions.appendChild(this._deckBtn("⬇ PowerPoint (.pptx)", () => this._downloadPptx(deck)));
    actions.appendChild(this._deckBtn("⬇ Web slides (.html)", () => this._downloadBlob(deck.html, deck.base + ".html", "text/html")));
    actions.appendChild(this._deckBtn("⬇ Markdown (.md)", () => this._downloadBlob(deck.marp, deck.base + ".md", "text/markdown")));
    bubble.appendChild(actions);

    wrapper.appendChild(bubble);
    this._addFooter(wrapper, msg);
    this.container.appendChild(wrapper);
    this._scrollToBottom();
    return msg;
  }

  _deckBtn(label, onClick) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "deck-btn";
    b.textContent = label;
    b.addEventListener("click", () => { try { onClick(); } catch (e) { console.error("deck download error", e); } });
    return b;
  }

  _downloadBlob(content, filename, type) {
    const blob = new Blob([content || ""], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  _ensurePptxGen() {
    if (window.PptxGenJS) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("pptxgenjs failed to load"));
      document.head.appendChild(s);
    });
  }

  async _downloadPptx(deck) {
    const spec = deck.spec || { slides: [] };
    try {
      await this._ensurePptxGen();
      const P = window.PptxGenJS;
      const pptx = new P();
      pptx.layout = "LAYOUT_16x9";
      pptx.author = "M8";
      pptx.title = deck.title || "Deck";
      (spec.slides || []).forEach((s, i) => {
        const slide = pptx.addSlide();
        slide.addText(s.title || ("Slide " + (i + 1)), { x: 0.5, y: 0.3, w: 9, h: 0.9, fontSize: 28, bold: true, color: "1F3864" });
        if (i === 0 && spec.subtitle) {
          slide.addText(spec.subtitle, { x: 0.5, y: 1.25, w: 9, h: 0.6, fontSize: 18, italic: true, color: "808080" });
        }
        if (Array.isArray(s.bullets) && s.bullets.length) {
          slide.addText(
            s.bullets.map((b) => ({ text: String(b), options: { bullet: true, breakLine: true } })),
            { x: 0.7, y: 1.5, w: 8.6, h: 4.8, fontSize: 18, color: "333333", valign: "top" }
          );
        }
        if (s.notes) slide.addNotes(s.notes);
      });
      await pptx.writeFile({ fileName: (deck.base || "deck") + ".pptx" });
    } catch (e) {
      console.error("pptx build error", e);
      alert("Couldn't build the .pptx in your browser — use the .html or .md download instead (Markdown converts to PowerPoint with: marp deck.md --pptx).");
    }
  }

  getHistory() {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  clear() {
    this.messages = [];
    this.container.innerHTML = "";
  }
}
