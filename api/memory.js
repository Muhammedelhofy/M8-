/**
 * M8 Memory — Supabase read/write
 * Handles cross-session recall so M8 remembers past conversations.
 */
const { createClient } = require("@supabase/supabase-js");

function getClient() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

/**
 * Recall recent messages from PAST sessions (not the current one).
 * Returns them in chronological order, ready to inject as context.
 * Fails silently — memory is non-fatal.
 */
async function recallMemory(currentSessionId, limit = 20) {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from("m8_conversations")
      .select("role, content, session_id")
      .neq("session_id", currentSessionId)
      .order("id", { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) return [];

    // Reverse to get chronological order (oldest first)
    return data.reverse();
  } catch (err) {
    console.error("Memory recall error (non-fatal):", err.message);
    return [];
  }
}

/**
 * Save a user/assistant exchange to Supabase.
 * Fails silently — never blocks the response.
 */
async function saveMemory(sessionId, userMessage, assistantResponse) {
  try {
    const supabase = getClient();
    await supabase.from("m8_conversations").insert([
      { session_id: sessionId, role: "user",      content: userMessage },
      { session_id: sessionId, role: "assistant", content: assistantResponse },
    ]);
  } catch (err) {
    console.error("Memory save error (non-fatal):", err.message);
  }
}

module.exports = { recallMemory, saveMemory };
