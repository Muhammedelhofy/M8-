module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const status = {
    ok: true,
    timestamp: new Date().toISOString(),
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
    // Deploy identity (set automatically by Vercel at build time) so a live
    // test can confirm WHICH commit is serving before trusting a result --
    // closes the push->serve lag gap the live-test docs warn about.
    deploy: {
      sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      ref: process.env.VERCEL_GIT_COMMIT_REF || null,
      env: process.env.VERCEL_ENV || null,
    },
    checks: {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      SUPABASE_URL: !!process.env.SUPABASE_URL,
      SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY,
    },
  };

  if (!status.checks.GEMINI_API_KEY) {
    status.ok = false;
    status.error = "GEMINI_API_KEY is not set";
  }

  return res.status(status.ok ? 200 : 500).json(status);
};
