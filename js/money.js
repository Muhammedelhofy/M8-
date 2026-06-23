// M8 Money view — the slide-in Money panel. Reads a privacy-safe, code-computed
// summary from /api/wallet (see lib/wallet.js) and renders the LOCKED blend:
//   A) a spend ring (this month's spend vs income)
//   B) In / Out stat tiles
//   C) plain-language insight cards (spend vs last month, bills due, budgets)
// Every line of text shown here is TEMPLATED from numbers in this file — no
// transaction free-text is fetched, and nothing is ever sent to an LLM.
(function () {
  var panel = document.getElementById("money-panel");
  if (!panel) return;
  var openBtn = document.getElementById("money-btn");
  var backBtn = document.getElementById("money-back");
  var refreshBtn = document.getElementById("money-refresh");
  var body = document.getElementById("money-body");

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // Currency formatting. Falls back to "<cur> 1,234.00" if Intl lacks the code.
  function fmt(n, cur) {
    var v = Number(n) || 0;
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: cur, maximumFractionDigits: v % 1 === 0 ? 0 : 2 }).format(v);
    } catch (e) {
      return cur + " " + v.toLocaleString("en", { maximumFractionDigits: 2 });
    }
  }

  function setState(node) {
    body.innerHTML = "";
    body.appendChild(node);
  }

  function loadingState() {
    var w = el("div", "money-state");
    w.appendChild(el("div", "money-spinner"));
    w.appendChild(el("div", "money-state-text", "Reading your wallet…"));
    return w;
  }

  function errorState(msg) {
    var w = el("div", "money-state");
    w.appendChild(el("div", "money-state-icon", "⚠"));
    w.appendChild(el("div", "money-state-text", msg || "Couldn't load your wallet."));
    var retry = el("button", "money-retry", "Try again");
    retry.addEventListener("click", load);
    w.appendChild(retry);
    return w;
  }

  // ── A) the spend ring ──────────────────────────────────────────────────
  function ringSvg(spent, income, base) {
    var R = 54, C = 2 * Math.PI * R;
    var hasIncome = income > 0;
    var ratio = hasIncome ? Math.min(spent / income, 1) : (spent > 0 ? 1 : 0);
    var over = hasIncome && spent > income;
    var dash = (ratio * C).toFixed(1);
    var pctLabel = hasIncome ? Math.round((spent / income) * 100) + "%" : "—";

    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 140 140");
    svg.setAttribute("class", "money-ring");

    function circle(r, cls, extra) {
      var c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", "70"); c.setAttribute("cy", "70"); c.setAttribute("r", r);
      c.setAttribute("class", cls);
      if (extra) for (var k in extra) c.setAttribute(k, extra[k]);
      return c;
    }
    svg.appendChild(circle(R, "money-ring-track"));
    var prog = circle(R, "money-ring-prog" + (over ? " over" : ""), {
      "stroke-dasharray": dash + " " + C.toFixed(1),
      "transform": "rotate(-90 70 70)",
      "stroke-linecap": "round",
    });
    svg.appendChild(prog);

    var t1 = document.createElementNS(NS, "text");
    t1.setAttribute("x", "70"); t1.setAttribute("y", "66"); t1.setAttribute("class", "money-ring-pct");
    t1.setAttribute("text-anchor", "middle"); t1.textContent = pctLabel;
    svg.appendChild(t1);
    var t2 = document.createElementNS(NS, "text");
    t2.setAttribute("x", "70"); t2.setAttribute("y", "86"); t2.setAttribute("class", "money-ring-sub");
    t2.setAttribute("text-anchor", "middle");
    t2.textContent = hasIncome ? "of income spent" : "spent this month";
    svg.appendChild(t2);
    return svg;
  }

  function ringSection(d) {
    var sec = el("div", "money-ring-wrap");
    sec.appendChild(ringSvg(d.expense, d.income, d.base));
    var netRow = el("div", "money-net");
    netRow.appendChild(el("span", "money-net-label", "Net this month"));
    var val = el("span", "money-net-val " + (d.net >= 0 ? "pos" : "neg"), (d.net >= 0 ? "+" : "−") + fmt(Math.abs(d.net), d.base));
    netRow.appendChild(val);
    sec.appendChild(netRow);
    return sec;
  }

  // ── B) In / Out tiles ──────────────────────────────────────────────────
  function tile(kind, label, amount, base, sub) {
    var t = el("div", "money-tile " + kind);
    t.appendChild(el("div", "money-tile-label", label));
    t.appendChild(el("div", "money-tile-val", fmt(amount, base)));
    if (sub) t.appendChild(el("div", "money-tile-sub", sub));
    return t;
  }
  function perCurSub(d, type) {
    if (!d.currenciesUsed || d.currenciesUsed.length < 2) return "";
    return d.currenciesUsed.map(function (c) { return fmt(d.perCurrency[c][type], c); }).join(" · ");
  }
  function tilesSection(d) {
    var row = el("div", "money-tiles");
    row.appendChild(tile("in", "In", d.income, d.base, perCurSub(d, "income")));
    row.appendChild(tile("out", "Out", d.expense, d.base, perCurSub(d, "expense")));
    return row;
  }

  // ── C) insight cards (all strings templated from numbers) ──────────────
  function card(tone, title, detail) {
    var c = el("div", "money-card " + (tone || ""));
    c.appendChild(el("div", "money-card-title", title));
    if (detail) c.appendChild(el("div", "money-card-detail", detail));
    return c;
  }
  function dueLabel(days) {
    return days === 0 ? "due today" : days === 1 ? "due tomorrow" : "due in " + days + " days";
  }
  function insightCards(d) {
    var wrap = el("div", "money-cards");

    // 1) spend vs last month
    if (d.expenseDeltaPct != null) {
      var up = d.expenseDeltaPct > 0;
      var same = d.expenseDeltaPct === 0;
      var tone = same ? "" : up ? "warn" : "good";
      var arrow = same ? "•" : up ? "▲" : "▼";
      var title = "Spent " + fmt(d.expense, d.base) + " this month";
      var detail = same
        ? "About the same as last month."
        : arrow + " " + Math.abs(d.expenseDeltaPct) + "% " + (up ? "more" : "less") + " than last month (" + fmt(d.lastMonthExpense, d.base) + ").";
      wrap.appendChild(card(tone, title, detail));
    } else if (d.expense > 0) {
      wrap.appendChild(card("", "Spent " + fmt(d.expense, d.base) + " this month", "First month of data — nothing to compare yet."));
    }

    // 2) bills due in the next 7 days
    if (d.bills && d.bills.length) {
      var n = d.bills.length;
      var nearest = d.bills[0];
      var title2 = n + " bill" + (n > 1 ? "s" : "") + " due within 7 days";
      var detail2 = nearest.name + " — " + dueLabel(nearest.dueInDays) + " (" + fmt(nearest.amount, nearest.currency) + ")";
      wrap.appendChild(card("warn", title2, detail2));
    }

    // 3) budget pressure (highest category at/over 80%)
    if (d.budgets && d.budgets.length && d.budgets[0].pct >= 80) {
      var b = d.budgets[0];
      var tone3 = b.pct >= 100 ? "over" : "warn";
      wrap.appendChild(card(tone3, b.category + " budget " + b.pct + "% used",
        fmt(b.spent, b.currency) + " of " + fmt(b.limit, b.currency)));
    }

    // calm fallback when there's genuinely nothing to flag
    if (!wrap.children.length) {
      wrap.appendChild(card("good", d.txCountThisMonth ? "All calm" : "Nothing logged yet this month",
        d.txCountThisMonth ? "No bills due soon and budgets are on track." : "Add entries in Family Wallet to see your month here."));
    }
    return wrap;
  }

  function openWalletBtn() {
    var a = document.createElement("a");
    a.className = "money-openwallet";
    a.href = "https://family-wallet.vercel.app";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open Family Wallet ↗";
    return a;
  }

  function render(d) {
    body.innerHTML = "";
    body.appendChild(ringSection(d));
    body.appendChild(tilesSection(d));
    body.appendChild(insightCards(d));
    body.appendChild(openWalletBtn());
    var foot = el("div", "money-foot", "Family Wallet · " + (d.month || "") + " · read-only in M8");
    body.appendChild(foot);
  }

  // Money is gated (not world-readable): we send a pre-shared key the owner
  // enters once (stored locally), matched server-side against M8_WALLET_KEY.
  function walletKey() { try { return localStorage.getItem("m8_wallet_key") || ""; } catch (e) { return ""; } }
  function promptKey() {
    var k = window.prompt("Enter your M8 wallet key (the value you set as M8_WALLET_KEY in Vercel):", "");
    if (k != null && k.trim()) { try { localStorage.setItem("m8_wallet_key", k.trim()); } catch (e) {} return true; }
    return false;
  }
  function lockedState(msg, canUnlock) {
    var w = el("div", "money-state");
    w.appendChild(el("div", "money-state-icon", "🔒"));
    w.appendChild(el("div", "money-state-text", msg));
    if (canUnlock) {
      var b = el("button", "money-retry", "Enter key");
      b.addEventListener("click", function () { if (promptKey()) load(); });
      w.appendChild(b);
    }
    return w;
  }

  var busy = false;
  function load() { if (busy) return; busy = true; setState(loadingState()); attempt(false); }
  function attempt(isRetry) {
    fetch("/api/wallet", { headers: { Accept: "application/json", "x-m8-key": walletKey() } })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j && !res.j.error) { busy = false; render(res.j); return; }
        if (res.status === 401 && !isRetry && promptKey()) { attempt(true); return; } // stay busy across the retry
        busy = false;
        if (res.status === 401) { setState(lockedState("Locked — enter the correct key to unlock.", true)); return; }
        if (res.status === 503) {
          var lk = res.j && res.j.error === "wallet locked";
          setState(lockedState(lk ? "Money is locked — set M8_WALLET_KEY in Vercel, then enter it here." : "Wallet not connected yet (env vars not set).", lk));
          return;
        }
        setState(errorState("Couldn't reach your wallet right now."));
      })
      .catch(function () { busy = false; setState(errorState("Couldn't reach your wallet right now.")); });
  }

  if (openBtn) openBtn.addEventListener("click", function () {
    panel.classList.add("open"); panel.setAttribute("aria-hidden", "false"); load();
  });
  if (backBtn) backBtn.addEventListener("click", function () {
    panel.classList.remove("open"); panel.setAttribute("aria-hidden", "true");
  });
  if (refreshBtn) refreshBtn.addEventListener("click", load);
})();
