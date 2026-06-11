/**
 * M8 Lean check client — Build-9 Step 3.
 *
 * Thin HTTP wrapper around the `m8-lean-check` Cloud Run service (/check).
 * The service contract (see LEAN_INFRA_DESIGN.md §2):
 *   POST /check  { code, imports:["Mathlib"], timeout_s }
 *   → 200 { verified, errors:[], sorries:[], elapsed_ms, toolchain, mathlib }
 *
 * Fails SAFE: a cold/timed-out/unreachable service NEVER throws to the caller —
 * it returns a status the orchestrator narrates honestly ('lean_pending' /
 * 'lean_error'), so a Lean turn can never block or crash the chat.
 *
 * Env: LEAN_CHECK_URL (base, e.g. https://m8-lean-check-xxxx.run.app)
 *      LEAN_CHECK_TOKEN (shared bearer secret; optional)
 */

// Client-side budget. The orchestrator turn can't wait minutes for a cold
// container — if the service hasn't answered in this window we call it pending
// and tell the user this turn (capability-honesty: no "let me check" promises).
const CLIENT_BUDGET_MS = parseInt(process.env.LEAN_CHECK_CLIENT_BUDGET_MS || "55000", 10);

async function runLeanCheck({ code, imports = ["Mathlib"], timeoutS = 60 } = {}) {
  const base  = process.env.LEAN_CHECK_URL;
  const token = process.env.LEAN_CHECK_TOKEN;
  if (!base)         return { ok: false, status: "lean_error",  reason: "LEAN_CHECK_URL not set" };
  if (!code || !code.trim()) return { ok: false, status: "lean_error", reason: "empty code" };

  const url = base.replace(/\/+$/, "") + "/check";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_BUDGET_MS);

  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body:    JSON.stringify({ code, imports, timeout_s: timeoutS }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    // 503/504 = cold instance still warming or gateway timeout → pending, retry next ask.
    if (res.status === 503 || res.status === 504) {
      return { ok: false, status: "lean_pending", reason: `service ${res.status} (warming?)` };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, status: "lean_error", reason: `${res.status}: ${body.slice(0, 200)}` };
    }

    const data = await res.json().catch(() => null);
    if (!data || typeof data !== "object") {
      return { ok: false, status: "lean_error", reason: "non-JSON response" };
    }
    return { ok: true, status: "ok", data };
  } catch (err) {
    clearTimeout(timer);
    if (err && err.name === "AbortError") {
      return { ok: false, status: "lean_pending", reason: "client timeout (cold instance?)" };
    }
    return { ok: false, status: "lean_error", reason: String(err && err.message || err).slice(0, 200) };
  }
}

module.exports = { runLeanCheck };
