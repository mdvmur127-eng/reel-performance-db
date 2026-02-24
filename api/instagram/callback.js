const {
  getOrigin,
  getQueryParam,
  json,
  methodNotAllowed,
  redirectToApp,
  requireEnv,
  supabaseRest,
} = require("../_lib/server");

async function exchangeCodeForToken({ code, redirectUri }) {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_CLIENT_ID,
    client_secret: process.env.INSTAGRAM_CLIENT_SECRET,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error_type || payload?.error_message || payload?.error) {
    const errorText = payload?.error_message || payload?.error?.message || "Failed to exchange auth code for token.";
    throw new Error(errorText);
  }

  const shortToken = payload?.access_token;
  if (!shortToken) {
    throw new Error("Meta did not return an access token.");
  }

  const longLivedUrl = new URL("https://graph.instagram.com/access_token");
  longLivedUrl.searchParams.set("grant_type", "ig_exchange_token");
  longLivedUrl.searchParams.set("client_secret", process.env.INSTAGRAM_CLIENT_SECRET);
  longLivedUrl.searchParams.set("access_token", shortToken);

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
    accessToken: shortToken,
    tokenType: payload.token_type || "bearer",
    expiresIn: Number(payload.expires_in) || null,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  try {
    requireEnv([
      "INSTAGRAM_CLIENT_ID",
      "INSTAGRAM_CLIENT_SECRET",
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    ]);

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
    const tokenResult = await exchangeCodeForToken({ code, redirectUri });

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
