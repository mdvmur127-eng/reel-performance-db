"use strict";

const {
  getRequiredEnv,
  requireAuthenticatedUser,
  selectRows,
} = require("../../lib/supabaseAdmin");
const { InstagramReconnectError } = require("../../lib/instagram");
const { DEFAULT_SYNC_LIMIT, syncInstagramReelsForUserConnection } = require("../../lib/instagramReelsSync");

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, methods) {
  res.setHeader("Allow", methods.join(", "));
  return json(res, 405, { error: `Method not allowed. Use: ${methods.join(", ")}` });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    getRequiredEnv();
    const user = await requireAuthenticatedUser(req);

    const connectionRows = await selectRows("instagram_connections", {
      select: "user_id,access_token,instagram_user_id,expires_at",
      user_id: `eq.${user.id}`,
      limit: 1,
    });
    const connection = Array.isArray(connectionRows) ? connectionRows[0] : null;
    if (!connection?.access_token || !connection?.instagram_user_id) {
      return json(res, 404, { error: "Instagram not connected" });
    }

    const result = await syncInstagramReelsForUserConnection({
      userId: user.id,
      accessToken: connection.access_token,
      instagramUserId: connection.instagram_user_id,
      limit: DEFAULT_SYNC_LIMIT,
    });

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
