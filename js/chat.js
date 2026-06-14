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
const M8_CHART_RE = /<!--M8-CHART:(\{[\s\S]*?\})-->/;

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

// Strips an M8-CHART marker (if present) from `text`, renders the remaining
// text via appendWithLeanBadges, then renders the chart (if any) below it.
function appendWithCharts(bubble, text) {
  const m = M8_CHART_RE.exec(text);
  let chartSpec = null;
  let cleanText = text;
  if (m) {
    cleanText = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+$/, "");
    try { chartSpec = JSON.parse(m[1]); } catch (_) { chartSpec = null; }
  }
  appendWithLeanBadges(bubble, cleanText);
  if (chartSpec) renderM8Chart(bubble, chartSpec);
}

// For the copy-to-clipboard button: drop the M8-CHART marker so the chart's
// raw JSON spec never lands on the clipboard, just the spoken/displayed text.
function stripM8ChartMarker(text) {
  const m = M8_CHART_RE.exec(text);
  if (!m) return text;
  return (text.slice(0, m.index) + text.slice(m.index + m[0].length)).replace(/\s+$/, "");
}

// ── Copy-to-clipboard (small button under every message) ───────────────────
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const COPY_ICON_DONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

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
        chip.textContent = `📎 ${att.name}`;
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

    footer.appendChild(timeEl);
    footer.appendChild(copyBtn);
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
