"use strict";

const GRAPH_VERSION = "v22.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
const REQUEST_TIMEOUT_MS = 20000;
const INSIGHT_METRICS = ["plays", "reach", "saved", "likes", "comments", "shares"];

class InstagramReconnectError extends Error {
  constructor(message = "Reconnect Instagram") {
    super(message);
    this.name = "InstagramReconnectError";
    this.statusCode = 401;
    this.code = "INSTAGRAM_RECONNECT_REQUIRED";
  }
}

function isTokenError(payload, fallbackMessage = "") {
  const code = Number(payload?.error?.code);
  const subcode = Number(payload?.error?.error_subcode);
  const type = String(payload?.error?.type || "").toLowerCase();
  const message = String(payload?.error?.message || fallbackMessage || "").toLowerCase();
  return (
    code === 190 ||
    subcode === 463 ||
    message.includes("access token") ||
    message.includes("oauth") ||
    message.includes("session has expired") ||
    type.includes("oauth")
  );
}

async function withTimeout(promise, timeoutMs, timeoutMessage) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchJson(url, timeoutMs, timeoutMessage) {
  const response = await withTimeout(fetch(url), timeoutMs, timeoutMessage);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    if (isTokenError(payload)) {
      throw new InstagramReconnectError();
    }
    const message =
      payload?.error?.message ||
      payload?.message ||
      payload?.error_description ||
      `Instagram request failed (${response.status}).`;
    const error = new Error(message);
    error.statusCode = response.status || 500;
    throw error;
  }
  return payload;
}

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function firstInsightValue(entry) {
  if (!entry) return 0;
  if (Array.isArray(entry.values) && entry.values.length) {
    return toNumber(entry.values[0]?.value);
  }
  return toNumber(entry.value);
}

function isReelMedia(item) {
  const mediaType = String(item?.media_type || "").toUpperCase();
  return mediaType === "REELS";
}

async function fetchAllReels({ igUserId, accessToken }) {
  let afterCursor = "";
  const reels = [];
  while (true) {
    const url = new URL(`${GRAPH_BASE}/${igUserId}/media`);
    url.searchParams.set(
      "fields",
      "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp",
    );
    url.searchParams.set("limit", "50");
    url.searchParams.set("access_token", accessToken);
    if (afterCursor) {
      url.searchParams.set("after", afterCursor);
    }

    const payload = await fetchJson(url.toString(), REQUEST_TIMEOUT_MS, "Instagram media request timed out.");
    const items = Array.isArray(payload?.data) ? payload.data : [];
    items.forEach((item) => {
      if (isReelMedia(item)) reels.push(item);
    });

    const nextAfter = String(payload?.paging?.cursors?.after || "").trim();
    if (!nextAfter || nextAfter === afterCursor) {
      break;
    }
    afterCursor = nextAfter;
  }

  return reels;
}

async function fetchReelInsights({ mediaId, accessToken }) {
  const metrics = INSIGHT_METRICS.join(",");
  const url = new URL(`${GRAPH_BASE}/${mediaId}/insights`);
  url.searchParams.set("metric", metrics);
  url.searchParams.set("access_token", accessToken);

  const payload = await fetchJson(url.toString(), REQUEST_TIMEOUT_MS, "Instagram insights request timed out.");
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const byName = new Map(data.map((entry) => [String(entry?.name || "").toLowerCase(), firstInsightValue(entry)]));

  return {
    plays: toNumber(byName.get("plays")),
    reach: toNumber(byName.get("reach")),
    saved: toNumber(byName.get("saved")),
    likes: toNumber(byName.get("likes")),
    comments: toNumber(byName.get("comments")),
    shares: toNumber(byName.get("shares")),
  };
}

function normalizeIso(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const timestamp = new Date(raw).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!Array.isArray(items) || !items.length) return [];
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(items.length);
  let index = 0;

  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => run());
  await Promise.all(workers);
  return results;
}

module.exports = {
  InstagramReconnectError,
  fetchAllReels,
  fetchReelInsights,
  mapWithConcurrency,
  normalizeIso,
  sleep,
};
