/**
 * M8 Deck Endpoint — POST /api/deck
 * Thin HTTP handler. Builds a deck SPEC + Marp + reveal.js HTML server-side and
 * returns them as JSON; the frontend renders download buttons and builds the
 * actual files client-side (.md/.html via Blob, .pptx via pptxgenjs in-browser).
 * Separate from /api/chat so decks bypass the voice/streaming flow entirely.
 */
const { buildDeck } = require("../deckgen");

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({ ok: false, error: "GEMINI_API_KEY not configured" });
  }

  try {
    const { message, history } = req.body || {};
    if (!message) return res.status(400).json({ ok: false, error: "Message required" });

    const deck = await buildDeck({ message, history });
    if (!deck.ok) {
      return res.status(200).json({ ok: false, error: "I couldn't build a deck from that — tell me the topic and audience and I'll try again." });
    }
    return res.status(200).json(deck);
  } catch (error) {
    console.error("[M8] /api/deck error:", error?.message || error);
    return res.status(500).json({ ok: false, error: error?.message || "deck generation failed" });
  }
};
