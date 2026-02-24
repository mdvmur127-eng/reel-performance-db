const { json, methodNotAllowed, requireUser, supabaseRest } = require("../_lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return methodNotAllowed(res, ["GET"]);
  }

  try {
    const user = await requireUser(req);

    const rows = await supabaseRest("instagram_connections", {
      query: {
        select: "user_id,created_at,updated_at,expires_at",
        user_id: `eq.${user.id}`,
        limit: 1,
      },
    });

    const connection = Array.isArray(rows) ? rows[0] : null;
    return json(res, 200, {
      connected: Boolean(connection),
      expiresAt: connection?.expires_at || null,
      updatedAt: connection?.updated_at || null,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return json(res, statusCode, { error: error.message || "Failed to fetch Instagram connection status." });
  }
};
