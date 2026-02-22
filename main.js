import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3GrtPN4T8dqorRlcAiuLQ_gnyyzhe9";
const REELS_TABLE = "reels";
const REELS_BUCKET = "reels";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const authScreen = document.getElementById("auth-screen");
const appScreen = document.getElementById("app-screen");
const authMessageEl = document.getElementById("auth-message");
const signupForm = document.getElementById("signup-form");
const loginForm = document.getElementById("login-form");
const logoutBtn = document.getElementById("logout-btn");
const userEmailEl = document.getElementById("user-email");

const uploadForm = document.getElementById("upload-form");
const listEl = document.getElementById("list");
const rankingEl = document.getElementById("ranking");
const refreshRankingBtn = document.getElementById("refresh-ranking");

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

function setAuthMessage(message, isError = false) {
  authMessageEl.textContent = message || "";
  authMessageEl.classList.toggle("error", Boolean(message && isError));
}

function setLoggedOutUi() {
  currentUser = null;
  authScreen.classList.remove("hidden");
  appScreen.classList.add("hidden");
  userEmailEl.textContent = "";
}

function setLoggedInUi(user) {
  currentUser = user;
  authScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  userEmailEl.textContent = user.email || "";
}

async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data.user;
}

async function getAllReelsForUser(userId) {
  const { data, error } = await supabase
    .from(REELS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function createSignedUrl(path) {
  const { data, error } = await supabase.storage.from(REELS_BUCKET).createSignedUrl(path, 3600);
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

signupForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fd = new FormData(signupForm);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  if (!email || !password) return;

  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    setAuthMessage(`Sign up failed: ${error.message}`, true);
    return;
  }
  setAuthMessage("Sign-up success. Check your email for confirmation if required.");
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fd = new FormData(loginForm);
  const email = String(fd.get("email") || "").trim();
  const password = String(fd.get("password") || "");
  if (!email || !password) return;

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    setAuthMessage(`Login failed: ${error.message}`, true);
    return;
  }

  const user = await getUser();
  if (!user) {
    setAuthMessage("Login succeeded but no user session found.", true);
    return;
  }
  setAuthMessage("");
  setLoggedInUi(user);
  await render();
});

logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  setLoggedOutUi();
  setAuthMessage("Logged out.");
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    setLoggedOutUi();
    return;
  }

  const fd = new FormData(uploadForm);
  const title = String(fd.get("title") || "").trim();
  const platform = String(fd.get("platform") || "Instagram");
  const video = fd.get("video");

  if (!title || !(video instanceof File) || video.size === 0) return;

  const safeName = video.name.replace(/[^a-zA-Z0-9._-]/g, "_");

  // Requirement: store current authenticated user id when creating a reel.
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    alert("No authenticated user.");
    setLoggedOutUi();
    return;
  }

  const storagePath = `${userId}/${Date.now()}_${safeName}`;

  try {
    const { error: uploadError } = await supabase.storage.from(REELS_BUCKET).upload(storagePath, video, {
      cacheControl: "3600",
      upsert: false,
      contentType: video.type || "video/mp4",
    });
    if (uploadError) throw uploadError;

    const { error: insertError } = await supabase.from(REELS_TABLE).insert({
      user_id: userId,
      title,
      platform,
      storage_path: storagePath,
      views: 0,
      likes: 0,
      comments: 0,
      saves: 0,
    });
    if (insertError) throw insertError;

    uploadForm.reset();
    await render();
  } catch (error) {
    console.error("Create reel failed:", error);
    alert(`Failed to save reel: ${error.message || "unknown error"}`);
  }
});

refreshRankingBtn.addEventListener("click", () => render());

listEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !currentUser) return;
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

    const payload = {
      views: Number(fd.get("views") || 0),
      likes: Number(fd.get("likes") || 0),
      comments: Number(fd.get("comments") || 0),
      saves: Number(fd.get("saves") || 0),
    };

    try {
      const { error } = await supabase
        .from(REELS_TABLE)
        .update(payload)
        .eq("id", id)
        .eq("user_id", currentUser.id);
      if (error) throw error;
      await render();
    } catch (error) {
      console.error(error);
      alert(`Failed to update metrics: ${error.message || "unknown error"}`);
    }
  }

  if (action === "delete") {
    try {
      if (storagePath) {
        await supabase.storage.from(REELS_BUCKET).remove([storagePath]);
      }
      const { error } = await supabase
        .from(REELS_TABLE)
        .delete()
        .eq("id", id)
        .eq("user_id", currentUser.id);
      if (error) throw error;
      await render();
    } catch (error) {
      console.error(error);
      alert(`Failed to delete reel: ${error.message || "unknown error"}`);
    }
  }
});

supabase.auth.onAuthStateChange(async (_event, session) => {
  if (!session?.user) {
    setLoggedOutUi();
    return;
  }
  setLoggedInUi(session.user);
  await render();
});

async function init() {
  const user = await getUser().catch(() => null);
  if (!user) {
    setLoggedOutUi();
    return;
  }
  setLoggedInUi(user);
  await render();
}

init();
