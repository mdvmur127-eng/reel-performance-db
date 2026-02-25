const {
  envValue,
  getOrigin,
  json,
  methodNotAllowed,
  randomState,
  readJsonBody,
  requireUser,
  supabaseRest,
} = require("../_lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    const body = await readJsonBody(req).catch(() => ({}));
    const appIdOverride = String(body?.appId || body?.instagramClientId || "").trim();
    const instagramClientId = envValue("INSTAGRAM_CLIENT_ID", "INSTAGRAM_APP_ID", "FACEBOOK_APP_ID") || appIdOverride;
    if (!instagramClientId) {
      throw new Error(
        "Missing App ID. Set INSTAGRAM_CLIENT_ID in Vercel or paste Meta App ID in the app field before connecting.",
      );
    }
    const user = await requireUser(req);
    const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || "v22.0";
    const oauthScopes =
      process.env.INSTAGRAM_OAUTH_SCOPES ||
      "instagram_basic,instagram_manage_insights,pages_show_list,pages_read_engagement";

    const state = `${randomState(20)}.${Buffer.from(instagramClientId, "utf8").toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseRest("instagram_oauth_states", {
      method: "POST",
      body: [{ state, user_id: user.id, expires_at: expiresAt }],
      prefer: "return=minimal",
    });

    const requestOrigin = getOrigin(req);
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || (requestOrigin ? `${requestOrigin}/api/instagram/callback` : "");
    if (!redirectUri) {
      throw new Error("Cannot determine OAuth redirect URI. Set INSTAGRAM_REDIRECT_URI in Vercel.");
    }

    const authUrl = new URL(`https://www.facebook.com/${graphVersion}/dialog/oauth`);
    authUrl.searchParams.set("client_id", instagramClientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", oauthScopes);
    authUrl.searchParams.set("state", state);

    return json(res, 200, { authUrl: authUrl.toString() });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return json(res, statusCode, { error: error.message || "Failed to start Instagram OAuth." });
  }
};
