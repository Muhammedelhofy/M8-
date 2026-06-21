/**
 * api/files.js — Router (Hobby 12-function consolidation, 2026-06-21)
 *
 * presign + upload-file share ONE serverless function, dispatched by ?fn=. The
 * handler bodies are UNCHANGED — each lives verbatim in lib/handlers/. vercel.json
 * rewrites keep the original URLs working:
 *   /api/presign     -> /api/files?fn=presign  (POST signed upload URL / DELETE cleanup)
 *   /api/upload-file -> /api/files?fn=upload    (POST base64-or-storage doc -> text)
 *
 * bodyParser is raised to 20mb here (the function entry point) because upload-file
 * may receive an inline base64 document — same limit the original endpoint set.
 */
"use strict";

const presign    = require("../lib/handlers/presign");
const uploadFile = require("../lib/handlers/upload-file");

module.exports = async (req, res) => {
  const fn = String((req.query && req.query.fn) || "").toLowerCase();
  switch (fn) {
    case "presign": return presign(req, res);
    case "upload":  return uploadFile(req, res);
    default:
      return res.status(404).json({ error: `unknown files fn: '${fn}'` });
  }
};

// bodyParser 20mb covers an ~14MB binary base64-encoded (mirrors upload-file).
// maxDuration (300) is set in vercel.json, as it was for the original endpoint.
module.exports.config = { api: { bodyParser: { sizeLimit: "20mb" } } };
