const REQUEST_TIMEOUT_MS = 15000;

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function fetchJson(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS, timeoutMessage = "Request timed out.") {
  const response = await withTimeout(fetch(url, init), timeoutMs, timeoutMessage);
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.error) {
    const message = payload?.error?.message || payload?.message || `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

function isFieldSelectionError(message) {
  const value = String(message || "").toLowerCase();
  return (
    value.includes("nonexisting field") ||
    value.includes("cannot be queried") ||
    (value.includes("field") && value.includes("not exist"))
  );
}

function isPermissionOrSupportError(message) {
  const value = String(message || "").toLowerCase();
  return (
    value.includes("permission") ||
    value.includes("not authorized") ||
    value.includes("unsupported") ||
    value.includes("cannot be queried") ||
    value.includes("invalid metric")
  );
}

function canonicalizeReelUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${host}${path}`;
  } catch {
    return raw.replace(/[#?].*$/, "").replace(/\/+$/, "");
  }
}

function toMetricNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function toOptionalMetricNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0 ? numeric : null;
}

function normalizePercentValue(value) {
  if (!Number.isFinite(value)) return null;
  const normalized = value > 0 && value <= 1 ? value * 100 : value;
  return Math.min(Math.max(normalized, 0), 100);
}

function normalizeAverageWatchSeconds(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const seconds = numeric > 600 ? numeric / 1000 : numeric;
  return Number(seconds.toFixed(2));
}

function getInsightValue(entry) {
  if (!entry) return 0;
  if (Array.isArray(entry.values) && entry.values.length) {
    return toMetricNumber(entry.values[0]?.value);
  }
  return toMetricNumber(entry.value);
}

async function fetchInstagramMediaByFields(token, limit, fields) {
  const url = new URL("https://graph.instagram.com/me/media");
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", token);

  const payload = await fetchJson(url.toString(), {}, REQUEST_TIMEOUT_MS, "Instagram request timed out.");
  return Array.isArray(payload?.data) ? payload.data : [];
}

async function fetchInstagramMedia(token, limit = 12) {
  const fieldSets = [
    "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,video_view_count",
    "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
    "id,caption,media_type,media_product_type,permalink,timestamp",
  ];

  let lastError = null;
  for (const fields of fieldSets) {
    try {
      return await fetchInstagramMediaByFields(token, limit, fields);
    } catch (error) {
      lastError = error;
      if (!isFieldSelectionError(error?.message)) break;
    }
  }

  throw lastError || new Error("Failed to fetch Instagram media.");
}

async function fetchInstagramInsightMetric(token, mediaId, metric) {
  const endpoints = [
    `https://graph.instagram.com/${mediaId}/insights`,
    `https://graph.facebook.com/v21.0/${mediaId}/insights`,
  ];

  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      url.searchParams.set("metric", metric);
      url.searchParams.set("access_token", token);
      const payload = await fetchJson(url.toString(), {}, 9000, "Instagram insights request timed out.");
      const insights = Array.isArray(payload?.data) ? payload.data : [];
      const hit = insights.find((entry) => String(entry.name || "").toLowerCase() === metric.toLowerCase()) || insights[0];
      return getInsightValue(hit);
    } catch (error) {
      if (!isPermissionOrSupportError(error?.message)) {
        continue;
      }
    }
  }

  return 0;
}

async function fetchFirstInstagramInsightValue(token, mediaId, metricNames) {
  for (const metric of metricNames) {
    const value = await fetchInstagramInsightMetric(token, mediaId, metric);
    if (value > 0) return value;
  }
  return null;
}

async function fetchInstagramViewsFromInsights(token, mediaId) {
  const metrics = ["views", "plays", "video_views", "impressions", "reach"];
  for (const metric of metrics) {
    const value = await fetchInstagramInsightMetric(token, mediaId, metric);
    if (value > 0) return value;
  }
  return 0;
}

async function getInstagramMetrics(token, item) {
  const mediaType = String(item.media_type || "").toUpperCase();
  const isImageOnly = mediaType === "IMAGE";

  const likes = toMetricNumber(item.like_count);
  const comments = toMetricNumber(item.comments_count);
  const saves = toMetricNumber(item.save_count || item.saves);

  let views = toMetricNumber(item.video_view_count || item.view_count || item.views || item.play_count || item.plays);
  if (views === 0 && !isImageOnly) {
    views = await fetchInstagramViewsFromInsights(token, item.id);
  }

  const accountsReached = await fetchFirstInstagramInsightValue(token, item.id, ["reach", "accounts_reached"]);

  let thisReelSkipRate = null;
  let averageWatchTime = null;
  if (!isImageOnly) {
    const skipRateMetric = await fetchFirstInstagramInsightValue(token, item.id, [
      "this_reel_skip_rate",
      "skip_rate",
      "reel_skip_rate",
      "ig_reels_skip_rate",
    ]);
    const averageWatchMetric = await fetchFirstInstagramInsightValue(token, item.id, [
      "average_watch_time",
      "ig_reels_avg_watch_time",
      "avg_watch_time",
    ]);

    thisReelSkipRate = skipRateMetric === null ? null : normalizePercentValue(toOptionalMetricNumber(skipRateMetric));
    averageWatchTime = normalizeAverageWatchSeconds(averageWatchMetric);

    if (averageWatchTime === null) {
      const totalWatchTime = await fetchFirstInstagramInsightValue(token, item.id, ["watch_time", "video_view_time"]);
      if (totalWatchTime !== null && views > 0) {
        averageWatchTime = normalizeAverageWatchSeconds(totalWatchTime / views);
      }
    }
  }

  return {
    views,
    likes,
    comments,
    saves,
    accounts_reached: toOptionalMetricNumber(accountsReached),
    average_watch_time: averageWatchTime,
    this_reel_skip_rate: thisReelSkipRate,
  };
}

function reelTypeFromMedia(item) {
  const mediaType = String(item.media_type || "").toUpperCase();
  return mediaType.includes("IMAGE") ? "static" : "video";
}

module.exports = {
  canonicalizeReelUrl,
  fetchInstagramMedia,
  getInstagramMetrics,
  normalizeAverageWatchSeconds,
  normalizePercentValue,
  reelTypeFromMedia,
  toOptionalMetricNumber,
  toMetricNumber,
};
