// M8 ↔ Family Wallet — READ-ONLY money summary (Build: Money view).
//
// ── HARD PRIVACY WALL ───────────────────────────────────────────────────────
// Transaction free-text (note / counterparty) NEVER enters this module: we do
// not even SELECT the `note` column. Nothing here is ever fed to an LLM prompt,
// and we NEVER log row contents — only HTTP status + table name on error. The
// screen is a deterministic, code-computed + code-TEMPLATED summary. Category
// and bill *names* are surfaced only back to the owner's own UI (budget/bill
// labels), never to a model or a log.
//
// ── ACCESS ──────────────────────────────────────────────────────────────────
// We mint a short-lived HS256 JWT { role: "m8_wallet" } signed with
// WALLET_JWT_SECRET and use it as the PostgREST bearer. The `m8_wallet` DB role
// is nologin, not superuser, not bypassrls: SELECT on the analysis tables +
// column-scoped UPDATE on transactions only, RLS-scoped to the Hofy Home
// household. We also pass an `apikey` header for the Supabase gateway — the
// public anon key if WALLET_SUPABASE_ANON_KEY is set, otherwise the minted JWT.
const crypto = require("crypto");

// Real household — "Hofy Home". All reads are additionally filtered to this id
// (defense in depth; RLS already scopes the role to it).
const HOUSEHOLD_ID = "3c55a0a3-837c-41b8-96a9-abfe5395d3d7";
const WALLET_ROLE = "m8_wallet";
const CURRENCIES = ["SAR", "EGP"];
const DEFAULT_BASE = "SAR";
const DEFAULT_RATE = 13; // egp_per_sar fallback (matches the Family Wallet app)
const KSA_OFFSET_MS = 3 * 60 * 60 * 1000; // Asia/Riyadh = UTC+3, no DST

// ── JWT (hand-rolled HS256; no extra dependency) ────────────────────────────
function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
function mintToken(secret) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ role: WALLET_ROLE, iat: now, exp: now + 120 }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest());
  return `${header}.${payload}.${sig}`;
}

function cfg() {
  const url = process.env.WALLET_SUPABASE_URL;
  const secret = process.env.WALLET_JWT_SECRET;
  if (!url || !secret) {
    const miss = [!url && "WALLET_SUPABASE_URL", !secret && "WALLET_JWT_SECRET"].filter(Boolean);
    const err = new Error("wallet not configured: missing " + miss.join(", "));
    err.code = "WALLET_UNCONFIGURED";
    throw err;
  }
  return { url: url.replace(/\/+$/, ""), secret, apikey: process.env.WALLET_SUPABASE_ANON_KEY || null };
}

// PostgREST GET. `params` is an object of query params. Throws on non-2xx with
// a message that contains NO row data (status + table only).
async function pgGet(table, params) {
  const { url, secret, apikey } = cfg();
  const token = mintToken(secret);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    headers: {
      apikey: apikey || token,
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    // PRIVACY: the body can echo a row on data errors, so we only read it for
    // AUTH errors (401/403) — those bodies are auth/permission messages, never
    // rows (the query never ran). Helps diagnose apikey vs JWT-secret issues.
    if (res.status === 401 || res.status === 403) {
      const t = await res.text().catch(() => "");
      console.error(`[wallet] read ${table} ${res.status}: ${t.slice(0, 200)}`);
    }
    const err = new Error(`wallet read failed (${table} → HTTP ${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

// ── date helpers (computed in KSA so months match what he sees in the app) ──
function ksaNow() {
  return new Date(Date.now() + KSA_OFFSET_MS);
}
function ymOf(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function addMonths(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  return ymOf(new Date(Date.UTC(y, m - 1 + n, 1)));
}
function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)); // first of next month
  const end = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return { start: `${ym}-01`, end };
}
function todayISO() {
  const d = ksaNow();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function daysUntil(iso) {
  return Math.round((Date.parse(iso + "T00:00:00Z") - Date.parse(todayISO() + "T00:00:00Z")) / 86400000);
}

// ── currency conversion (mirrors the Family Wallet app's toBase) ───────────
function makeToBase(base, rate) {
  const r = Number(rate) || DEFAULT_RATE;
  return function toBase(amount, cur) {
    const a = Number(amount) || 0;
    if (cur === base) return a;
    if (base === "SAR" && cur === "EGP") return a / r;
    if (base === "EGP" && cur === "SAR") return a * r;
    return a;
  };
}

function monthAgg(txns, ym, toBase) {
  const { start, end } = monthBounds(ym);
  let income = 0, expense = 0;
  for (const t of txns) {
    if (!(t.occurred_on >= start && t.occurred_on < end)) continue;
    if (t.type === "income") income += toBase(t.amount, t.currency);
    else if (t.type === "expense") expense += toBase(t.amount, t.currency);
  }
  return { income, expense, net: income - expense };
}

// Main entry: returns a structured, privacy-safe summary object. All numbers,
// no free-text. Throws (caller maps to a clean error) on misconfig / read fail.
async function getSummary() {
  const curYm = ymOf(ksaNow());
  const prevYm = addMonths(curYm, -1);
  const { start: prevStart } = monthBounds(prevYm);
  const { end: curEnd } = monthBounds(curYm);

  // Fetch only what we render, only the columns we need (NO `note`).
  const [households, txns, budgets, billsRaw] = await Promise.all([
    pgGet("households", { select: "base_currency,egp_per_sar", id: `eq.${HOUSEHOLD_ID}` }).catch(() => []),
    pgGet("transactions", {
      select: "amount,type,currency,occurred_on,category",
      household_id: `eq.${HOUSEHOLD_ID}`,
      // Two bounds on the same column → one PostgREST and=() group.
      and: `(occurred_on.gte.${prevStart},occurred_on.lt.${curEnd})`,
      order: "occurred_on.desc",
    }),
    pgGet("budgets", {
      select: "category,currency,limit_amount,member_id",
      household_id: `eq.${HOUSEHOLD_ID}`,
    }).catch(() => []),
    pgGet("bills", {
      select: "name,amount,currency,next_due,is_active",
      household_id: `eq.${HOUSEHOLD_ID}`,
      is_active: "eq.true",
    }).catch(() => []),
  ]);

  const hh = (households && households[0]) || {};
  const base = hh.base_currency || DEFAULT_BASE;
  const rate = Number(hh.egp_per_sar) || DEFAULT_RATE;
  const toBase = makeToBase(base, rate);

  const tx = Array.isArray(txns) ? txns : [];
  const thisMonth = monthAgg(tx, curYm, toBase);
  const lastMonth = monthAgg(tx, prevYm, toBase);
  const expenseDeltaPct = lastMonth.expense > 0
    ? Math.round(((thisMonth.expense - lastMonth.expense) / lastMonth.expense) * 100)
    : null;

  // Per-currency (native, not converted) for the current month.
  const { start: curStart } = monthBounds(curYm);
  const perCurrency = {};
  for (const c of CURRENCIES) perCurrency[c] = { income: 0, expense: 0 };
  for (const t of tx) {
    if (!(t.occurred_on >= curStart && t.occurred_on < curEnd)) continue;
    const slot = perCurrency[t.currency];
    if (!slot) continue;
    if (t.type === "income") slot.income += Number(t.amount) || 0;
    else if (t.type === "expense") slot.expense += Number(t.amount) || 0;
  }
  const currenciesUsed = CURRENCIES.filter((c) => perCurrency[c].income || perCurrency[c].expense);

  // Budgets: spent this month per budgeted category (category+currency match,
  // mirroring the app; household-level — per-member budgets aggregate here).
  const budgetRows = (Array.isArray(budgets) ? budgets : []).map((b) => {
    let spent = 0;
    for (const t of tx) {
      if (t.type !== "expense") continue;
      if (!(t.occurred_on >= curStart && t.occurred_on < curEnd)) continue;
      if (t.category === b.category && t.currency === b.currency) spent += Number(t.amount) || 0;
    }
    const limit = Number(b.limit_amount) || 0;
    const pct = limit > 0 ? Math.round((spent / limit) * 100) : 0;
    return { category: b.category, currency: b.currency, limit, spent, pct };
  }).sort((a, b) => b.pct - a.pct);

  // Upcoming bills in the next 7 days.
  const bills = (Array.isArray(billsRaw) ? billsRaw : [])
    .filter((b) => b.next_due && daysUntil(b.next_due) >= 0 && daysUntil(b.next_due) <= 7)
    .map((b) => ({ name: b.name, amount: Number(b.amount) || 0, currency: b.currency, dueInDays: daysUntil(b.next_due) }))
    .sort((a, b) => a.dueInDays - b.dueInDays);

  return {
    ok: true,
    base,
    rate,
    month: curYm,
    income: round2(thisMonth.income),
    expense: round2(thisMonth.expense),
    net: round2(thisMonth.net),
    lastMonthExpense: round2(lastMonth.expense),
    expenseDeltaPct,
    perCurrency,
    currenciesUsed,
    budgets: budgetRows,
    bills,
    txCountThisMonth: tx.filter((t) => t.occurred_on >= curStart && t.occurred_on < curEnd).length,
  };
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ── ADD-EXPENSE (scoped INSERT — needs the GRANT INSERT on transactions) ─────
// Wallet expense categories (mirrors FamilyWallet/config.js). M8 maps free text
// to one of these; unmatched → "Other" with the text kept in the note.
const EXPENSE_CATEGORIES = ["Groceries", "Dining", "Fuel", "Transport", "Rent", "Utilities",
  "Internet & Phone", "Health", "Education", "Shopping", "Kids", "Household", "Travel",
  "Charity", "Entertainment", "Subscriptions", "Fees & Charges", "Other"];
const CATEGORY_HINTS = [
  [/\b(lunch|dinner|breakfast|coffee|restaurant|cafe|meal|food|snack)\b|غداء|عشاء|فطور|قهوة|مطعم|[أا]كل|طعام/i, "Dining"],
  [/\b(grocery|groceries|supermarket|market)\b|بقالة|سوبر\s?ماركت|تموين/i, "Groceries"],
  [/\b(fuel|gas|petrol|gasoline|benzine)\b|بنزين|وقود|محروقات/i, "Fuel"],
  [/\b(taxi|uber|careem|bus|metro|transport|ride|parking)\b|تاكسي|[أا]وبر|كريم|مواصلات|نقل|موقف/i, "Transport"],
  [/\b(rent)\b|[إا]يجار/i, "Rent"],
  [/\b(electric|electricity|water|utility|utilities)\b|كهرباء|ماء|مياه|خدمات/i, "Utilities"],
  [/\b(internet|phone|mobile|data|stc|mobily|zain)\b|انترنت|[إا]نترنت|جوال|هاتف|اتصالات/i, "Internet & Phone"],
  [/\b(doctor|pharmacy|medicine|health|clinic|hospital)\b|دواء|صيدلية|طبيب|صحة|مستشفى|عيادة/i, "Health"],
  [/\b(school|course|book|tuition|education)\b|مدرسة|دورة|كتاب|تعليم|دراسة|رسوم/i, "Education"],
  [/\b(clothes|clothing|shopping|shoes|mall)\b|ملابس|تسوق|[أا]حذية|مول/i, "Shopping"],
  [/\b(kid|kids|child|children|toy|toys|diaper)\b|[أا]طفال|طفل|[أا]لعاب|حفاض/i, "Kids"],
  [/\b(charity|donation|sadaqah|zakat)\b|صدقة|تبرع|زكاة/i, "Charity"],
  [/\b(movie|cinema|game|games|entertainment)\b|فيلم|سينما|ترفيه/i, "Entertainment"],
  [/\b(subscription|netflix|spotify|prime|subscribe)\b|اشتراك/i, "Subscriptions"],
];
function inferCategory(text) {
  for (const [re, cat] of CATEGORY_HINTS) if (re.test(text)) return cat;
  return "Other";
}

// Insert one expense into the wallet (RLS-scoped to Hofy Home), tag the note
// "[M8]" so it's findable in the Wallet app, and record an independent audit row
// in M8's OWN Supabase (m8_wallet_writes). Returns the inserted txn ({id,...}).
// PRIVACY: never logs the amount/category/note (the audit table is the trail).
async function addExpense(exp) {
  const { url, secret, apikey } = cfg();
  const token = mintToken(secret);
  const amount = Number(exp.amount);
  if (!isFinite(amount) || amount <= 0) {
    const e = new Error("invalid amount"); e.code = "BAD_AMOUNT"; throw e;
  }
  const baseNote = (exp.note || "").toString().trim();
  const note = (baseNote ? baseNote + " [M8]" : "[M8]").slice(0, 500);
  const row = {
    household_id: HOUSEHOLD_ID,
    type: "expense",
    amount,
    currency: exp.currency || DEFAULT_BASE,
    category: exp.category || "Other",
    occurred_on: exp.occurredOn || todayISO(),
    note,
  };
  if (exp.memberId) row.member_id = exp.memberId;

  const res = await fetch(`${url}/rest/v1/transactions`, {
    method: "POST",
    headers: {
      apikey: apikey || token,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    // AUTH errors only (401/403): body is an auth/permission message, never a row.
    if (res.status === 401 || res.status === 403) {
      const t = await res.text().catch(() => "");
      console.error(`[wallet] insert ${res.status}: ${t.slice(0, 200)}`);
    }
    const e = new Error(`wallet insert failed (HTTP ${res.status})`); e.status = res.status; throw e;
  }
  const data = await res.json().catch(() => []);
  const txn = Array.isArray(data) ? data[0] : data;
  await auditWalletWrite({
    action: "add_expense",
    wallet_txn_id: txn && txn.id,
    amount: row.amount, currency: row.currency, category: row.category, note: row.note,
  }).catch(() => {}); // audit is best-effort; never blocks the user
  return txn;
}

// Independent audit trail in M8's OWN Supabase (NOT the wallet). Best-effort.
async function auditWalletWrite(entry) {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/m8_wallet_writes`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      action: entry.action,
      wallet_txn_id: entry.wallet_txn_id || null,
      amount: entry.amount, currency: entry.currency, category: entry.category, note: entry.note,
    }),
  });
}

// This-month spend for one category, native per-currency (no conversion needed).
async function getCategorySpend(category) {
  const curYm = ymOf(ksaNow());
  const { start, end } = monthBounds(curYm);
  const rows = await pgGet("transactions", {
    select: "amount,currency",
    household_id: `eq.${HOUSEHOLD_ID}`,
    type: "eq.expense",
    category: `eq.${category}`,
    and: `(occurred_on.gte.${start},occurred_on.lt.${end})`,
  }).catch(() => []);
  const byCurrency = {};
  for (const r of (Array.isArray(rows) ? rows : [])) {
    byCurrency[r.currency] = (byCurrency[r.currency] || 0) + (Number(r.amount) || 0);
  }
  return { category, month: curYm, byCurrency, count: Array.isArray(rows) ? rows.length : 0 };
}

// Build-144: the transaction `note` ("what for") MAY be read for DISPLAY back to the
// OWNER only — it is rendered into a deterministic, code-templated reply that is tagged
// MONEY_SENTINEL (stripped from LLM history) and is NEVER placed in an LLM prompt or a
// log. This is the only relaxation of the original "never read the note" wall, and it is
// opt-in per call (`includeNote`) + globally killable via M8_WALLET_SHOW_NOTES_DISABLED=1.
function _notesOn(includeNote) { return !!includeNote && process.env.M8_WALLET_SHOW_NOTES_DISABLED !== "1"; }
function cleanNote(n) { const s = String(n || "").replace(/\s*\[M8\]\s*$/i, "").trim(); return s || null; }

// The most recent expense(s) across the household, read straight from the wallet
// (so it sees expenses added in the APP too, not just M8-added ones — unlike
// getLastM8Write). Selects amount/currency/category/occurred_on (+ note only when
// includeNote, for owner display — see _notesOn). Read-only, RLS + household-scoped.
// Returns { amount, currency, category, occurredOn, note? }[], newest first.
async function getRecentExpenses(limit = 1, memberId = null, includeNote = false) {
  const n = Math.max(1, Math.min(20, parseInt(limit, 10) || 1));
  const showNote = _notesOn(includeNote);
  const params = {
    select: showNote ? "amount,currency,category,occurred_on,note" : "amount,currency,category,occurred_on",
    household_id: `eq.${HOUSEHOLD_ID}`,
    type: "eq.expense",
    order: "created_at.desc", // true recency = when it was entered, not the dated day
    limit: String(n),
  };
  if (memberId) params.member_id = `eq.${memberId}`;
  const rows = await pgGet("transactions", params).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    amount: Number(r.amount) || 0,
    currency: r.currency || DEFAULT_BASE,
    category: r.category || "Other",
    occurredOn: r.occurred_on || null,
    note: showNote ? cleanNote(r.note) : null,
  }));
}

// Expenses on ONE specific day, optionally scoped to a member. Selects
// amount/currency/category (+ note only when includeNote, for owner display — see
// _notesOn). Used by the date + detail lanes. Returns { amount, currency, category,
// note? }[] for that occurred_on, newest first.
async function getExpensesByDate(dateISO, memberId = null, includeNote = false) {
  const showNote = _notesOn(includeNote);
  const params = {
    select: showNote ? "amount,currency,category,note" : "amount,currency,category",
    household_id: `eq.${HOUSEHOLD_ID}`,
    type: "eq.expense",
    occurred_on: `eq.${dateISO}`,
    order: "created_at.desc",
  };
  if (memberId) params.member_id = `eq.${memberId}`;
  const rows = await pgGet("transactions", params).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    amount: Number(r.amount) || 0,
    currency: r.currency || DEFAULT_BASE,
    category: r.category || "Other",
    note: showNote ? cleanNote(r.note) : null,
  }));
}

// Transactions in a date range [start, end) — both income and expense — for totals,
// income, and net over a period ("this week", "in June", "between X and Y").
// Privacy-safe: amount/currency/category/type only, NO note. Optionally per member.
async function getTxnsByRange(start, end, memberId = null) {
  const params = {
    select: "amount,currency,category,type",
    household_id: `eq.${HOUSEHOLD_ID}`,
    and: `(occurred_on.gte.${start},occurred_on.lt.${end})`,
    order: "occurred_on.desc",
  };
  if (memberId) params.member_id = `eq.${memberId}`;
  const rows = await pgGet("transactions", params).catch(() => []);
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    amount: Number(r.amount) || 0,
    currency: r.currency || DEFAULT_BASE,
    category: r.category || "Other",
    type: r.type,
  }));
}

// Spending grouped by CATEGORY over a date range ("where is the money going").
// Reuses getTxnsByRange; ranks by a base-currency conversion (household rate) but
// reports native per-currency amounts. Privacy-safe (no note). Optionally per member.
async function getCategoryBreakdown(start, end, memberId = null) {
  const rows = await getTxnsByRange(start, end, memberId);
  const households = await pgGet("households", { select: "base_currency,egp_per_sar", id: `eq.${HOUSEHOLD_ID}` }).catch(() => []);
  const hh = (households && households[0]) || {};
  const base = hh.base_currency || DEFAULT_BASE;
  const toBase = makeToBase(base, Number(hh.egp_per_sar) || DEFAULT_RATE);
  const byCat = {};
  for (const r of rows) {
    if (r.type !== "expense") continue;
    const k = r.category || "Other";
    if (!byCat[k]) byCat[k] = { category: k, byCurrency: {}, base: 0, count: 0 };
    byCat[k].byCurrency[r.currency] = (byCat[k].byCurrency[r.currency] || 0) + r.amount;
    byCat[k].base += toBase(r.amount, r.currency);
    byCat[k].count++;
  }
  return { base, categories: Object.values(byCat).sort((a, b) => b.base - a.base) };
}

// Per-member expense totals over a range (for "Sara vs me", "who spent more").
// Groups by member_id, ranks by base-currency conversion, reports native per-currency.
// Privacy-safe (no note).
async function getMemberTotals(start, end) {
  const rows = await pgGet("transactions", {
    select: "amount,currency,member_id,type",
    household_id: `eq.${HOUSEHOLD_ID}`,
    and: `(occurred_on.gte.${start},occurred_on.lt.${end})`,
  }).catch(() => []);
  const households = await pgGet("households", { select: "base_currency,egp_per_sar", id: `eq.${HOUSEHOLD_ID}` }).catch(() => []);
  const hh = (households && households[0]) || {};
  const base = hh.base_currency || DEFAULT_BASE;
  const toBase = makeToBase(base, Number(hh.egp_per_sar) || DEFAULT_RATE);
  const members = await getMembers();
  const nameById = {};
  for (const m of members) nameById[m.id] = m.name;
  const by = {};
  for (const r of (Array.isArray(rows) ? rows : [])) {
    if (r.type !== "expense") continue;
    const id = r.member_id || "none";
    if (!by[id]) by[id] = { member: nameById[id] || "Unassigned", byCurrency: {}, base: 0 };
    const a = Number(r.amount) || 0;
    by[id].byCurrency[r.currency] = (by[id].byCurrency[r.currency] || 0) + a;
    by[id].base += toBase(a, r.currency);
  }
  return { base, members: Object.values(by).sort((a, b) => b.base - a.base) };
}

// Active household members (id + display name), cached 5 min. Names are NOT money
// free-text, so they're allowed back to the owner's UI (this is his own household).
// Used to resolve "Sara's last expense" → a member_id filter. Read-only.
let _membersCache = { at: 0, data: null };
async function getMembers() {
  if (_membersCache.data && Date.now() - _membersCache.at < 5 * 60 * 1000) return _membersCache.data;
  const rows = await pgGet("household_members", {
    select: "id,display_name,role",
    household_id: `eq.${HOUSEHOLD_ID}`,
    is_active: "eq.true",
  }).catch(() => []);
  const data = (Array.isArray(rows) ? rows : []).map((r) => ({
    id: r.id, name: r.display_name || "", role: r.role || "",
  }));
  _membersCache = { at: Date.now(), data };
  return data;
}

// This-month spend for ONE member, native per-currency (no conversion). Mirrors
// getCategorySpend but filters by member_id instead of category. PRIVACY: no note.
async function getMemberSpend(memberId) {
  const curYm = ymOf(ksaNow());
  const { start, end } = monthBounds(curYm);
  const rows = await pgGet("transactions", {
    select: "amount,currency",
    household_id: `eq.${HOUSEHOLD_ID}`,
    type: "eq.expense",
    member_id: `eq.${memberId}`,
    and: `(occurred_on.gte.${start},occurred_on.lt.${end})`,
  }).catch(() => []);
  const byCurrency = {};
  for (const r of (Array.isArray(rows) ? rows : [])) {
    byCurrency[r.currency] = (byCurrency[r.currency] || 0) + (Number(r.amount) || 0);
  }
  return { month: curYm, byCurrency, count: Array.isArray(rows) ? rows.length : 0 };
}

// The most recent expense M8 itself added (from M8's OWN audit trail, NOT the
// wallet) — so editing never requires reading arbitrary wallet transactions.
// Returns { wallet_txn_id, amount, currency, category, note } or null.
async function getLastM8Write() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const res = await fetch(`${url}/rest/v1/m8_wallet_writes?action=eq.add_expense&wallet_txn_id=not.is.null&order=created_at.desc&limit=1`, { headers }).catch(() => null);
  if (!res || !res.ok) return null;
  const rows = await res.json().catch(() => []);
  const last = Array.isArray(rows) && rows[0] ? rows[0] : null;
  if (!last) return null;
  // The add-row keeps the ORIGINAL figure; an edit writes a separate edit_expense
  // row. Overlay the newest edit's amount/category so a 2nd consecutive edit (or a
  // delete/reference) shows the CURRENT value, not the stale original. (Build-127)
  try {
    const er = await fetch(`${url}/rest/v1/m8_wallet_writes?action=eq.edit_expense&wallet_txn_id=eq.${encodeURIComponent(last.wallet_txn_id)}&order=created_at.desc`, { headers });
    if (er && er.ok) {
      const edits = await er.json().catch(() => []);
      if (Array.isArray(edits) && edits.length) {
        const newAmt = edits.find((e) => e.amount != null);
        const newCat = edits.find((e) => e.category != null);
        if (newAmt) last.amount = newAmt.amount;
        if (newCat) last.category = newCat.category;
      }
    }
  } catch (_) { /* non-fatal — fall back to the original add values */ }
  return last;
}

// Update an existing expense (column-scoped UPDATE the m8_wallet role is granted:
// amount/category/note/occurred_on only — NOT currency). Used solely to fix an
// expense M8 added. RLS + the household filter scope it to Hofy Home. Audits the edit.
async function updateExpense(walletTxnId, fields) {
  if (!walletTxnId) { const e = new Error("missing txn id"); e.code = "NO_TXN"; throw e; }
  const { url, secret, apikey } = cfg();
  const token = mintToken(secret);
  const patch = {};
  if (fields.amount != null && isFinite(Number(fields.amount)) && Number(fields.amount) > 0) patch.amount = Number(fields.amount);
  if (fields.category) patch.category = fields.category;
  if (fields.note != null) patch.note = String(fields.note).slice(0, 500);
  if (fields.occurredOn) patch.occurred_on = fields.occurredOn;
  if (!Object.keys(patch).length) { const e = new Error("nothing to update"); e.code = "NOOP"; throw e; }
  const res = await fetch(`${url}/rest/v1/transactions?id=eq.${encodeURIComponent(walletTxnId)}&household_id=eq.${HOUSEHOLD_ID}`, {
    method: "PATCH",
    headers: { apikey: apikey || token, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) { const t = await res.text().catch(() => ""); console.error(`[wallet] update ${res.status}: ${t.slice(0, 200)}`); }
    const e = new Error(`wallet update failed (HTTP ${res.status})`); e.status = res.status; throw e;
  }
  const data = await res.json().catch(() => []);
  const txn = Array.isArray(data) ? data[0] : data;
  await auditWalletWrite({ action: "edit_expense", wallet_txn_id: walletTxnId, amount: patch.amount, currency: null, category: patch.category, note: patch.note }).catch(() => {});
  return txn;
}

module.exports = {
  getSummary, addExpense, getCategorySpend, getRecentExpenses, getExpensesByDate, getTxnsByRange, getCategoryBreakdown, getMemberTotals, inferCategory,
  getMembers, getMemberSpend, getLastM8Write, updateExpense,
  mintToken, HOUSEHOLD_ID, EXPENSE_CATEGORIES,
};
