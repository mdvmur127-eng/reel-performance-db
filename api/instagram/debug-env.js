const { envValue, json, methodNotAllowed } = require("../_lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  const appId = envValue(
    "INSTAGRAM_CLIENT_ID",
    "INSTAGRAM_APP_ID",
    "FACEBOOK_APP_ID",
    "NEXT_PUBLIC_INSTAGRAM_CLIENT_ID",
    "NEXT_PUBLIC_FACEBOOK_APP_ID",
  );
  const appSecret = envValue("INSTAGRAM_CLIENT_SECRET", "INSTAGRAM_APP_SECRET", "FACEBOOK_APP_SECRET");
  const redirectUri = envValue("INSTAGRAM_REDIRECT_URI");
  const supabaseUrl = envValue("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRole = envValue(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SECRET_KEY",
  );

  return json(res, 200, {
    ok: Boolean(appId && appSecret && redirectUri && supabaseUrl && supabaseServiceRole),
    env: process.env.VERCEL_ENV || "unknown",
    hasInstagramClientId: Boolean(appId),
    hasInstagramClientSecret: Boolean(appSecret),
    hasInstagramRedirectUri: Boolean(redirectUri),
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSupabaseServiceRole: Boolean(supabaseServiceRole),
    deploymentHost: req.headers?.host || "",
  });
};

