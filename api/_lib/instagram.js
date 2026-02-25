const REQUEST_TIMEOUT_MS = 15000;
const GRAPH_VERSION = process.env.FACEBOOK_GRAPH_VERSION || "v22.0";

function withTimeout(promise, timeoutMs, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

async function fetchJson(url, init = {}, timeoutMs = REQUEST_TIMEOUT_MS, timeoutMessage = "Request timed out.") {
  const response = await withTimeout(fetch(url, init), timeoutMs, timeoutMessage);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload?.error) {
    const message =
      payload?.error?.message || payload?.message || payload?.error_description || `Request failed (${response.status}).`;
    if (/cannot parse access token|invalid oauth access token/i.test(message)) {
      throw new Error(
        "Invalid Instagram token. Paste only the raw access token value (no Bearer, no quotes, no URL). If still failing, generate a new token.",
      );
    }
    throw new Error(message);
  }

  return payload;
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

function parseInsightValue(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object") {
    if (typeof value.value === "number") return value.value;
    if (typeof value.value === "string") {
      const parsed = Number(value.value);
      if (Number.isFinite(parsed)) return parsed;
    }
    const firstNumeric = Object.values(value).find((entry) => Number.isFinite(Number(entry)));
    return firstNumeric === undefined ? 0 : Number(firstNumeric);
  }
  return 0;
}

function getInsightEntryValue(entry) {
  if (!entry) return 0;
  if (Array.isArray(entry.values) && entry.values.length) {
    return parseInsightValue(entry.values[0]?.value);
  }
  return parseInsightValue(entry.value);
}

function isRecoverableMetricError(message) {
  const value = String(message || "").toLowerCase();
  return (
    value.includes("does not support") ||
    value.includes("not available") ||
    value.includes("invalid metric") ||
    value.includes("cannot be queried") ||
    value.includes("permission") ||
    value.includes("not authorized")
  );
}

async function resolveInstagramBusinessAccount(userAccessToken) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
  url.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  url.searchParams.set("limit", "50");
  url.searchParams.set("access_token", userAccessToken);

  const payload = await fetchJson(url.toString(), {}, REQUEST_TIMEOUT_MS, "Failed to load Facebook pages.");
  const pages = Array.isArray(payload?.data) ? payload.data : [];
  const page = pages.find((entry) => entry?.instagram_business_account?.id);

  if (!page?.instagram_business_account?.id) {
    throw new Error(
      "No Instagram Professional account found. Use a Business/Creator IG account linked to a Facebook Page and grant pages_show_list + instagram_basic.",
    );
  }

  return {
    igUserId: page.instagram_business_account.id,
    igUsername: page.instagram_business_account.username || "",
    pageId: page.id,
    pageName: page.name || "",
    pageAccessToken: page.access_token || userAccessToken,
  };
}

async function fetchInstagramMedia(userAccessToken, limit = 12) {
  const account = await resolveInstagramBusinessAccount(userAccessToken);

  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${account.igUserId}/media`);
  url.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count",
  );
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", account.pageAccessToken);

  const payload = await fetchJson(url.toString(), {}, REQUEST_TIMEOUT_MS, "Instagram media request timed out.");
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const withTimestamp = await Promise.all(
    items.map(async (item) => {
      if (item?.timestamp) return item;
      const mediaId = String(item?.id || "").trim();
      if (!mediaId) return item;
      try {
        const detailsUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}`);
        detailsUrl.searchParams.set("fields", "timestamp");
        detailsUrl.searchParams.set("access_token", account.pageAccessToken);
        const details = await fetchJson(detailsUrl.toString(), {}, 8000, "Instagram media details request timed out.");
        return { ...item, timestamp: details?.timestamp || null };
      } catch {
        return item;
      }
    }),
  );

  return withTimestamp.map((item) => ({
    ...item,
    _access_token: account.pageAccessToken,
    _ig_user_id: account.igUserId,
    _ig_username: account.igUsername,
  }));
}

async function fetchInstagramInsightMetric(token, mediaId, metric) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${mediaId}/insights`);
  url.searchParams.set("metric", metric);
  url.searchParams.set("access_token", token);

  try {
    const payload = await fetchJson(url.toString(), {}, 9000, "Instagram insights request timed out.");
    const data = Array.isArray(payload?.data) ? payload.data : [];
    const hit = data.find((entry) => String(entry.name || "").toLowerCase() === metric.toLowerCase()) || data[0];
    return toOptionalMetricNumber(getInsightEntryValue(hit));
  } catch (error) {
    if (isRecoverableMetricError(error?.message)) return null;
    return null;
  }
}

async function fetchFirstInstagramInsightValue(token, mediaId, metricNames) {
  for (const metric of metricNames) {
    const value = await fetchInstagramInsightMetric(token, mediaId, metric);
    if (value !== null && value > 0) return value;
  }
  return null;
}

async function getInstagramMetrics(userAccessToken, item) {
  const token = item?._access_token || userAccessToken;
  const mediaType = String(item?.media_type || "").toUpperCase();
  const isImageOnly = mediaType === "IMAGE";

  let views = 0;
  let likes = toMetricNumber(item?.like_count);
  let comments = toMetricNumber(item?.comments_count);
  let saves = 0;

  const accountsReached = await fetchFirstInstagramInsightValue(token, item.id, [
    "reach",
    "accounts_reached",
    "impressions",
  ]);

  const likesFromInsights = await fetchFirstInstagramInsightValue(token, item.id, ["likes"]);
  const commentsFromInsights = await fetchFirstInstagramInsightValue(token, item.id, ["comments"]);
  const savesFromInsights = await fetchFirstInstagramInsightValue(token, item.id, ["saved", "saves"]);
  const viewsFromInsights = await fetchFirstInstagramInsightValue(token, item.id, [
    "views",
    "plays",
    "video_views",
    "impressions",
    "reach",
  ]);

  if (likesFromInsights !== null) likes = Math.max(likes, toMetricNumber(likesFromInsights));
  if (commentsFromInsights !== null) comments = Math.max(comments, toMetricNumber(commentsFromInsights));
  if (savesFromInsights !== null) saves = toMetricNumber(savesFromInsights);
  if (viewsFromInsights !== null) views = toMetricNumber(viewsFromInsights);

  let thisReelSkipRate = null;
  let averageWatchTime = null;

  if (!isImageOnly) {
    const skipRateMetric = await fetchFirstInstagramInsightValue(token, item.id, [
      "this_reel_skip_rate",
      "ig_reels_skip_rate",
      "skip_rate",
      "reel_skip_rate",
    ]);

    const averageWatchMetric = await fetchFirstInstagramInsightValue(token, item.id, [
      "average_watch_time",
      "ig_reels_avg_watch_time",
      "avg_watch_time",
    ]);

    thisReelSkipRate = skipRateMetric === null ? null : normalizePercentValue(toOptionalMetricNumber(skipRateMetric));
    averageWatchTime = normalizeAverageWatchSeconds(averageWatchMetric);

    if (averageWatchTime === null) {
      const totalWatchTime = await fetchFirstInstagramInsightValue(token, item.id, [
        "watch_time",
        "video_view_time",
        "ig_reels_video_view_total_time",
      ]);
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
  const mediaType = String(item?.media_type || "").toUpperCase();
  const permalink = String(item?.permalink || "").toLowerCase();
  if (mediaType === "IMAGE") return "static";
  if (mediaType === "CAROUSEL_ALBUM") {
    return permalink.includes("/reel/") ? "video" : "static";
  }
  return "video";
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
