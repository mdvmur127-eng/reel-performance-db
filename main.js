import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3GrtPN4T8dqorRlcAiuLQ_gnyyzhe9";
const REELS_TABLE = "reels";
const REQUEST_TIMEOUT_MS = 15000;

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const formEl = document.getElementById("reel-form");
const formTitleEl = document.getElementById("form-title");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const saveBtn = document.getElementById("save-btn");
const formStatusEl = document.getElementById("form-status");
const listEl = document.getElementById("reels-list");
const refreshBtn = document.getElementById("refresh-btn");
const logoutBtn = document.getElementById("logout-btn");
const userEmailEl = document.getElementById("user-email");
const basicFieldsEl = document.getElementById("fields-basic");
const performanceFieldsEl = document.getElementById("fields-performance");
const audienceFieldsEl = document.getElementById("fields-audience");
const secondsFieldsEl = document.getElementById("fields-seconds");

let currentUser = null;
let editId = null;
let cachedRows = [];

const BASIC_FIELDS = [
  { key: "published_at", label: "Date", type: "datetime-local", required: true },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "url", label: "URL", type: "url", required: true, full: true },
  { key: "watch_time", label: "Watch Time", type: "number" },
  { key: "duration", label: "Duration", type: "number" },
  { key: "top_source_of_views", label: "Top source of views", type: "text" },
];

const PERFORMANCE_FIELDS = [
  { key: "views", label: "Views", type: "number" },
  { key: "likes", label: "Likes", type: "number" },
  { key: "comments", label: "Comments", type: "number" },
  { key: "saves", label: "Saves", type: "number" },
  { key: "shares", label: "Shares", type: "number" },
  { key: "follows", label: "Follows", type: "number" },
  { key: "views_followers", label: "Views (Followers)", type: "number" },
  { key: "views_non_followers", label: "Views (Non-followers)", type: "number" },
  { key: "views_over_time_all", label: "Views over time (All)", type: "textarea", full: true },
  { key: "views_over_time_followers", label: "Views over time (Followers)", type: "textarea", full: true },
  { key: "views_over_time_non_followers", label: "Views over time (Non-followers)", type: "textarea", full: true },
  { key: "accounts_reached", label: "Accounts Reached", type: "number" },
  { key: "reel_skip_rate", label: "This reel's skip rate", type: "number" },
  { key: "typical_skip_rate", label: "Typical skip rate", type: "number" },
  { key: "average_watch_time", label: "Average watch time", type: "number" },
];

const AUDIENCE_FIELDS = [
  { key: "audience_men", label: "Audience (Men)", type: "number" },
  { key: "audience_women", label: "Audience (Women)", type: "number" },
  { key: "audience_country", label: "Audience (Country)", type: "textarea", full: true },
  { key: "audience_age", label: "Audience (Age)", type: "textarea", full: true },
];

const SECOND_FIELDS = Array.from({ length: 91 }, (_, index) => ({
  key: `sec_${index}`,
  label: `sec_${index}`,
  type: "number",
}));

const ALL_FIELDS = [...BASIC_FIELDS, ...PERFORMANCE_FIELDS, ...AUDIENCE_FIELDS, ...SECOND_FIELDS];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setStatus(message, isError = false) {
  if (!formStatusEl) return;
  formStatusEl.textContent = message;
  formStatusEl.style.color = isError ? "#b42318" : "var(--muted)";
}

function setSaving(isSaving) {
  saveBtn.disabled = isSaving;
  saveBtn.textContent = isSaving ? "Saving..." : editId ? "Update Reel" : "Save Reel";
}

async function withTimeout(promise, timeoutMs = REQUEST_TIMEOUT_MS, message = "Request timed out") {
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

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toDatetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${h}:${min}`;
}

function toDisplayDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function inputMarkup(field, value = "") {
  const raw = value === null || value === undefined ? "" : value;
  const safeValue = field.type === "datetime-local" ? toDatetimeLocalValue(raw) : String(raw);

  if (field.type === "textarea") {
    return `
      <label class="field ${field.full ? "full" : ""}">
        <span>${escapeHtml(field.label)}</span>
        <textarea name="${escapeHtml(field.key)}" ${field.required ? "required" : ""}>${escapeHtml(safeValue)}</textarea>
      </label>
    `;
  }

  return `
    <label class="field ${field.full ? "full" : ""}">
      <span>${escapeHtml(field.label)}</span>
      <input
        name="${escapeHtml(field.key)}"
        type="${escapeHtml(field.type || "text")}" 
        value="${escapeHtml(safeValue)}"
        ${field.required ? "required" : ""}
        ${field.type === "number" ? 'step="any"' : ""}
      />
    </label>
  `;
}

function renderFormFields(sourceRow = null) {
  const valueFor = (key) => (sourceRow ? sourceRow[key] : "");

  basicFieldsEl.innerHTML = BASIC_FIELDS.map((field) => inputMarkup(field, valueFor(field.key))).join("");
  performanceFieldsEl.innerHTML = PERFORMANCE_FIELDS.map((field) => inputMarkup(field, valueFor(field.key))).join("");
  audienceFieldsEl.innerHTML = AUDIENCE_FIELDS.map((field) => inputMarkup(field, valueFor(field.key))).join("");
  secondsFieldsEl.innerHTML = SECOND_FIELDS.map((field) => inputMarkup(field, valueFor(field.key))).join("");
}

function buildPayloadFromForm(formData) {
  const payload = {};

  for (const field of ALL_FIELDS) {
    const rawValue = formData.get(field.key);

    if (field.type === "number") {
      payload[field.key] = toNumberOrNull(rawValue);
      continue;
    }

    if (field.type === "datetime-local") {
      const text = String(rawValue || "").trim();
      payload[field.key] = text ? new Date(text).toISOString() : null;
      continue;
    }

    const text = String(rawValue || "").trim();
    payload[field.key] = text || null;
  }

  return payload;
}

async function fetchReels() {
  if (!currentUser) return [];
  const { data, error } = await withTimeout(
    supabase.from(REELS_TABLE).select("*").eq("user_id", currentUser.id).order("published_at", { ascending: false }).order("created_at", { ascending: false }),
    REQUEST_TIMEOUT_MS,
    "Load reels timed out",
  );
  if (error) throw error;
  return data || [];
}

function cardValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function renderList(rows) {
  if (!rows.length) {
    listEl.innerHTML = '<div class="meta">No reels saved yet.</div>';
    return;
  }

  listEl.innerHTML = rows
    .map((row) => {
      const url = String(row.url || "").trim();
      const safeUrl = /^https?:\/\//i.test(url) ? url : "";
      return `
        <article class="card" data-id="${row.id}">
          <h3>${escapeHtml(cardValue(row.title))}</h3>
          <div class="card-meta">Date: ${escapeHtml(toDisplayDate(row.published_at))}</div>
          <div class="card-meta">Views: ${escapeHtml(cardValue(row.views))} • Likes: ${escapeHtml(cardValue(row.likes))} • Comments: ${escapeHtml(cardValue(row.comments))}</div>
          <div class="card-meta">Saves: ${escapeHtml(cardValue(row.saves))} • Shares: ${escapeHtml(cardValue(row.shares))} • Follows: ${escapeHtml(cardValue(row.follows))}</div>
          <div class="card-meta">Reach: ${escapeHtml(cardValue(row.accounts_reached))} • Avg watch: ${escapeHtml(cardValue(row.average_watch_time))}</div>
          ${safeUrl ? `<a class="card-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Open URL</a>` : '<span class="card-meta">URL: -</span>'}
          <div class="card-actions">
            <button type="button" data-action="edit">Edit</button>
            <button type="button" data-action="delete" class="danger">Delete</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function resetForm() {
  editId = null;
  formTitleEl.textContent = "Add Reel";
  cancelEditBtn.classList.add("hidden");
  renderFormFields(null);
  setSaving(false);
}

function startEdit(row) {
  editId = row.id;
  formTitleEl.textContent = "Edit Reel";
  cancelEditBtn.classList.remove("hidden");
  renderFormFields(row);
  setSaving(false);
  formEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function refreshList() {
  try {
    cachedRows = await fetchReels();
    renderList(cachedRows);
  } catch (error) {
    console.error(error);
    listEl.innerHTML = '<div class="meta">Failed to load reels.</div>';
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    window.location.href = "/index.html";
    return;
  }

  const fd = new FormData(formEl);
  const payload = buildPayloadFromForm(fd);

  if (!payload.published_at || !payload.title || !payload.url) {
    setStatus("Date, Title, and URL are required.", true);
    return;
  }

  setSaving(true);
  setStatus(editId ? "Updating reel..." : "Saving reel...");

  try {
    const row = {
      user_id: currentUser.id,
      ...payload,
    };

    if (editId) {
      const { error } = await withTimeout(
        supabase.from(REELS_TABLE).update(row).eq("id", editId).eq("user_id", currentUser.id),
        REQUEST_TIMEOUT_MS,
        "Update timed out",
      );
      if (error) throw error;
      setStatus("Reel updated.");
    } else {
      const { error } = await withTimeout(
        supabase.from(REELS_TABLE).insert([row]),
        REQUEST_TIMEOUT_MS,
        "Insert timed out",
      );
      if (error) throw error;
      setStatus("Reel saved.");
    }

    resetForm();
    await refreshList();
  } catch (error) {
    console.error(error);
    setStatus(`Save failed: ${error.message || "unknown error"}`, true);
    setSaving(false);
  }
});

cancelEditBtn.addEventListener("click", () => {
  resetForm();
  setStatus("Edit cancelled.");
});

refreshBtn.addEventListener("click", async () => {
  await refreshList();
  setStatus("Reels refreshed.");
});

listEl.addEventListener("click", async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !currentUser) return;
  const action = target.dataset.action;
  if (!action) return;

  const card = target.closest(".card[data-id]");
  if (!card) return;

  const id = String(card.dataset.id || "").trim();
  if (!id) return;

  if (action === "edit") {
    const row = cachedRows.find((item) => String(item.id) === id);
    if (!row) return;
    startEdit(row);
    return;
  }

  if (action === "delete") {
    try {
      const { error } = await withTimeout(
        supabase.from(REELS_TABLE).delete().eq("id", id).eq("user_id", currentUser.id),
        REQUEST_TIMEOUT_MS,
        "Delete timed out",
      );
      if (error) throw error;

      if (String(editId || "") === id) resetForm();
      setStatus("Reel deleted.");
      await refreshList();
    } catch (error) {
      console.error(error);
      setStatus(`Delete failed: ${error.message || "unknown error"}`, true);
    }
  }
});

logoutBtn.addEventListener("click", async () => {
  await withTimeout(supabase.auth.signOut(), REQUEST_TIMEOUT_MS, "Logout timed out");
  window.location.href = "/index.html";
});

async function init() {
  renderFormFields(null);
  setStatus("Ready.");

  const { data, error } = await withTimeout(supabase.auth.getUser(), REQUEST_TIMEOUT_MS, "Session check timed out");
  if (error || !data?.user) {
    window.location.href = "/index.html";
    return;
  }

  currentUser = data.user;
  userEmailEl.textContent = currentUser.email || "";
  await refreshList();
}

init();
