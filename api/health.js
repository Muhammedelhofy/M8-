module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const status = {
    ok: true,
    timestamp: new Date().toISOString(),
    model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
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
