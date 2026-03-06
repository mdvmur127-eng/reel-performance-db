"use strict";

const {
  json,
  methodNotAllowed,
  requireUser,
  supabaseRest,
} = require("../_lib/server");
const { InstagramReconnectError } = require("../../lib/instagram");
const { DEFAULT_SYNC_LIMIT, syncInstagramReelsForUserConnection } = require("../../lib/instagramReelsSync");

async function fetchInstagramUserId(accessToken) {
  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || "v22.0";
  const url = new URL(`https://graph.facebook.com/${graphVersion}/me/accounts`);
  url.searchParams.set("fields", "instagram_business_account{id}");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url.toString(), { method: "GET" });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) return "";

  const pages = Array.isArray(payload?.data) ? payload.data : [];
  const page = pages.find((entry) => entry?.instagram_business_account?.id);
  return String(page?.instagram_business_account?.id || "").trim();
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    const user = await requireUser(req);
    console.log("[sync-reels] User resolved", { userId: user.id });

    const connectionRows = await supabaseRest("instagram_connections", {
      query: {
        select: "user_id,access_token,instagram_user_id,expires_at",
        user_id: `eq.${user.id}`,
        limit: 1,
      },
    });
    const connection = Array.isArray(connectionRows) ? connectionRows[0] : null;
    if (!connection?.access_token) {
      return json(res, 404, { error: "Instagram not connected" });
    }
    console.log("[sync-reels] Instagram token found", {
      hasAccessToken: Boolean(connection?.access_token),
      hasInstagramUserId: Boolean(connection?.instagram_user_id),
    });

    const persistInstagramUserId = async (nextInstagramUserId) => {
      if (!nextInstagramUserId) return;
      await supabaseRest("instagram_connections", {
        method: "PATCH",
        query: { user_id: `eq.${user.id}` },
        body: { instagram_user_id: nextInstagramUserId, updated_at: new Date().toISOString() },
        prefer: "return=minimal",
      });
    };

    let instagramUserId = String(connection.instagram_user_id || "").trim();
    if (!instagramUserId) {
      instagramUserId = await fetchInstagramUserId(connection.access_token);
      if (instagramUserId) {
        await persistInstagramUserId(instagramUserId);
      }
    }
    if (!instagramUserId) {
      return json(res, 401, { error: "Reconnect Instagram" });
    }

    let result;
    try {
      result = await syncInstagramReelsForUserConnection({
        userId: user.id,
        accessToken: connection.access_token,
        instagramUserId,
        limit: DEFAULT_SYNC_LIMIT,
      });
    } catch (error) {
      if (!(error instanceof InstagramReconnectError)) throw error;

      // Retry once with a freshly resolved IG user id to handle stale id mismatches.
      const refreshedInstagramUserId = await fetchInstagramUserId(connection.access_token);
      if (!refreshedInstagramUserId) {
        return json(res, 401, { error: "Reconnect Instagram" });
      }
      if (refreshedInstagramUserId !== instagramUserId) {
        instagramUserId = refreshedInstagramUserId;
        await persistInstagramUserId(instagramUserId);
      }

      result = await syncInstagramReelsForUserConnection({
        userId: user.id,
        accessToken: connection.access_token,
        instagramUserId,
        limit: DEFAULT_SYNC_LIMIT,
      });
    }

    console.log("[sync-reels] Fetched/merged reels", result);

    return json(res, 200, result);
  } catch (error) {
    if (error instanceof InstagramReconnectError) {
      return json(res, 401, { error: "Reconnect Instagram" });
    }

    if (error?.code === "MISSING_ENV") {
      console.error(`[sync-reels] ${error.message}`);
      return json(res, 500, { error: "Server configuration error" });
    }

    const message = String(error?.message || "");
    if (/column .* does not exist|could not find the '.*' column/i.test(message)) {
      return json(res, 400, {
        error: "Supabase schema is missing required reels columns. Run the latest SQL migration and retry.",
      });
    }
    if (/access token|oauth|session has expired/i.test(message)) {
      return json(res, 401, { error: "Reconnect Instagram" });
    }

    const statusCode = Number(error?.statusCode) || 500;
    return json(res, statusCode, { error: statusCode >= 500 ? "Sync failed" : message || "Sync failed" });
  }
};
