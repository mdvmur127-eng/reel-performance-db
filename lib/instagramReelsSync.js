"use strict";

const { selectRows, upsertRows } = require("./supabaseAdmin");
const {
  fetchAllReels,
  fetchReelInsights,
  mapWithConcurrency,
  normalizeIso,
  sleep,
} = require("./instagram");

const INSIGHT_REFRESH_MS = 60 * 60 * 1000;
const INSIGHT_CONCURRENCY = 4;
const INSIGHT_REQUEST_GAP_MS = 120;
const UPSERT_BATCH_SIZE = 100;
const DEFAULT_SYNC_LIMIT = 20;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function getCaption(value) {
  const raw = String(value || "").trim();
  return raw || null;
}

function isRecentlySynced(lastSyncedAt) {
  const lastSyncMs = Date.parse(String(lastSyncedAt || ""));
  if (!Number.isFinite(lastSyncMs)) return false;
  return Date.now() - lastSyncMs < INSIGHT_REFRESH_MS;
}

function toTitle(caption, fallbackId) {
  const firstLine = String(caption || "").split("\n")[0].trim();
  return firstLine || `Instagram Reel ${fallbackId}`;
}

async function upsertInBatches(rows) {
  let output = [];
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) {
    const chunk = rows.slice(i, i + UPSERT_BATCH_SIZE);
    const result = await upsertRows("reels", chunk, "user_id,ig_media_id");
    if (Array.isArray(result)) output = output.concat(result);
  }
  return output;
}

async function syncInstagramReelsForUserConnection({
  userId,
  accessToken,
  instagramUserId,
  limit = DEFAULT_SYNC_LIMIT,
}) {
  if (!userId || !accessToken || !instagramUserId) {
    const err = new Error("Instagram not connected");
    err.statusCode = 404;
    throw err;
  }

  const reels = await fetchAllReels({
    igUserId: instagramUserId,
    accessToken,
    maxItems: Math.max(1, Number(limit) || DEFAULT_SYNC_LIMIT),
  });

  if (!reels.length) {
    return { synced: 0, new: 0, updated: 0 };
  }

  const existingRows = await selectRows("reels", {
    select:
      "user_id,ig_media_id,last_synced_at,plays,reach,likes,comments,shares,saved,caption,media_url,thumbnail_url,permalink,posted_at",
    user_id: `eq.${userId}`,
  });
  const existingByMediaId = new Map();
  (Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
    const mediaId = String(row.ig_media_id || "").trim();
    if (!mediaId || existingByMediaId.has(mediaId)) return;
    existingByMediaId.set(mediaId, row);
  });

  const reelsNeedingInsights = reels.filter((item) => {
    const mediaId = String(item.id || "").trim();
    if (!mediaId) return false;
    const existing = existingByMediaId.get(mediaId);
    return !existing || !isRecentlySynced(existing.last_synced_at);
  });

  const insightsByMediaId = new Map();
  await mapWithConcurrency(reelsNeedingInsights, INSIGHT_CONCURRENCY, async (item) => {
    const mediaId = String(item.id || "").trim();
    if (!mediaId) return null;
    const insights = await fetchReelInsights({
      mediaId,
      accessToken,
    });
    insightsByMediaId.set(mediaId, insights);
    await sleep(INSIGHT_REQUEST_GAP_MS);
    return null;
  });

  const nowIso = new Date().toISOString();
  const rowsToUpsert = [];
  let newCount = 0;

  reels.forEach((item) => {
    const mediaId = String(item.id || "").trim();
    if (!mediaId) return;
    const existing = existingByMediaId.get(mediaId);
    const insights = insightsByMediaId.get(mediaId) || {
      plays: toNumber(existing?.plays),
      reach: toNumber(existing?.reach),
      likes: toNumber(existing?.likes),
      comments: toNumber(existing?.comments),
      shares: toNumber(existing?.shares),
      saved: toNumber(existing?.saved),
    };

    if (!existing) newCount += 1;

    const caption = getCaption(item.caption) || getCaption(existing?.caption);
    const permalink =
      String(item.permalink || existing?.permalink || "").trim() || `https://www.instagram.com/reel/${mediaId}/`;
    const postedAt = normalizeIso(item.timestamp) || normalizeIso(existing?.posted_at);

    rowsToUpsert.push({
      user_id: userId,
      ig_media_id: mediaId,
      caption,
      media_url: String(item.media_url || existing?.media_url || "").trim() || null,
      thumbnail_url: String(item.thumbnail_url || existing?.thumbnail_url || "").trim() || null,
      permalink,
      posted_at: postedAt,
      plays: insights.plays,
      reach: insights.reach,
      likes: insights.likes,
      comments: insights.comments,
      shares: insights.shares,
      saved: insights.saved,
      last_synced_at: nowIso,
      // Keep legacy columns in sync so existing UI continues to work.
      title: toTitle(caption, mediaId),
      platform: "Instagram",
      storage_path: permalink,
      video_url: permalink,
      reel_type: "video",
      views: insights.plays,
      saves: insights.saved,
      published_at: postedAt,
      instagram_media_id: mediaId,
    });
  });

  if (!rowsToUpsert.length) {
    return { synced: 0, new: 0, updated: 0 };
  }

  await upsertInBatches(rowsToUpsert);

  return {
    synced: rowsToUpsert.length,
    new: newCount,
    updated: rowsToUpsert.length - newCount,
  };
}

module.exports = {
  DEFAULT_SYNC_LIMIT,
  syncInstagramReelsForUserConnection,
};

