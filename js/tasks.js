// M8 Tasks v1 — the slide-in Tasks panel (manual to-do). Talks to /api/tasks.
(function () {
  var panel = document.getElementById("tasks-panel");
  var openBtn = document.getElementById("tasks-btn");
  var backBtn = document.getElementById("tasks-back");
  var list = document.getElementById("tasks-list");
  var input = document.getElementById("task-input");
  var due = document.getElementById("task-due");
  var addBtn = document.getElementById("task-add");
  if (!panel) return;

  var SVG_CIRCLE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/></svg>';
  var SVG_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><path d="M8.5 12.4l2.4 2.4 4.6-5"/></svg>';
  var SVG_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function dueLabel(iso) {
    if (!iso) return "";
    var d = new Date(iso), now = new Date();
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((day - today) / 86400000);
    var overdue = diff < 0;
    var txt = diff === 0 ? "today" : diff === 1 ? "tomorrow" : diff === -1 ? "yesterday"
      : (overdue ? Math.abs(diff) + "d ago" : "in " + diff + "d");
    return '<span class="task-due-tag' + (overdue ? " overdue" : "") + '">' + txt + "</span>";
  }

  function render(tasks) {
    if (!tasks.length) { list.innerHTML = '<div class="tasks-empty">No tasks yet. Add one above.</div>'; return; }
    list.innerHTML = tasks.map(function (t) {
      return '<div class="task-row' + (t.done ? " done" : "") + '" data-id="' + t.id + '">' +
        '<button class="task-check" aria-label="toggle">' + (t.done ? SVG_CHECK : SVG_CIRCLE) + "</button>" +
        '<span class="task-title">' + esc(t.title) + "</span>" +
        (t.done ? "" : dueLabel(t.due_at)) +
        '<button class="task-del" aria-label="delete">' + SVG_X + "</button>" +
        "</div>";
    }).join("");
  }

  function load() {
    fetch("/api/tasks").then(function (r) { return r.json(); })
      .then(function (d) { render(d.tasks || []); }).catch(function () {});
  }

  function add() {
    var t = (input.value || "").trim();
    if (!t) return;
    fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: t, due_at: due.value || null }),
    }).then(function () { input.value = ""; due.value = ""; load(); }).catch(function () {});
  }

  function toggle(id, done) {
    fetch("/api/tasks", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id, done: done }),
    }).then(function () { load(); }).catch(function () {});
  }

  function del(id) {
    fetch("/api/tasks", {
      method: "DELETE", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: id }),
    }).then(function () { load(); }).catch(function () {});
  }

  if (openBtn) openBtn.addEventListener("click", function () {
    panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); load();
  });
  if (backBtn) backBtn.addEventListener("click", function () {
    panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true");
  });
  if (addBtn) addBtn.addEventListener("click", add);
  if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter") add(); });

  // event-delegated row actions
  list.addEventListener("click", function (e) {
    var row = e.target.closest(".task-row"); if (!row) return;
    var id = row.getAttribute("data-id");
    if (e.target.closest(".task-check")) toggle(id, !row.classList.contains("done"));
    else if (e.target.closest(".task-del")) del(id);
  });
})();
