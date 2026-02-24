import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3GrtPN4T8dqorRlcAiuLQ_gnyyzhe9";
const REELS_TABLE = "reels";
const REELS_BUCKET = "reels";
const INSTAGRAM_CLIENT_ID = ""; // Optional default if you want to hardcode App ID.
const IG_TOKEN_STORAGE_KEY = "instagram_user_access_token";
const IG_APP_ID_STORAGE_KEY = "instagram_app_id";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const uploadForm = document.getElementById("upload-form");
const listEl = document.getElementById("list");
const rankingEl = document.getElementById("ranking");
const refreshRankingBtn = document.getElementById("refresh-ranking");
const logoutBtn = document.getElementById("logout-btn");
const userEmailEl = document.getElementById("user-email");
const instagramAppIdEl = document.getElementById("instagram-app-id");
const instagramTokenEl = document.getElementById("instagram-token");
const instagramLimitEl = document.getElementById("instagram-limit");
const instagramSyncBtn = document.getElementById("sync-instagram-btn");
const connectInstagramBtn = document.getElementById("connect-instagram-btn");
const disconnectInstagramBtn = document.getElementById("disconnect-instagram-btn");
const instagramSyncStatusEl = document.getElementById("instagram-sync-status");
const chipButtons = document.querySelectorAll(".chip");
const tabButtons = document.querySelectorAll(".tab-btn");
const viewOverview = document.getElementById("view-overview");
const viewInsights = document.getElementById("view-insights");
const insightsMetricEl = document.getElementById("insight-metric");
const insightsChartEl = document.getElementById("insights-chart");
const insightsEmptyEl = document.getElementById("insights-empty");
const recommendationTitleEl = document.getElementById("recommendation-title");
const recommendationBodyEl = document.getElementById("recommendation-body");
const recommendationPointsEl = document.getElementById("recommendation-points");
const REQUEST_TIMEOUT_MS = 12000;
const submitBtn = uploadForm?.querySelector('button[type="submit"]');
const submitBtnDefaultLabel = submitBtn?.textContent || "Save Reel";

let currentUser = null;
let cachedReels = [];
let selectedKind = "all";

function score(reel) {
  const views = Number(reel.views) || 0;
  const likes = Number(reel.likes) || 0;
  const comments = Number(reel.comments) || 0;
  const saves = Number(reel.saves) || 0;
  const denominator = Math.max(views, 1);
  const engagementRate = (likes + comments * 2 + saves * 3) / denominator;
  const boostedReach = Math.log10(views + 10);
  return Number((engagementRate * 70 + boostedReach * 30).toFixed(2));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(iso) {
  return new Date(iso).toLocaleString();
}

function metricInput(name, value) {
  return `
    <label>
      ${name}
      <input type="number" min="0" step="1" name="${name}" value="${value || 0}" />
    </label>
  `;
}

function getReelUrl(reel) {
  const candidate = String(reel.video_url || reel.storage_path || "").trim();
  return /^https?:\/\//i.test(candidate) ? candidate : "";
}

function clearLegacyOverlays() {
  document.querySelectorAll(".loading-overlay").forEach((node) => node.remove());
}

function setSubmitLoading(isLoading, label = "Uploading...") {
  if (!submitBtn) return;
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("is-loading", isLoading);
  submitBtn.textContent = isLoading ? label : submitBtnDefaultLabel;
}

function setSyncStatus(message, isError = false) {
  if (!instagramSyncStatusEl) return;
  instagramSyncStatusEl.textContent = message;
  instagramSyncStatusEl.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function saveInstagramToken(token) {
  localStorage.setItem(IG_TOKEN_STORAGE_KEY, token);
  if (instagramTokenEl) instagramTokenEl.value = token;
}

function saveInstagramAppId(appId) {
  const value = String(appId || "").trim();
  if (value) {
    localStorage.setItem(IG_APP_ID_STORAGE_KEY, value);
  } else {
    localStorage.removeItem(IG_APP_ID_STORAGE_KEY);
  }
  if (instagramAppIdEl && instagramAppIdEl.value !== value) {
    instagramAppIdEl.value = value;
  }
}

function getInstagramAppId() {
  return String(instagramAppIdEl?.value || localStorage.getItem(IG_APP_ID_STORAGE_KEY) || INSTAGRAM_CLIENT_ID || "").trim();
}

function getInstagramToken() {
  return String(instagramTokenEl?.value || localStorage.getItem(IG_TOKEN_STORAGE_KEY) || "").trim();
}

function clearInstagramToken() {
  localStorage.removeItem(IG_TOKEN_STORAGE_KEY);
  if (instagramTokenEl) instagramTokenEl.value = "";
}

function refreshInstagramConnectState() {
  if (!connectInstagramBtn) return;
  const hasAppId = Boolean(getInstagramAppId());
  connectInstagramBtn.disabled = false;
  connectInstagramBtn.textContent = hasAppId ? "Connect Instagram" : "Connect Instagram (App ID Needed)";
}

function inferKindFromUrl(url) {
  const value = String(url || "").toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)(\?.*)?$/.test(value)) return "static";
  if (/\.(mp4|mov|webm|m4v|ogg)(\?.*)?$/.test(value)) return "video";
  if (value.includes("instagram.com/p/")) return "static";
  if (
    value.includes("instagram.com/reel/") ||
    value.includes("youtube.com") ||
    value.includes("youtu.be") ||
    value.includes("tiktok.com")
  ) {
    return "video";
  }
  return "video";
}

function getReelKind(reel) {
  const dbKind = String(reel.reel_type || reel.media_type || "").toLowerCase();
  if (dbKind.includes("image") || dbKind === "static") return "static";
  if (dbKind.includes("video") || dbKind === "video" || dbKind === "reel") return "video";
  return inferKindFromUrl(reel.video_url || reel.storage_path);
}

function filterByKind(reels) {
  if (selectedKind === "all") return reels;
  return reels.filter((reel) => getReelKind(reel) === selectedKind);
}

async function withTimeout(promise, timeoutMs = REQUEST_TIMEOUT_MS, message = "Request timed out. Please try again.") {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function getUser() {
  const { data, error } = await withTimeout(supabase.auth.getUser(), REQUEST_TIMEOUT_MS, "Session check timed out.");
  if (error) throw error;
  return data.user;
}

async function getAllReelsForUser(userId) {
  const query = supabase.from(REELS_TABLE).select("*").eq("user_id", userId).order("created_at", { ascending: false });
  const { data, error } = await withTimeout(query, REQUEST_TIMEOUT_MS, "Loading reels timed out.");
  if (error) throw error;
  return data || [];
}

async function fetchInstagramMedia(token, limit = 12) {
  const url = new URL("https://graph.instagram.com/me/media");
  url.searchParams.set("fields", "id,caption,media_type,permalink,timestamp");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("access_token", token);

  const response = await withTimeout(fetch(url.toString()), REQUEST_TIMEOUT_MS, "Instagram request timed out.");
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload?.error?.message || "Failed to fetch Instagram media.");
  }
  return Array.isArray(payload.data) ? payload.data : [];
}

async function render() {
  if (!currentUser) return;

  let reels = [];
  try {
    reels = await getAllReelsForUser(currentUser.id);
  } catch (error) {
    console.error(error);
    listEl.innerHTML = '<div class="meta">Failed to load your reels.</div>';
    rankingEl.innerHTML = '<div class="meta">Ranking unavailable.</div>';
    return;
  }
  cachedReels = reels;
  const visibleReels = filterByKind(reels);

  if (!visibleReels.length) {
    listEl.innerHTML = '<div class="meta">No reels yet. Add your first one above.</div>';
    rankingEl.innerHTML = '<div class="meta">Add reels with metrics to see ranking.</div>';
    renderInsights([]);
    return;
  }

  const withScores = visibleReels.map((reel) => ({ ...reel, rankScore: score(reel) }));
  const ranked = [...withScores].sort((a, b) => b.rankScore - a.rankScore).slice(0, 5);

  rankingEl.innerHTML = ranked
    .map(
      (reel, idx) => `
      <article class="card rank-card">
        <div class="head-row">
          <strong>#${idx + 1} ${escapeHtml(reel.title)}</strong>
          <span>Score: ${reel.rankScore}</span>
        </div>
        <div class="meta">${escapeHtml(reel.platform)} • ${reel.views || 0} views</div>
      </article>
    `,
    )
    .join("");

  const cards = withScores.map(
    (reel) => {
      const reelUrl = getReelUrl(reel);
      return `
      <article class="card" data-id="${reel.id}" data-path="${escapeHtml(reel.storage_path || "")}">
        <div class="head-row">
          <strong>${escapeHtml(reel.title)}</strong>
          <span class="meta">${escapeHtml(reel.platform)} • ${getReelKind(reel)}</span>
        </div>
        <div class="meta">Added: ${formatDate(reel.created_at)} • Score: ${reel.rankScore}</div>
        ${
          reelUrl
            ? `<a class="reel-url-link" href="${escapeHtml(reelUrl)}" target="_blank" rel="noopener noreferrer">Open Reel URL</a>`
            : '<div class="meta">No public reel URL saved.</div>'
        }
        <form class="metrics">
          ${metricInput("views", reel.views)}
          ${metricInput("likes", reel.likes)}
          ${metricInput("comments", reel.comments)}
          ${metricInput("saves", reel.saves)}
        </form>
        <div class="actions">
          <button type="button" data-action="save">Save Metrics</button>
          <button type="button" data-action="delete" class="danger">Delete</button>
        </div>
      </article>
    `;
    },
  );

  listEl.innerHTML = cards.join("");
  renderRecommendation(withScores);
  renderInsights(withScores);
}

function activateTab(tabName) {
  tabButtons.forEach((button) => button.classList.toggle("active", button.dataset.tab === tabName));
  viewOverview.classList.toggle("active", tabName === "overview");
  viewInsights.classList.toggle("active", tabName === "insights");
}

function renderInsights(reels) {
  if (!insightsChartEl || !insightsMetricEl || !insightsEmptyEl) return;
  const ctx = insightsChartEl.getContext("2d");
  if (!ctx) return;

  const metric = insightsMetricEl.value || "views";
  const items = [...reels].slice(0, 8);
  const values = items.map((reel) => (metric === "score" ? reel.rankScore : Number(reel[metric]) || 0));
  const max = Math.max(...values, 0);

  ctx.clearRect(0, 0, insightsChartEl.width, insightsChartEl.height);

  if (!items.length || max <= 0) {
    insightsEmptyEl.textContent = items.length ? "Selected metric is zero for all reels." : "Add reels to see insights.";
    return;
  }

  insightsEmptyEl.textContent = "";
  const chartPadding = { top: 24, right: 20, bottom: 90, left: 60 };
  const plotWidth = insightsChartEl.width - chartPadding.left - chartPadding.right;
  const plotHeight = insightsChartEl.height - chartPadding.top - chartPadding.bottom;
  const barGap = 18;
  const barWidth = Math.max(24, (plotWidth - barGap * (items.length - 1)) / items.length);

  ctx.strokeStyle = "rgba(30, 42, 56, 0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(chartPadding.left, chartPadding.top);
  ctx.lineTo(chartPadding.left, chartPadding.top + plotHeight);
  ctx.lineTo(chartPadding.left + plotWidth, chartPadding.top + plotHeight);
  ctx.stroke();

  ctx.fillStyle = "#1e2a38";
  ctx.font = "12px Poppins";
  for (let i = 0; i <= 4; i += 1) {
    const y = chartPadding.top + (plotHeight * i) / 4;
    const value = Math.round(max - (max * i) / 4);
    ctx.fillText(value.toString(), 12, y + 4);
    ctx.strokeStyle = "rgba(30, 42, 56, 0.12)";
    ctx.beginPath();
    ctx.moveTo(chartPadding.left, y);
    ctx.lineTo(chartPadding.left + plotWidth, y);
    ctx.stroke();
  }

  items.forEach((reel, index) => {
    const value = values[index];
    const barHeight = (value / max) * plotHeight;
    const x = chartPadding.left + index * (barWidth + barGap);
    const y = chartPadding.top + plotHeight - barHeight;

    ctx.fillStyle = "#f5a622";
    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = "#1e2a38";
    ctx.font = "11px Poppins";
    const label = reel.title.length > 12 ? `${reel.title.slice(0, 12)}...` : reel.title;
    ctx.save();
    ctx.translate(x + barWidth / 2, chartPadding.top + plotHeight + 12);
    ctx.rotate(-Math.PI / 5);
    ctx.fillText(label, -34, 0);
    ctx.restore();

    ctx.fillText(String(value), x, y - 8);
  });
}

function renderRecommendation(reels) {
  if (!recommendationTitleEl || !recommendationBodyEl || !recommendationPointsEl) return;
  if (!reels.length) {
    recommendationTitleEl.textContent = "Add reels to get a recommendation.";
    recommendationBodyEl.textContent = "";
    recommendationPointsEl.innerHTML = "";
    return;
  }

  const best = [...reels].sort((a, b) => b.rankScore - a.rankScore)[0];
  const views = Number(best.views) || 0;
  const likes = Number(best.likes) || 0;
  const comments = Number(best.comments) || 0;
  const saves = Number(best.saves) || 0;
  const engagementTotal = likes + comments + saves;
  const engagementRate = views > 0 ? (engagementTotal / views) * 100 : 0;

  const strongestMetric =
    saves >= comments && saves >= likes ? "saves" : comments >= likes ? "comments" : "likes";

  recommendationTitleEl.textContent = `Replicate the style of "${best.title}"`;
  recommendationBodyEl.textContent = `Best performer is on ${best.platform} (score ${best.rankScore}). Create a similar reel format and hook, then test 2-3 variants on the same platform.`;

  const points = [
    `Platform to prioritize: ${best.platform}`,
    `Target baseline: ${views} views and ~${engagementRate.toFixed(1)}% engagement`,
    `Most responsive signal: ${strongestMetric} (likes ${likes}, comments ${comments}, saves ${saves})`,
  ];

  recommendationPointsEl.innerHTML = points.map((point) => `<span class="recommendation-chip">${escapeHtml(point)}</span>`).join("");
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearLegacyOverlays();

  if (!currentUser) {
    window.location.href = "/index.html";
    return;
  }

  const fd = new FormData(uploadForm);
  const title = String(fd.get("title") || "").trim();
  const platform = String(fd.get("platform") || "Instagram");
  const videoUrl = String(fd.get("video_url") || "").trim();

  if (!title || !videoUrl) return;
  if (!/^https?:\/\/.+/i.test(videoUrl)) {
    alert("Please enter a valid public video URL starting with http:// or https://");
    return;
  }

  const userId = (await withTimeout(supabase.auth.getUser(), REQUEST_TIMEOUT_MS, "Session check timed out.")).data.user?.id;
  if (!userId) {
    window.location.href = "/index.html";
    return;
  }

  let saved = false;

  setSubmitLoading(true, "Saving...");
  try {
    const baseRow = {
      user_id: userId,
      title,
      platform,
      storage_path: videoUrl,
      reel_type: inferKindFromUrl(videoUrl),
      views: 0,
      likes: 0,
      comments: 0,
      saves: 0,
    };

    let { error: insertError } = await withTimeout(
      supabase.from(REELS_TABLE).insert({ ...baseRow, video_url: videoUrl }),
      REQUEST_TIMEOUT_MS,
      "Saving reel record timed out.",
    );

    if (insertError && String(insertError.message || "").toLowerCase().includes("video_url")) {
      const fallback = await withTimeout(
        supabase.from(REELS_TABLE).insert(baseRow),
        REQUEST_TIMEOUT_MS,
        "Saving reel record timed out.",
      );
      insertError = fallback.error;
    }

    if (insertError) throw insertError;

    saved = true;
    uploadForm.reset();
  } catch (error) {
    setSubmitLoading(false);
    console.error("Create reel failed:", error);
    alert(`Failed to save reel: ${String(error?.message || "unknown error")}`);
  } finally {
    setSubmitLoading(false);
    clearLegacyOverlays();
  }

  if (saved) {
    // Re-render after spinner is already hidden to prevent perceived infinite loading.
    await render();
  }
});

refreshRankingBtn.addEventListener("click", async () => {
  await render();
});

function handleInstagramOAuthReturn() {
  const queryParams = new URLSearchParams(window.location.search);
  if (queryParams.get("error")) {
    const message = queryParams.get("error_description") || "Instagram authorization was cancelled.";
    setSyncStatus(`Instagram connect failed: ${message}`, true);
    history.replaceState({}, "", window.location.pathname);
    return;
  }

  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
  if (!hash.includes("access_token=")) return;
  const params = new URLSearchParams(hash);
  const token = params.get("access_token");
  if (token) {
    saveInstagramToken(token);
    setSyncStatus("Instagram connected. You can now sync posts.");
  }
  history.replaceState({}, "", `${window.location.pathname}${window.location.search}`);
}

connectInstagramBtn?.addEventListener("click", () => {
  const appId = getInstagramAppId();
  if (!appId) {
    setSyncStatus("OAuth is not configured yet. Paste Instagram App ID above, or use token mode and click Sync Posts.");
    instagramAppIdEl?.focus();
    return;
  }

  saveInstagramAppId(appId);
  const redirectUri = `${window.location.origin}/app.html`;
  const authUrl = new URL("https://api.instagram.com/oauth/authorize");
  authUrl.searchParams.set("client_id", appId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "token");
  authUrl.searchParams.set("scope", "user_profile,user_media");
  window.location.href = authUrl.toString();
});

disconnectInstagramBtn?.addEventListener("click", () => {
  clearInstagramToken();
  setSyncStatus("Instagram token removed.");
});

instagramSyncBtn?.addEventListener("click", async () => {
  if (!currentUser) {
    window.location.href = "/index.html";
    return;
  }

  const token = getInstagramToken();
  const limit = Math.max(1, Math.min(50, Number(instagramLimitEl?.value || 12)));
  if (!token) {
    setSyncStatus("Paste your Instagram access token first.", true);
    instagramTokenEl?.focus();
    return;
  }

  instagramSyncBtn.disabled = true;
  setSyncStatus("Syncing Instagram posts...");
  try {
    const media = await fetchInstagramMedia(token, limit);
    if (!media.length) {
      setSyncStatus("No posts found for this token.");
      return;
    }

    const existing = await getAllReelsForUser(currentUser.id);
    const existingUrls = new Set(
      existing.map((reel) => String(reel.video_url || reel.storage_path || "").trim()).filter(Boolean),
    );

    const rows = media
      .map((item) => {
        const permalink = String(item.permalink || "").trim();
        if (!permalink || existingUrls.has(permalink)) return null;
        const title = String(item.caption || "").split("\n")[0].trim() || `Instagram post ${item.id}`;
        return {
          user_id: currentUser.id,
          title: title.slice(0, 120),
          platform: "Instagram",
          storage_path: permalink,
          video_url: permalink,
          reel_type: String(item.media_type || "").toLowerCase().includes("image") ? "static" : "video",
          views: 0,
          likes: 0,
          comments: 0,
          saves: 0,
        };
      })
      .filter(Boolean);

    if (!rows.length) {
      setSyncStatus("Everything is already synced.");
      return;
    }

    let { error } = await supabase.from(REELS_TABLE).insert(rows);
    if (error && String(error.message || "").toLowerCase().includes("video_url")) {
      const fallbackRows = rows.map(({ video_url, ...rest }) => rest);
      const fallback = await supabase.from(REELS_TABLE).insert(fallbackRows);
      error = fallback.error;
    }
    if (error) throw error;

    setSyncStatus(`Imported ${rows.length} new Instagram post(s).`);
    await render();
  } catch (error) {
    console.error(error);
    setSyncStatus(`Sync failed: ${error.message || "unknown error"}`, true);
  } finally {
    instagramSyncBtn.disabled = false;
  }
});

instagramAppIdEl?.addEventListener("input", () => {
  const value = String(instagramAppIdEl.value || "").trim();
  saveInstagramAppId(value);
  refreshInstagramConnectState();
});

instagramTokenEl?.addEventListener("input", () => {
  const token = String(instagramTokenEl.value || "").trim();
  if (!token) {
    localStorage.removeItem(IG_TOKEN_STORAGE_KEY);
    return;
  }
  localStorage.setItem(IG_TOKEN_STORAGE_KEY, token);
});

chipButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    selectedKind = button.dataset.kind || "all";
    chipButtons.forEach((item) => item.classList.toggle("active", item === button));
    await render();
  });
});

tabButtons.forEach((button) => {
  button.addEventListener("click", () => activateTab(button.dataset.tab || "overview"));
});

insightsMetricEl?.addEventListener("change", () => {
  const withScores = cachedReels.map((reel) => ({ ...reel, rankScore: score(reel) }));
  renderRecommendation(withScores);
  renderInsights(withScores);
});

listEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !currentUser) return;
  const action = target.dataset.action;
  if (!action) return;

  const card = target.closest(".card[data-id]");
  if (!card) return;

  const id = (card.dataset.id || "").trim();
  const storagePath = card.dataset.path || "";
  if (!id) return;

  if (action === "save") {
    const formEl = card.querySelector(".metrics");
    if (!(formEl instanceof HTMLFormElement)) return;
    const fd = new FormData(formEl);

    const payload = {
      views: Number(fd.get("views") || 0),
      likes: Number(fd.get("likes") || 0),
      comments: Number(fd.get("comments") || 0),
      saves: Number(fd.get("saves") || 0),
    };

    try {
      const { error } = await withTimeout(
        supabase.from(REELS_TABLE).update(payload).eq("id", id).eq("user_id", currentUser.id),
        REQUEST_TIMEOUT_MS,
        "Saving metrics timed out.",
      );
      if (error) throw error;
      await render();
    } catch (error) {
      console.error(error);
      alert(`Failed to update metrics: ${error.message || "unknown error"}`);
    }
  }

  if (action === "delete") {
    try {
      // Remove storage object only for legacy records that used bucket paths.
      if (storagePath && !/^https?:\/\//i.test(storagePath)) {
        await withTimeout(
          supabase.storage.from(REELS_BUCKET).remove([storagePath]),
          REQUEST_TIMEOUT_MS,
          "Deleting video timed out.",
        );
      }
      const { error } = await withTimeout(
        supabase.from(REELS_TABLE).delete().eq("id", id).eq("user_id", currentUser.id),
        REQUEST_TIMEOUT_MS,
        "Deleting reel timed out.",
      );
      if (error) throw error;
      await render();
    } catch (error) {
      console.error(error);
      alert(`Failed to delete reel: ${error.message || "unknown error"}`);
    }
  }
});

logoutBtn.addEventListener("click", async () => {
  await withTimeout(supabase.auth.signOut(), REQUEST_TIMEOUT_MS, "Logout timed out.");
  window.location.href = "/index.html";
});

async function init() {
  clearLegacyOverlays();
  handleInstagramOAuthReturn();
  const storedAppId = localStorage.getItem(IG_APP_ID_STORAGE_KEY) || INSTAGRAM_CLIENT_ID;
  if (storedAppId) {
    saveInstagramAppId(storedAppId);
  }
  const storedToken = localStorage.getItem(IG_TOKEN_STORAGE_KEY);
  if (storedToken && instagramTokenEl && !instagramTokenEl.value) {
    instagramTokenEl.value = storedToken;
  }
  refreshInstagramConnectState();
  if (storedToken) {
    setSyncStatus("Instagram token ready. Click Sync Posts to import.");
  } else if (storedAppId) {
    setSyncStatus("Instagram App ID saved. Click Connect Instagram to authorize.");
  } else {
    setSyncStatus("Use token mode or add Instagram App ID for one-click OAuth connect.");
  }
  const user = await getUser().catch(() => null);
  if (!user) {
    window.location.href = "/index.html";
    return;
  }
  currentUser = user;
  userEmailEl.textContent = user.email || "";
  await render();
}

init();
