class ChatManager {
  constructor(container) {
    this.container = container;
    this.messages = [];
    this.sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
  }

  addMessage(role, content) {
    const msg = { role, content, timestamp: new Date() };
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
    bubble.textContent = msg.content;

    const timeEl = document.createElement("div");
    timeEl.className = "message-time";
    timeEl.textContent = msg.timestamp.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    wrapper.appendChild(bubble);
    wrapper.appendChild(timeEl);
    this.container.appendChild(wrapper);
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
    const timeEl = document.createElement("div");
    timeEl.className = "message-time";
    timeEl.textContent = msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    wrapper.appendChild(bubble);
    wrapper.appendChild(timeEl);
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
    if (msg._bubble) msg._bubble.textContent = msg.content;
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

    const timeEl = document.createElement("div");
    timeEl.className = "message-time";
    timeEl.textContent = msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    wrapper.appendChild(bubble);
    wrapper.appendChild(timeEl);
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
