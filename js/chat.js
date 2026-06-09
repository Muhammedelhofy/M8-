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

  // On completion, prefer the server's authoritative `full` text (covers any
  // chunk we might have dropped); never shrink what's already shown.
  finalizeStreaming(msg, fullText) {
    if (typeof fullText === "string" && fullText.length >= msg.content.length) msg.content = fullText;
    if (msg._bubble) msg._bubble.textContent = msg.content;
    this._scrollToBottom();
  }

  getHistory() {
    return this.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  clear() {
    this.messages = [];
    this.container.innerHTML = "";
  }
}
