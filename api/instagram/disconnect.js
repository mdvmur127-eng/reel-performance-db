const { json, methodNotAllowed, requireUser, supabaseRest } = require("../_lib/server");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    const user = await requireUser(req);

    await supabaseRest("instagram_connections", {
      method: "DELETE",
      query: { user_id: `eq.${user.id}` },
      prefer: "return=minimal",
    });

    await supabaseRest("instagram_oauth_states", {
      method: "DELETE",
      query: { user_id: `eq.${user.id}` },
      prefer: "return=minimal",
    });

    return json(res, 200, { ok: true });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return json(res, statusCode, { error: error.message || "Failed to disconnect Instagram." });
  }
};
