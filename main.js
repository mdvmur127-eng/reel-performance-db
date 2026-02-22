import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3GrtPN4T8dqorRlcAiuLQ_gnyyzhe9";
const REELS_TABLE = "reels";
const REELS_BUCKET = "reels";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const uploadForm = document.getElementById("upload-form");
const listEl = document.getElementById("list");
const rankingEl = document.getElementById("ranking");
const refreshRankingBtn = document.getElementById("refresh-ranking");
const logoutBtn = document.getElementById("logout-btn");
const userEmailEl = document.getElementById("user-email");
let loaderEl = null;
let loaderFailsafeTimer = null;
const REQUEST_TIMEOUT_MS = 12000;
const LOADER_MAX_MS = 15000;

let currentUser = null;

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

function ensureLoader() {
  if (loaderEl) return loaderEl;
  loaderEl = document.createElement("div");
  loaderEl.className = "loading-overlay hidden";
  loaderEl.innerHTML = `
    <div class="loading-box">
      <div class="spinner" aria-hidden="true"></div>
      <div id="loading-text" class="loading-text">Processing...</div>
    </div>
  `;
  document.body.appendChild(loaderEl);
  return loaderEl;
}

function setLoading(isLoading, text = "Processing...") {
  const overlay = ensureLoader();
  const textEl = overlay.querySelector("#loading-text");
  if (textEl) textEl.textContent = text;
  overlay.classList.toggle("hidden", !isLoading);

  if (loaderFailsafeTimer) {
    clearTimeout(loaderFailsafeTimer);
    loaderFailsafeTimer = null;
  }

  if (isLoading) {
    loaderFailsafeTimer = setTimeout(() => {
      overlay.classList.add("hidden");
      console.warn("Loader auto-hidden by failsafe timeout.");
    }, LOADER_MAX_MS);
  }
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

async function createSignedUrl(path) {
  const { data, error } = await withTimeout(
    supabase.storage.from(REELS_BUCKET).createSignedUrl(path, 3600),
    REQUEST_TIMEOUT_MS,
    "Loading video preview timed out.",
  );
  if (error) return "";
  return data?.signedUrl || "";
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

  if (!reels.length) {
    listEl.innerHTML = '<div class="meta">No reels yet. Add your first one above.</div>';
    rankingEl.innerHTML = '<div class="meta">Add reels with metrics to see ranking.</div>';
    return;
  }

  const withScores = reels.map((reel) => ({ ...reel, rankScore: score(reel) }));
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

  const cards = await Promise.all(
    withScores.map(async (reel) => {
      const videoUrl = reel.storage_path ? await createSignedUrl(reel.storage_path).catch(() => "") : "";
      return `
      <article class="card" data-id="${reel.id}" data-path="${escapeHtml(reel.storage_path || "")}">
        <div class="head-row">
          <strong>${escapeHtml(reel.title)}</strong>
          <span class="meta">${escapeHtml(reel.platform)}</span>
        </div>
        <div class="meta">Added: ${formatDate(reel.created_at)} • Score: ${reel.rankScore}</div>
        ${videoUrl ? `<video controls src="${videoUrl}"></video>` : '<div class="meta">Video preview unavailable.</div>'}
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
    }),
  );

  listEl.innerHTML = cards.join("");
}

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    window.location.href = "/index.html";
    return;
  }

  const fd = new FormData(uploadForm);
  const title = String(fd.get("title") || "").trim();
  const platform = String(fd.get("platform") || "Instagram");
  const video = fd.get("video");

  if (!title || !(video instanceof File) || video.size === 0) return;

  const safeName = video.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const userId = (await withTimeout(supabase.auth.getUser(), REQUEST_TIMEOUT_MS, "Session check timed out.")).data.user?.id;
  if (!userId) {
    window.location.href = "/index.html";
    return;
  }

  const storagePath = `${userId}/${Date.now()}_${safeName}`;

  setLoading(true, "Uploading reel...");
  try {
    const { error: uploadError } = await withTimeout(
      supabase.storage.from(REELS_BUCKET).upload(storagePath, video, {
        cacheControl: "3600",
        upsert: false,
        contentType: video.type || "video/mp4",
      }),
      REQUEST_TIMEOUT_MS,
      "Video upload timed out.",
    );
    if (uploadError) throw uploadError;

    const { error: insertError } = await withTimeout(
      supabase.from(REELS_TABLE).insert({
        user_id: userId,
        title,
        platform,
        storage_path: storagePath,
        views: 0,
        likes: 0,
        comments: 0,
        saves: 0,
      }),
      REQUEST_TIMEOUT_MS,
      "Saving reel record timed out.",
    );
    if (insertError) throw insertError;

    uploadForm.reset();
    await render();
  } catch (error) {
    console.error("Create reel failed:", error);
    alert(`Failed to save reel: ${error.message || "unknown error"}`);
  } finally {
    setLoading(false);
  }
});

refreshRankingBtn.addEventListener("click", async () => {
  setLoading(true, "Refreshing ranking...");
  try {
    await render();
  } finally {
    setLoading(false);
  }
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
      setLoading(true, "Saving metrics...");
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
    } finally {
      setLoading(false);
    }
  }

  if (action === "delete") {
    try {
      setLoading(true, "Deleting reel...");
      if (storagePath) {
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
    } finally {
      setLoading(false);
    }
  }
});

logoutBtn.addEventListener("click", async () => {
  setLoading(true, "Logging out...");
  try {
    await withTimeout(supabase.auth.signOut(), REQUEST_TIMEOUT_MS, "Logout timed out.");
    window.location.href = "/index.html";
  } finally {
    setLoading(false);
  }
});

async function init() {
  setLoading(true, "Loading your reels...");
  try {
    const user = await getUser().catch(() => null);
    if (!user) {
      window.location.href = "/index.html";
      return;
    }
    currentUser = user;
    userEmailEl.textContent = user.email || "";
    await render();
  } finally {
    setLoading(false);
  }
}

init();
