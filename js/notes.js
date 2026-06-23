// M8 Notes — slide-in panel (browse + delete). Capture/recall happen in chat
// ("note: …" / "my notes"). Talks to /api/notes (folded into ops via ?fn=notes).
(function () {
  var panel = document.getElementById("notes-panel");
  var openBtn = document.getElementById("notes-btn");
  var backBtn = document.getElementById("notes-back");
  var list = document.getElementById("notes-list");
  var launcher = document.getElementById("launcher");
  if (!panel || !list) return;

  var SVG_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(notes) {
    if (!notes.length) {
      list.innerHTML = '<div class="tasks-empty">No notes yet. Tell M8 "note: …" to save one.</div>';
      return;
    }
    list.innerHTML = notes.map(function (n) {
      return '<div class="note-row" data-id="' + n.id + '">' +
        '<span class="note-text">' + esc(n.content) + "</span>" +
        '<button class="task-del" aria-label="delete note">' + SVG_X + "</button>" +
        "</div>";
    }).join("");
  }

  function load() {
    fetch("/api/notes").then(function (r) { return r.json(); })
      .then(function (d) { render(d.notes || []); }).catch(function () {});
  }

  function del(id) {
    fetch("/api/notes", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id }),
    }).then(function () { load(); }).catch(function () {});
  }

  if (openBtn) openBtn.addEventListener("click", function () {
    if (launcher) launcher.hidden = true;
    panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); load();
  });
  if (backBtn) backBtn.addEventListener("click", function () {
    panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true");
  });

  list.addEventListener("click", function (e) {
    var row = e.target.closest(".note-row"); if (!row) return;
    if (e.target.closest(".task-del")) del(row.getAttribute("data-id"));
  });
})();
