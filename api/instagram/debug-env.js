const { json, methodNotAllowed } = require("../_lib/server");

function envSource(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return { key: name, value: String(value).trim() };
    }
  }
  return { key: null, value: "" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  const appIdSource = envSource(
    "INSTAGRAM_CLIENT_ID",
    "INSTAGRAM_APP_ID",
    "FACEBOOK_APP_ID",
    "NEXT_PUBLIC_INSTAGRAM_CLIENT_ID",
    "NEXT_PUBLIC_FACEBOOK_APP_ID",
  );
  const appSecretSource = envSource("INSTAGRAM_CLIENT_SECRET", "INSTAGRAM_APP_SECRET", "FACEBOOK_APP_SECRET");
  const redirectUriSource = envSource("INSTAGRAM_REDIRECT_URI");
  const supabaseUrlSource = envSource("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const supabaseServiceRoleSource = envSource(
    "SUPABASE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE",
    "SUPABASE_SERVICE_KEY",
    "SUPABASE_SECRET_KEY",
  );
  const appId = appIdSource.value;
  const appSecret = appSecretSource.value;
  const redirectUri = redirectUriSource.value;
  const supabaseUrl = supabaseUrlSource.value;
  const supabaseServiceRole = supabaseServiceRoleSource.value;
  const requestHost = String(req.headers?.host || "");
  let redirectHost = "";
  try {
    redirectHost = redirectUri ? new URL(redirectUri).host : "";
  } catch {
    redirectHost = "";
  }

  return json(res, 200, {
    ok: Boolean(appId && appSecret && redirectUri && supabaseUrl && supabaseServiceRole),
    env: process.env.VERCEL_ENV || "unknown",
    vercelUrl: process.env.VERCEL_URL || "",
    vercelProjectId: process.env.VERCEL_PROJECT_ID || "",
    vercelGitCommitSha: process.env.VERCEL_GIT_COMMIT_SHA || "",
    vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF || "",
    hasInstagramClientId: Boolean(appId),
    hasInstagramClientSecret: Boolean(appSecret),
    hasInstagramRedirectUri: Boolean(redirectUri),
    hasSupabaseUrl: Boolean(supabaseUrl),
    hasSupabaseServiceRole: Boolean(supabaseServiceRole),
    instagramClientIdSource: appIdSource.key,
    instagramClientSecretSource: appSecretSource.key,
    instagramRedirectUriSource: redirectUriSource.key,
    instagramRedirectUriValue: redirectUri || "",
    instagramRedirectUriHost: redirectHost,
    requestHost,
    isRedirectHostMatchingRequestHost: Boolean(redirectHost && requestHost && redirectHost === requestHost),
    supabaseUrlSource: supabaseUrlSource.key,
    supabaseServiceRoleSource: supabaseServiceRoleSource.key,
    deploymentHost: req.headers?.host || "",
  });
};
