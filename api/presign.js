"use strict";

/**
 * api/presign.js — Issue a Supabase Storage signed upload URL
 *
 * The browser uploads large files (PDF, EPUB) directly to Supabase Storage
 * to bypass Vercel's 4.5 MB serverless body limit.  After upload the frontend
 * calls /api/upload-file with { storagePath } — the heavy binary never passes
 * through Vercel.
 *
 * POST /api/presign
 * Body: { name: string, mimeType?: string }
 * Returns: { uploadUrl, path }
 */

const { createClient } = require("@supabase/supabase-js");

const BUCKET = "temp-uploads";

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { name, mimeType } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: "Supabase not configured" });
  }

  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Safe filename: strip anything that isn't alphanumeric, dot, dash or underscore
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  const path     = `${Date.now()}-${safeName}`;

  const { data, error } = await sb.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) {
    console.error("[presign]", error.message);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ uploadUrl: data.signedUrl, path });
};
