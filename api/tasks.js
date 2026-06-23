// M8 Tasks v1 — simple to-do CRUD backed by m8_tasks (M8's own Supabase, NOT the
// Wallet). Server-side service key. GET list / POST add / PATCH toggle-or-edit /
// DELETE remove. The chat-driven "remind me to…" management is a later build.
const { createClient } = require("@supabase/supabase-js");

function db() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Only two buckets are supported; anything else falls back to 'personal'.
function normCategory(c) {
  return String(c || "").toLowerCase().trim() === "work" ? "work" : "personal";
}

const RECURS = ["daily", "weekly", "monthly"];
function normRecur(r) { return RECURS.indexOf(String(r || "").toLowerCase()) >= 0 ? String(r).toLowerCase() : null; }
// Next occurrence date (YYYY-MM-DD, KSA) for a recurring task just completed.
function nextDue(curDueISO, recur) {
  var base = new Date((curDueISO ? String(curDueISO).slice(0, 10) : new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10)) + "T00:00:00Z");
  if (recur === "daily") base.setUTCDate(base.getUTCDate() + 1);
  else if (recur === "weekly") base.setUTCDate(base.getUTCDate() + 7);
  else if (recur === "monthly") base.setUTCMonth(base.getUTCMonth() + 1);
  else return null;
  return base.getUTCFullYear() + "-" + String(base.getUTCMonth() + 1).padStart(2, "0") + "-" + String(base.getUTCDate()).padStart(2, "0");
}

module.exports = async (req, res) => {
  try {
    const sb = db();

    if (req.method === "GET") {
      let q = sb
        .from("m8_tasks")
        .select("*")
        .order("done", { ascending: true })
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(200);
      // Optional ?category=work|personal filter (frontend tab / chat lane).
      const cat = req.query && req.query.category;
      if (cat === "work" || cat === "personal") q = q.eq("category", cat);
      const { data, error } = await q;
      if (error) throw error;
      return res.status(200).json({ tasks: data || [] });
    }

    if (req.method === "POST") {
      const { title, due_at, priority, category, recur } = req.body || {};
      if (!title || !String(title).trim()) return res.status(400).json({ error: "title required" });
      const row = { title: String(title).trim().slice(0, 400), category: normCategory(category) };
      if (due_at) row.due_at = due_at;
      if (priority) row.priority = String(priority).slice(0, 20);
      if (normRecur(recur)) row.recur = normRecur(recur);
      const { data, error } = await sb.from("m8_tasks").insert(row).select().single();
      if (error) throw error;
      return res.status(200).json({ task: data });
    }

    if (req.method === "PATCH") {
      const { id, done, title, due_at, category, recur } = req.body || {};
      if (!id) return res.status(400).json({ error: "id required" });
      const patch = {};
      if (typeof done === "boolean") { patch.done = done; patch.completed_at = done ? new Date().toISOString() : null; }
      if (title != null) patch.title = String(title).trim().slice(0, 400);
      if (due_at !== undefined) patch.due_at = due_at || null;
      if (category != null) patch.category = normCategory(category);
      if (recur !== undefined) patch.recur = normRecur(recur);
      const { data, error } = await sb.from("m8_tasks").update(patch).eq("id", id).select().single();
      if (error) throw error;
      // Recurring task just completed → spawn the next occurrence (keeps history).
      if (done === true && data && data.recur) {
        try { await sb.from("m8_tasks").insert({ title: data.title, category: data.category || "personal", recur: data.recur, due_at: nextDue(data.due_at, data.recur) }); } catch (_) {}
      }
      return res.status(200).json({ task: data });
    }

    if (req.method === "DELETE") {
      const id = (req.body && req.body.id) || (req.query && req.query.id);
      if (!id) return res.status(400).json({ error: "id required" });
      const { error } = await sb.from("m8_tasks").delete().eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    console.error("[tasks] error", e && e.message);
    return res.status(500).json({ error: "server error" });
  }
};

module.exports.config = { maxDuration: 15 };
