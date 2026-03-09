"use strict";

const { json, methodNotAllowed, requireUser, supabaseRest } = require("../_lib/server");

const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const MAX_REELS = 20;
const REQUEST_TIMEOUT_MS = 20000;

class InstagramReconnectError extends Error {
  constructor(message = "Reconnect Instagram") {
    super(message);
    this.name = "InstagramReconnectError";
    this.statusCode = 401;
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function toNonNegativeInt(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.round(numeric);
}

function parseInsightValue(entry) {
  const raw = entry?.value ?? entry?.values?.[0]?.value ?? 0;
  return toNonNegativeInt(raw);
}

function isTokenError(payload, statusCode) {
  const code = Number(payload?.error?.code);
  const subcode = Number(payload?.error?.error_subcode);
  const type = String(payload?.error?.type || "").toLowerCase();
  const message = String(payload?.error?.message || "").toLowerCase();
  return (
    statusCode === 401 ||
    code === 190 ||
    subcode === 463 ||
    type.includes("oauth") ||
    message.includes("access token") ||
    message.includes("oauth") ||
    message.includes("session has expired")
  );
}

async function graphRequest(urlString, timeoutMessage) {
  const response = await withTimeout(fetch(urlString), REQUEST_TIMEOUT_MS, timeoutMessage);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    if (isTokenError(payload, response.status)) {
      throw new InstagramReconnectError();
    }
    const error = new Error(
      payload?.error?.message ||
        payload?.message ||
        payload?.error_description ||
        `Instagram request failed (${response.status}).`,
    );
    error.statusCode = response.status || 500;
    throw error;
  }
  return payload;
}

function normalizeAccessToken(value) {
  let token = String(value || "").trim();
  if (!token) return "";

  token = token
    .replace(/^bearer\s+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  const tokenMatch = token.match(/(?:^|[?#&])access_token=([^&#]+)/i);
  if (tokenMatch?.[1]) {
    token = decodeURIComponent(tokenMatch[1]);
  }

  token = token.replace(/\s+/g, "");
  return token;
}

function stringOrEmpty(value) {
  return String(value || "").trim();
}

function pickFirstNonEmptyString(source, keys) {
  for (const key of keys) {
    const value = stringOrEmpty(source?.[key]);
    if (value) return value;
  }
  return "";
}

function firstCaptionLine(caption, fallback) {
  const first = String(caption || "").split("\n")[0].trim();
  return first || fallback;
}

function normalizeIso(value) {
  const raw = stringOrEmpty(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

async function loadUserConnection(userId) {
  const rows = await supabaseRest("instagram_connections", {
    query: {
      select: "*",
      user_id: `eq.${userId}`,
      limit: "1",
    },
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function persistInstagramUserId(userId, igUserId) {
  if (!igUserId) return;
  try {
    await supabaseRest("instagram_connections", {
      method: "PATCH",
      query: { user_id: `eq.${userId}` },
      body: {
        instagram_user_id: igUserId,
        updated_at: new Date().toISOString(),
      },
      prefer: "return=minimal",
    });
  } catch {
    // Non-critical write; do not fail sync on this.
  }
}

async function loadConnectedInstagramAccount(userAccessToken, fallbackIgUserId = "") {
  const pagesUrl = new URL(`${GRAPH_BASE}/me/accounts`);
  pagesUrl.searchParams.set("access_token", userAccessToken);
  pagesUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account{id}");
  pagesUrl.searchParams.set("limit", "50");

  const pagesPayload = await graphRequest(pagesUrl.toString(), "Instagram pages request timed out.");
  const pages = Array.isArray(pagesPayload?.data) ? pagesPayload.data : [];

  const pageWithIg = pages.find((item) => stringOrEmpty(item?.instagram_business_account?.id));
  if (pageWithIg) {
    return {
      pageToken: normalizeAccessToken(pageWithIg.access_token) || userAccessToken,
      igUserId: stringOrEmpty(pageWithIg.instagram_business_account?.id),
    };
  }

  const firstPage = pages.find((item) => stringOrEmpty(item?.id));
  if (firstPage) {
    const pageToken = normalizeAccessToken(firstPage.access_token) || userAccessToken;
    const igAccountUrl = new URL(`${GRAPH_BASE}/${firstPage.id}`);
    igAccountUrl.searchParams.set("access_token", pageToken);
    igAccountUrl.searchParams.set("fields", "instagram_business_account{id}");

    const pagePayload = await graphRequest(igAccountUrl.toString(), "Instagram account lookup timed out.");
    const igUserId = stringOrEmpty(pagePayload?.instagram_business_account?.id);
    if (igUserId) {
      return { pageToken, igUserId };
    }
  }

  if (fallbackIgUserId) {
    return {
      pageToken: userAccessToken,
      igUserId: fallbackIgUserId,
    };
  }

  const error = new Error(
    "No Instagram Business/Creator account is linked to this Facebook page.",
  );
  error.statusCode = 400;
  throw error;
}

async function fetchAllReels({ pageToken, igUserId }) {
  const allReels = [];
  let afterCursor = "";

  while (true) {
    const mediaUrl = new URL(`${GRAPH_BASE}/${igUserId}/media`);
    mediaUrl.searchParams.set(
      "fields",
      "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp",
    );
    mediaUrl.searchParams.set("limit", "50");
    mediaUrl.searchParams.set("access_token", pageToken);
    if (afterCursor) mediaUrl.searchParams.set("after", afterCursor);

    const mediaPayload = await graphRequest(mediaUrl.toString(), "Instagram media request timed out.");
    const mediaItems = Array.isArray(mediaPayload?.data) ? mediaPayload.data : [];

    for (const item of mediaItems) {
      const mediaProductType = String(item?.media_product_type || "").toUpperCase();
      const mediaType = String(item?.media_type || "").toUpperCase();
      if (mediaProductType === "REELS" || mediaType === "REELS") {
        allReels.push(item);
      }
    }

    const nextCursor = String(mediaPayload?.paging?.cursors?.after || "").trim();
    if (!nextCursor || nextCursor === afterCursor) {
      break;
    }
    afterCursor = nextCursor;
  }

  allReels.sort((a, b) => {
    const aTs = Date.parse(String(a?.timestamp || ""));
    const bTs = Date.parse(String(b?.timestamp || ""));
    if (Number.isFinite(aTs) && Number.isFinite(bTs)) return bTs - aTs;
    return 0;
  });

  return allReels.slice(0, MAX_REELS);
}

async function fetchReelInsights({ pageToken, mediaId }) {
  const insightsUrl = new URL(`${GRAPH_BASE}/${mediaId}/insights`);
  insightsUrl.searchParams.set("access_token", pageToken);
  insightsUrl.searchParams.set("metric", "plays,reach,saved,likes,comments,shares");

  const payload = await graphRequest(insightsUrl.toString(), "Instagram insights request timed out.");
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const map = new Map(data.map((entry) => [String(entry?.name || "").toLowerCase(), parseInsightValue(entry)]));

  return {
    plays: toNonNegativeInt(map.get("plays")),
    reach: toNonNegativeInt(map.get("reach")),
    likes: toNonNegativeInt(map.get("likes")),
    comments: toNonNegativeInt(map.get("comments")),
    shares: toNonNegativeInt(map.get("shares")),
    saved: toNonNegativeInt(map.get("saved")),
  };
}

async function upsertReels(rows) {
  if (!rows.length) return;

  try {
    await supabaseRest("reels", {
      method: "POST",
      query: { on_conflict: "user_id,ig_media_id" },
      body: rows,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return;
  } catch (error) {
    const message = String(error?.message || "");
    const shouldRetryLegacy =
      /ig_media_id/i.test(message) ||
      /no unique or exclusion constraint matching the on conflict specification/i.test(message);
    if (!shouldRetryLegacy) throw error;
  }

  await supabaseRest("reels", {
    method: "POST",
    query: { on_conflict: "user_id,instagram_media_id" },
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    const user = await requireUser(req);

    const connection = await loadUserConnection(user.id);
    const userAccessToken = normalizeAccessToken(
      pickFirstNonEmptyString(connection, [
        "access_token",
        "instagram_access_token",
        "user_access_token",
        "token",
      ]),
    );

    if (!userAccessToken) {
      return json(res, 404, { error: "Instagram not connected" });
    }

    const storedIgUserId = pickFirstNonEmptyString(connection, [
      "instagram_user_id",
      "ig_user_id",
      "instagram_business_account_id",
      "instagram_account_id",
    ]);

    const account = await loadConnectedInstagramAccount(userAccessToken, storedIgUserId);
    const igUserId = account.igUserId;
    const pageToken = normalizeAccessToken(account.pageToken) || userAccessToken;

    await persistInstagramUserId(user.id, igUserId);

    console.log("IG user id:", igUserId);

    const reels = await fetchAllReels({ pageToken, igUserId });
    console.log("Reels found:", reels.length);

    if (!reels.length) {
      return json(res, 200, { success: true, synced: 0, new: 0, updated: 0, reels_synced: 0 });
    }

    const existingRows = await supabaseRest("reels", {
      query: {
        select: "*",
        user_id: `eq.${user.id}`,
      },
    });
    const existingMediaIds = new Set();
    (Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
      const igMediaId = stringOrEmpty(row?.ig_media_id);
      const legacyMediaId = stringOrEmpty(row?.instagram_media_id);
      if (igMediaId) existingMediaIds.add(igMediaId);
      if (legacyMediaId) existingMediaIds.add(legacyMediaId);
    });

    const nowIso = new Date().toISOString();
    let newCount = 0;

    const rowsToUpsert = [];
    for (const reel of reels) {
      const mediaId = stringOrEmpty(reel?.id);
      if (!mediaId) continue;

      const metrics = await fetchReelInsights({ pageToken, mediaId });
      const permalink = stringOrEmpty(reel?.permalink) || `https://www.instagram.com/reel/${mediaId}/`;
      const publishedAt = normalizeIso(reel?.timestamp) || nowIso;
      const caption = stringOrEmpty(reel?.caption) || null;

      if (!existingMediaIds.has(mediaId)) newCount += 1;

      rowsToUpsert.push({
        user_id: user.id,
        ig_media_id: mediaId,
        instagram_media_id: mediaId,
        caption,
        media_url: stringOrEmpty(reel?.media_url) || null,
        thumbnail_url: stringOrEmpty(reel?.thumbnail_url) || null,
        permalink,
        posted_at: publishedAt,
        plays: metrics.plays,
        reach: metrics.reach,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saved: metrics.saved,
        last_synced_at: nowIso,

        // Keep existing app table contract satisfied.
        created_at: nowIso,
        published_at: publishedAt,
        title: firstCaptionLine(caption, `Instagram Reel ${mediaId}`),
        url: permalink,
        views: metrics.plays,
        saves: metrics.saved,
        follows: 0,
        top_source_of_views: "Reels tab",
      });
    }

    await upsertReels(rowsToUpsert);

    const synced = rowsToUpsert.length;
    return json(res, 200, {
      success: true,
      synced,
      new: newCount,
      updated: synced - newCount,
      reels_synced: synced,
    });
  } catch (error) {
    if (error instanceof InstagramReconnectError) {
      return json(res, 401, { error: "Reconnect Instagram" });
    }

    const statusCode = Number(error?.statusCode) || 500;
    const message = String(error?.message || "Sync failed");

    if (/column .* does not exist|could not find the '.*' column/i.test(message)) {
      return json(res, 400, {
        error: "Supabase schema is missing required reels columns. Run the latest SQL migration and retry.",
      });
    }

    if (/missing authorization bearer token|no authenticated user found/i.test(message.toLowerCase())) {
      return json(res, 401, { error: "You are not logged in. Please sign in again." });
    }

    return json(res, statusCode, {
      error: statusCode >= 500 ? "Sync failed" : message,
    });
  }
};
