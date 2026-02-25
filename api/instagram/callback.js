const {
  envValue,
  getOrigin,
  getQueryParam,
  json,
  methodNotAllowed,
  redirectToApp,
  supabaseRest,
} = require("../_lib/server");

function appIdFromState(state) {
  const parts = String(state || "").split(".");
  if (parts.length < 2) return "";
  try {
    return Buffer.from(parts[parts.length - 1], "base64url").toString("utf8").trim();
  } catch {
    return "";
  }
}

async function exchangeCodeForToken({ code, redirectUri, instagramClientId, instagramClientSecret }) {
  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || "v22.0";
  const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", instagramClientId);
  tokenUrl.searchParams.set("client_secret", instagramClientSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  const response = await fetch(tokenUrl.toString(), { method: "GET" });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error_type || payload?.error_message || payload?.error) {
    const errorText = payload?.error_message || payload?.error?.message || "Failed to exchange auth code for token.";
    throw new Error(errorText);
  }

  const shortLivedToken = payload?.access_token;
  if (!shortLivedToken) {
    throw new Error("Meta did not return an access token.");
  }

  const longLivedUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
  longLivedUrl.searchParams.set("grant_type", "fb_exchange_token");
  longLivedUrl.searchParams.set("client_id", instagramClientId);
  longLivedUrl.searchParams.set("client_secret", instagramClientSecret);
  longLivedUrl.searchParams.set("fb_exchange_token", shortLivedToken);

  try {
    const longResponse = await fetch(longLivedUrl.toString());
    const longPayload = await longResponse.json().catch(() => ({}));
    if (longResponse.ok && longPayload?.access_token) {
      return {
        accessToken: longPayload.access_token,
        tokenType: longPayload.token_type || payload.token_type || "bearer",
        expiresIn: Number(longPayload.expires_in) || null,
      };
    }
  } catch {
    // Fall back to the short-lived token.
  }

  return {
    accessToken: shortLivedToken,
    tokenType: payload.token_type || "bearer",
    expiresIn: Number(payload.expires_in) || null,
  };
}

async function fetchInstagramUserId(accessToken) {
  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${graphVersion}/me/accounts`);
  url.searchParams.set("fields", "instagram_business_account{id}");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString(), { method: "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) return null;

  const pages = Array.isArray(payload?.data) ? payload.data : [];
  const page = pages.find((entry) => entry?.instagram_business_account?.id);
  return page?.instagram_business_account?.id || null;
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  try {
    const instagramClientSecret = envValue("INSTAGRAM_CLIENT_SECRET", "INSTAGRAM_APP_SECRET");
    if (!instagramClientSecret) {
      throw new Error(
        "Missing required Instagram secret: INSTAGRAM_CLIENT_SECRET (or INSTAGRAM_APP_SECRET).",
      );
    }

    const oauthError = getQueryParam(req, "error") || getQueryParam(req, "error_reason");
    const oauthErrorDescription = getQueryParam(req, "error_description");
    if (oauthError) {
      return redirectToApp(res, {
        ig_oauth: "error",
        ig_message: oauthErrorDescription || oauthError || "Instagram authorization was cancelled.",
      });
    }

    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      return redirectToApp(res, {
        ig_oauth: "error",
        ig_message: "Instagram callback is missing code or state.",
      });
    }

    const rows = await supabaseRest("instagram_oauth_states", {
      query: {
        select: "state,user_id,expires_at",
        state: `eq.${state}`,
        limit: 1,
      },
    });

    const stateRow = Array.isArray(rows) ? rows[0] : null;
    if (!stateRow?.user_id) {
      return redirectToApp(res, {
        ig_oauth: "error",
        ig_message: "OAuth state is invalid or expired.",
      });
    }

    const expiryMs = Date.parse(stateRow.expires_at || "");
    if (!Number.isFinite(expiryMs) || expiryMs < Date.now()) {
      await supabaseRest("instagram_oauth_states", {
        method: "DELETE",
        query: { state: `eq.${state}` },
        prefer: "return=minimal",
      });
      return redirectToApp(res, {
        ig_oauth: "error",
        ig_message: "OAuth state expired. Please connect Instagram again.",
      });
    }

    const requestOrigin = getOrigin(req);
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI || (requestOrigin ? `${requestOrigin}/api/instagram/callback` : "");
    if (!redirectUri) {
      throw new Error("Cannot determine OAuth redirect URI. Set INSTAGRAM_REDIRECT_URI in Vercel.");
    }
    const instagramClientId =
      envValue("INSTAGRAM_CLIENT_ID", "INSTAGRAM_APP_ID", "FACEBOOK_APP_ID") || appIdFromState(stateRow.state || state);
    if (!instagramClientId) {
      throw new Error(
        "Missing Instagram App ID for token exchange. Set INSTAGRAM_CLIENT_ID in Vercel or reconnect using App ID override.",
      );
    }
    const tokenResult = await exchangeCodeForToken({ code, redirectUri, instagramClientId, instagramClientSecret });
    const instagramUserId = await fetchInstagramUserId(tokenResult.accessToken);
    if (!instagramUserId) {
      throw new Error("Could not resolve Instagram user id from token. Reconnect Instagram and approve all requested permissions.");
    }

    const expiresAt =
      tokenResult.expiresIn && tokenResult.expiresIn > 0
        ? new Date(Date.now() + tokenResult.expiresIn * 1000).toISOString()
        : null;

    await supabaseRest("instagram_connections", {
      method: "POST",
      query: { on_conflict: "user_id" },
      body: [
        {
          user_id: stateRow.user_id,
          access_token: tokenResult.accessToken,
          instagram_user_id: instagramUserId,
          token_type: tokenResult.tokenType,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        },
      ],
      prefer: "resolution=merge-duplicates,return=minimal",
    });

    await supabaseRest("instagram_oauth_states", {
      method: "DELETE",
      query: { state: `eq.${state}` },
      prefer: "return=minimal",
    });

    return redirectToApp(res, {
      ig_oauth: "success",
      ig_message: "Instagram connected successfully.",
    });
  } catch (error) {
    return redirectToApp(res, {
      ig_oauth: "error",
      ig_message: error.message || "Instagram OAuth callback failed.",
    });
  }
};
