const SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3GrtPN4T8dqorRlcAiuLQ_gnyyzhe9";
const REELS_TABLE = "reels";
const REELS_BUCKET = "reels";

const form = document.getElementById("upload-form");
const listEl = document.getElementById("list");
const rankingEl = document.getElementById("ranking");
const refreshRankingBtn = document.getElementById("refresh-ranking");

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function apiHeaders(contentType = "application/json") {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": contentType,
  };
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const message = body?.message || body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body;
}

async function getAllReels() {
  const url = `${SUPABASE_URL}/rest/v1/${REELS_TABLE}?select=*&order=created_at.desc`;
  return fetchJson(url, { headers: apiHeaders() });
}

async function uploadVideo(path, file) {
  const url = `${SUPABASE_URL}/storage/v1/object/${REELS_BUCKET}/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "x-upsert": "false",
      "Content-Type": file.type || "video/mp4",
    },
    body: file,
  });
  const text = await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = text ? JSON.parse(text) : null;
      message = body?.message || body?.error || message;
    } catch {
      message = text || message;
    }
    throw new Error(`Storage upload failed: ${message}`);
  }
}

async function createSignedUrl(path) {
  const url = `${SUPABASE_URL}/storage/v1/object/sign/${REELS_BUCKET}/${encodeURIComponent(path)}`;
  const body = await fetchJson(url, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ expiresIn: 3600 }),
  });
  if (!body?.signedURL) return "";
  return `${SUPABASE_URL}/storage/v1${body.signedURL}`;
}

async function insertReel(row) {
  const url = `${SUPABASE_URL}/rest/v1/${REELS_TABLE}`;
  await fetchJson(url, {
    method: "POST",
    headers: { ...apiHeaders(), Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
}

async function updateReel(id, payload) {
  const url = `${SUPABASE_URL}/rest/v1/${REELS_TABLE}?id=eq.${encodeURIComponent(id)}`;
  await fetchJson(url, {
    method: "PATCH",
    headers: { ...apiHeaders(), Prefer: "return=minimal" },
    body: JSON.stringify(payload),
  });
}

async function deleteReelRow(id) {
  const url = `${SUPABASE_URL}/rest/v1/${REELS_TABLE}?id=eq.${encodeURIComponent(id)}`;
  await fetchJson(url, {
    method: "DELETE",
    headers: { ...apiHeaders(), Prefer: "return=minimal" },
  });
}

async function deleteStoragePath(path) {
  const url = `${SUPABASE_URL}/storage/v1/object/${REELS_BUCKET}/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
  });
  if (!res.ok) {
    console.warn("Storage delete failed", await res.text());
  }
}

async function render() {
  let reels = [];
  try {
    reels = await getAllReels();
  } catch (error) {
    console.error(error);
    listEl.innerHTML = '<div class="meta">Failed to load Supabase data. Check SQL setup and browser network access.</div>';
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

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const fd = new FormData(form);
  const title = String(fd.get("title") || "").trim();
  const platform = String(fd.get("platform") || "Instagram");
  const video = fd.get("video");

  if (!title || !(video instanceof File) || video.size === 0) return;

  const safeName = video.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${Date.now()}_${safeName}`;

  try {
    await uploadVideo(path, video);
    await insertReel({
      title,
      platform,
      storage_path: path,
      views: 0,
      likes: 0,
      comments: 0,
      saves: 0,
    });
    form.reset();
    await render();
  } catch (error) {
    console.error("Create reel failed:", error);
    alert(`Failed to save reel: ${error.message || "unknown error"}`);
  }
});

refreshRankingBtn.addEventListener("click", () => render());

listEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const action = target.dataset.action;
  if (!action) return;

  const card = target.closest(".card[data-id]");
  if (!card) return;

  const id = (card.dataset.id || "").trim();
  const storagePath = card.dataset.path || "";
  if (!id) {
    alert("Failed to read reel id from card.");
    return;
  }

  if (action === "save") {
    const formEl = card.querySelector(".metrics");
    if (!(formEl instanceof HTMLFormElement)) return;
    const fd = new FormData(formEl);

    try {
      await updateReel(id, {
        views: Number(fd.get("views") || 0),
        likes: Number(fd.get("likes") || 0),
        comments: Number(fd.get("comments") || 0),
        saves: Number(fd.get("saves") || 0),
      });
      await render();
    } catch (error) {
      console.error(error);
      alert(`Failed to update metrics: ${error.message || "unknown error"}`);
    }
  }

  if (action === "delete") {
    try {
      if (storagePath) await deleteStoragePath(storagePath);
      await deleteReelRow(id);
      await render();
    } catch (error) {
      console.error(error);
      alert(`Failed to delete reel: ${error.message || "unknown error"}`);
    }
  }
});

render();
