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
const insightsPanelEl = document.getElementById("reel-insights-panel");
const insightsContentEl = document.getElementById("reel-insights-content");

let currentUser = null;
let editId = null;
let cachedRows = [];
let activeAudienceTab = "gender";
let countryRowCount = 5;
let selectedInsightId = null;

const AGE_GROUPS = ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+"];
const MIN_COUNTRY_ROWS = 1;
const MAX_COUNTRY_ROWS = 15;
const TOTAL_PERCENT = 100;
const PERCENT_TOLERANCE = 0.01;

const BASIC_FIELDS = [
  { key: "published_at", label: "Date", type: "datetime-local", required: true },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "url", label: "URL", type: "url", required: true, full: true },
  { key: "watch_time", label: "Watch Time (mm:ss)", type: "text", placeholder: "08:40" },
  { key: "duration", label: "Duration (mm:ss)", type: "text", placeholder: "00:51" },
  {
    key: "top_source_of_views",
    label: "Top source of views",
    type: "select",
    options: [
      { value: "", label: "Select source" },
      { value: "Reels Tab", label: "Reels Tab" },
      { value: "Explore", label: "Explore" },
      { value: "Feed", label: "Feed" },
      { value: "Profile", label: "Profile" },
    ],
  },
];

const PERFORMANCE_FIELDS = [
  { key: "views", label: "Views", type: "number" },
  { key: "likes", label: "Likes", type: "number" },
  { key: "comments", label: "Comments", type: "number" },
  { key: "saves", label: "Saves", type: "number" },
  { key: "shares", label: "Shares", type: "number" },
  { key: "follows", label: "Follows", type: "number" },
  { key: "views_followers", label: "Views (Followers %)", type: "number", placeholder: "e.g. 0.5 or 50" },
  { key: "views_non_followers", label: "Views (Non-followers %)", type: "number", readonly: true },
  { key: "accounts_reached", label: "Accounts Reached", type: "number" },
  { key: "reel_skip_rate", label: "This reel's skip rate", type: "number" },
  { key: "typical_skip_rate", label: "Typical skip rate", type: "number" },
  { key: "average_watch_time", label: "Average watch time", type: "number" },
];

const AUDIENCE_FIELDS = [
  { key: "audience_men", label: "Audience (Men ratio)", type: "number", placeholder: "e.g. 0.55", step: "0.01" },
  { key: "audience_women", label: "Audience (Women ratio)", type: "number", placeholder: "Auto", readonly: true, step: "0.01" },
];

const SECOND_FIELDS = Array.from({ length: 91 }, (_, index) => ({
  key: `sec_${index}`,
  label: `Retention at ${index}s (%)`,
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizePercent(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const text = String(rawValue).replace("%", "").replace(",", ".").trim();
  if (!text) return null;
  if (text.endsWith(".") || text === "-" || text === "+") return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  return clamp(numeric, 0, 100);
}

function roundPercent(value) {
  return Math.round(value * 100) / 100;
}

function formatPercent(value) {
  return `${roundPercent(value)}%`;
}

function normalizeSexRatio(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const text = String(rawValue).replace("%", "").replace(",", ".").trim();
  if (!text) return null;
  if (text.endsWith(".") || text === "-" || text === "+") return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return clamp(ratio, 0, 1);
}

function formatRatio(value) {
  const ratio = normalizeSexRatio(value);
  if (ratio === null) return "";
  return String(Math.round(ratio * 10000) / 10000);
}

function recomputeFollowerSplit() {
  const followersInput = formEl?.elements?.namedItem("views_followers");
  const nonFollowersInput = formEl?.elements?.namedItem("views_non_followers");
  if (!(followersInput instanceof HTMLInputElement) || !(nonFollowersInput instanceof HTMLInputElement)) return;

  const followersPercent = normalizePercent(followersInput.value);
  if (followersPercent === null) {
    nonFollowersInput.value = "";
    return;
  }

  const nonFollowersPercent = roundPercent(100 - followersPercent);
  nonFollowersInput.value = String(nonFollowersPercent);
}

function updateGenderPreview(menPercent, womenPercent) {
  const menFill = audienceFieldsEl?.querySelector('[data-gender-fill="men"]');
  const womenFill = audienceFieldsEl?.querySelector('[data-gender-fill="women"]');
  const menValue = audienceFieldsEl?.querySelector('[data-gender-value="men"]');
  const womenValue = audienceFieldsEl?.querySelector('[data-gender-value="women"]');

  if (menFill instanceof HTMLElement) menFill.style.width = `${clamp(menPercent, 0, 100)}%`;
  if (womenFill instanceof HTMLElement) womenFill.style.width = `${clamp(womenPercent, 0, 100)}%`;
  if (menValue instanceof HTMLElement) menValue.textContent = `${roundPercent(clamp(menPercent, 0, 100))}%`;
  if (womenValue instanceof HTMLElement) womenValue.textContent = `${roundPercent(clamp(womenPercent, 0, 100))}%`;
}

function recomputeGenderSplit() {
  const menInput = formEl?.elements?.namedItem("audience_men");
  const womenInput = formEl?.elements?.namedItem("audience_women");
  if (!(menInput instanceof HTMLInputElement) || !(womenInput instanceof HTMLInputElement)) return;

  const menRatio = normalizeSexRatio(menInput.value);
  if (menRatio === null) {
    womenInput.value = "";
    updateGenderPreview(0, 0);
    return;
  }

  const womenRatio = Math.max(0, 1 - menRatio);
  const menPercent = roundPercent(menRatio * 100);
  const womenPercent = roundPercent(womenRatio * 100);
  menInput.value = formatRatio(menRatio);
  womenInput.value = formatRatio(womenRatio);
  updateGenderPreview(menPercent, womenPercent);
}

function parseTimeToSeconds(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) return null;

  if (value.includes(":")) {
    const parts = value.split(":").map((part) => Number(part));
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) return null;
    const [minutes, seconds] = parts;
    if (minutes < 0 || seconds < 0 || seconds > 59) return null;
    return Math.round(minutes * 60 + seconds);
  }

  const digitsOnly = value.replace(/\D/g, "");
  if (!digitsOnly) return null;
  if (digitsOnly.length >= 3) {
    const seconds = Number(digitsOnly.slice(-2));
    const minutes = Number(digitsOnly.slice(0, -2));
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds > 59) return null;
    return Math.round(minutes * 60 + seconds);
  }

  const numeric = Number(digitsOnly);
  return Number.isFinite(numeric) ? Math.round(numeric) : null;
}

function formatSeconds(value) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const total = Math.max(0, Math.round(numeric));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function inputMarkup(field, value = "") {
  const raw = value === null || value === undefined ? "" : value;
  const safeValue =
    field.type === "datetime-local"
      ? toDatetimeLocalValue(raw)
      : field.key === "audience_men" || field.key === "audience_women"
        ? formatRatio(raw)
      : field.key === "watch_time" || field.key === "duration"
        ? formatSeconds(raw)
        : String(raw);

  if (field.type === "textarea") {
    return `
      <label class="field ${field.full ? "full" : ""}">
        <span>${escapeHtml(field.label)}</span>
        <textarea name="${escapeHtml(field.key)}" ${field.required ? "required" : ""}>${escapeHtml(safeValue)}</textarea>
      </label>
    `;
  }

  if (field.type === "select") {
    const current = String(safeValue || "");
    const options = (field.options || [])
      .map((option) => {
        const selected = option.value === current ? "selected" : "";
        return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
      })
      .join("");
    return `
      <label class="field ${field.full ? "full" : ""}">
        <span>${escapeHtml(field.label)}</span>
        <select name="${escapeHtml(field.key)}" ${field.required ? "required" : ""}>
          ${options}
        </select>
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
        placeholder="${escapeHtml(field.placeholder || "")}"
        ${field.required ? "required" : ""}
        ${field.readonly ? "readonly" : ""}
        ${field.type === "number" ? `step="${escapeHtml(field.step || "any")}"` : ""}
      />
    </label>
  `;
}

function renderFormFields(sourceRow = null) {
  const valueFor = (key) => (sourceRow ? sourceRow[key] : "");

  basicFieldsEl.innerHTML = BASIC_FIELDS.map((field) => inputMarkup(field, valueFor(field.key))).join("");
  performanceFieldsEl.innerHTML = PERFORMANCE_FIELDS.map((field) => inputMarkup(field, valueFor(field.key))).join("");
  renderAudienceFields(sourceRow);
  secondsFieldsEl.innerHTML = SECOND_FIELDS.map((field) => inputMarkup(field, valueFor(field.key))).join("");
}

function parseBreakdown(rawValue) {
  if (!rawValue) return [];
  const text = String(rawValue).trim();
  if (!text) return [];

  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => ({
          label: String(item?.label || "").trim(),
          value: toNumberOrNull(item?.value),
        }))
        .filter((item) => item.label && item.value !== null);
    }
  } catch (_) {
    // Ignore invalid JSON and continue with line parsing fallback.
  }

  return text
    .split(/\r?\n/)
    .map((line) => {
      const [labelPart, valuePart] = line.split(":");
      return {
        label: String(labelPart || "").trim(),
        value: toNumberOrNull(String(valuePart || "").replace("%", "").trim()),
      };
    })
    .filter((item) => item.label && item.value !== null);
}

function countryRowsMarkup(rows) {
  const totalRows = clamp(Math.max(countryRowCount, rows.length || 0), MIN_COUNTRY_ROWS, MAX_COUNTRY_ROWS);
  const filledRows = Array.from({ length: totalRows }, (_, idx) => rows[idx] || { label: "", value: "" });
  const bars = rows
    .map((row) => {
      const pct = clamp(Number(row.value) || 0, 0, 100);
      return `
        <div class="audience-bar-row">
          <div class="audience-bar-label">${escapeHtml(row.label)}</div>
          <div class="audience-bar-track">
            <span class="audience-bar-fill" style="width:${escapeHtml(String(pct))}%"></span>
          </div>
          <div class="audience-bar-value">${escapeHtml(String(roundPercent(pct)))}%</div>
        </div>
      `;
    })
    .join("");

  const inputs = filledRows
    .map(
      (row, idx) => `
        <div class="audience-input-row">
          <input type="text" name="audience_country_label_${idx}" placeholder="Country name" value="${escapeHtml(row.label || "")}" />
          <input type="number" name="audience_country_percent_${idx}" placeholder="%" step="any" min="0" max="100" value="${escapeHtml(row.value ?? "")}" />
        </div>
      `,
    )
    .join("");

  return `
    <section class="audience-block ${activeAudienceTab === "audience_country" ? "is-active" : ""}" data-audience-panel="audience_country">
      <div class="audience-block-head">
        <span class="chip">Country Breakdown</span>
        <div class="row-controls">
          <span class="total-hint" data-total-hint="audience_country">Total: 0%</span>
          <button type="button" class="tiny-btn secondary" data-country-action="add">+ Add country</button>
          <button type="button" class="tiny-btn secondary" data-country-action="remove">- Remove</button>
        </div>
      </div>
      <div class="audience-input-grid">${inputs}</div>
      ${bars ? `<div class="audience-bars">${bars}</div>` : ""}
    </section>
  `;
}

function ageRowsMarkup(rows) {
  const existing = new Map(
    rows
      .map((row) => [row.label, row.value])
      .filter((pair) => pair[0] && pair[1] !== null),
  );
  const normalizedRows = AGE_GROUPS.map((label) => ({ label, value: existing.get(label) ?? "" }));
  const bars = normalizedRows
    .filter((row) => row.value !== "" && row.value !== null)
    .map((row) => {
      const pct = clamp(Number(row.value) || 0, 0, 100);
      return `
        <div class="audience-bar-row">
          <div class="audience-bar-label">${escapeHtml(row.label)}</div>
          <div class="audience-bar-track">
            <span class="audience-bar-fill" style="width:${escapeHtml(String(pct))}%"></span>
          </div>
          <div class="audience-bar-value">${escapeHtml(String(roundPercent(pct)))}%</div>
        </div>
      `;
    })
    .join("");

  const inputs = normalizedRows
    .map(
      (row, idx) => `
        <div class="audience-input-row">
          <input type="text" name="audience_age_label_${idx}" value="${escapeHtml(row.label)}" readonly />
          <input type="number" name="audience_age_percent_${idx}" placeholder="%" step="any" min="0" max="100" value="${escapeHtml(row.value ?? "")}" />
        </div>
      `,
    )
    .join("");

  return `
    <section class="audience-block ${activeAudienceTab === "audience_age" ? "is-active" : ""}" data-audience-panel="audience_age">
      <div class="audience-block-head">
        <span class="chip">Age Breakdown</span>
        <span class="total-hint" data-total-hint="audience_age">Total: 0%</span>
      </div>
      <div class="audience-input-grid">${inputs}</div>
      ${bars ? `<div class="audience-bars">${bars}</div>` : ""}
    </section>
  `;
}

function genderBlockMarkup(menValue, womenValue) {
  const menRatio = normalizeSexRatio(menValue);
  const men = menRatio === null ? 0 : menRatio * 100;
  const women = roundPercent(100 - men);
  return `
    <section class="audience-block ${activeAudienceTab === "gender" ? "is-active" : ""}" data-audience-panel="gender">
      <div class="audience-block-head">
        <span class="chip">Gender Breakdown</span>
      </div>
      <div class="field-grid">
        ${AUDIENCE_FIELDS.map((field) => inputMarkup(field, field.key === "audience_men" ? menValue : womenValue)).join("")}
      </div>
      <div class="audience-bars">
        <div class="audience-bar-row">
          <div class="audience-bar-label">Men</div>
          <div class="audience-bar-track"><span class="audience-bar-fill" data-gender-fill="men" style="width:${escapeHtml(String(men))}%"></span></div>
          <div class="audience-bar-value" data-gender-value="men">${escapeHtml(String(roundPercent(men)))}%</div>
        </div>
        <div class="audience-bar-row">
          <div class="audience-bar-label">Women</div>
          <div class="audience-bar-track"><span class="audience-bar-fill" data-gender-fill="women" style="width:${escapeHtml(String(women))}%"></span></div>
          <div class="audience-bar-value" data-gender-value="women">${escapeHtml(String(roundPercent(women)))}%</div>
        </div>
      </div>
    </section>
  `;
}

function renderAudienceFields(sourceRow = null) {
  const valueFor = (key) => (sourceRow ? sourceRow[key] : "");
  const countryRows = parseBreakdown(valueFor("audience_country"));
  const ageRows = parseBreakdown(valueFor("audience_age"));
  countryRowCount = clamp(Math.max(countryRowCount, countryRows.length, MIN_COUNTRY_ROWS), MIN_COUNTRY_ROWS, MAX_COUNTRY_ROWS);

  audienceFieldsEl.innerHTML = `
    <div class="audience-chip-row">
      <button class="chip ${activeAudienceTab === "gender" ? "chip-active" : ""}" type="button" data-audience-tab="gender">Gender</button>
      <button class="chip ${activeAudienceTab === "audience_country" ? "chip-active" : ""}" type="button" data-audience-tab="audience_country">Country</button>
      <button class="chip ${activeAudienceTab === "audience_age" ? "chip-active" : ""}" type="button" data-audience-tab="audience_age">Age</button>
    </div>
    ${genderBlockMarkup(valueFor("audience_men"), valueFor("audience_women"))}
    ${countryRowsMarkup(countryRows)}
    ${ageRowsMarkup(ageRows)}
  `;
  syncAudienceTotalHints();
}

function parseBreakdownFromForm(formData, prefix) {
  const rows = [];
  const totalRows = prefix === "audience_age" ? AGE_GROUPS.length : countryRowCount;
  for (let index = 0; index < totalRows; index += 1) {
    const label = String(formData.get(`${prefix}_label_${index}`) || "").trim();
    const value = toNumberOrNull(formData.get(`${prefix}_percent_${index}`));
    if (!label || value === null) continue;
    rows.push({ label, value: clamp(value, 0, 100) });
  }
  return rows;
}

function hasBreakdownDraftInput(formData, prefix) {
  const totalRows = prefix === "audience_age" ? AGE_GROUPS.length : countryRowCount;
  for (let index = 0; index < totalRows; index += 1) {
    const label = String(formData.get(`${prefix}_label_${index}`) || "").trim();
    const percent = String(formData.get(`${prefix}_percent_${index}`) || "").trim();
    if (label || percent) return true;
  }
  return false;
}

function breakdownTotal(rows) {
  return rows.reduce((sum, row) => sum + (toNumberOrNull(row.value) ?? 0), 0);
}

function isTotalHundred(total) {
  return Math.abs(total - TOTAL_PERCENT) <= PERCENT_TOLERANCE;
}

function getBreakdownValidation(formData) {
  const countryRows = parseBreakdownFromForm(formData, "audience_country");
  const ageRows = parseBreakdownFromForm(formData, "audience_age");
  const countryTotal = breakdownTotal(countryRows);
  const ageTotal = breakdownTotal(ageRows);
  const countryHasAny = hasBreakdownDraftInput(formData, "audience_country");
  const ageHasAny = hasBreakdownDraftInput(formData, "audience_age");

  return {
    country: {
      total: countryTotal,
      hasAny: countryHasAny,
      valid: !countryHasAny || isTotalHundred(countryTotal),
    },
    age: {
      total: ageTotal,
      hasAny: ageHasAny,
      valid: !ageHasAny || isTotalHundred(ageTotal),
    },
  };
}

function updateTotalHint(key, total, hasAny, valid) {
  const hintEl = audienceFieldsEl?.querySelector(`[data-total-hint="${key}"]`);
  if (!(hintEl instanceof HTMLElement)) return;

  hintEl.classList.remove("is-valid", "is-invalid");
  if (!hasAny) {
    hintEl.textContent = "Total: 0%";
    return;
  }

  hintEl.textContent = valid ? `Total: ${formatPercent(total)}` : `Total: ${formatPercent(total)} (must be 100%)`;
  hintEl.classList.add(valid ? "is-valid" : "is-invalid");
}

function syncAudienceTotalHints() {
  if (!formEl) return;
  const fd = new FormData(formEl);
  const totals = getBreakdownValidation(fd);
  updateTotalHint("audience_country", totals.country.total, totals.country.hasAny, totals.country.valid);
  updateTotalHint("audience_age", totals.age.total, totals.age.hasAny, totals.age.valid);
}

function captureAudienceDraft() {
  if (!formEl) return null;
  const fd = new FormData(formEl);
  const countryRows = parseBreakdownFromForm(fd, "audience_country");
  const ageRows = parseBreakdownFromForm(fd, "audience_age");
  const menRatio = normalizeSexRatio(fd.get("audience_men"));
  return {
    audience_men: menRatio === null ? null : menRatio,
    audience_women: menRatio === null ? null : Math.max(0, 1 - menRatio),
    audience_country: countryRows.length ? JSON.stringify(countryRows) : null,
    audience_age: ageRows.length ? JSON.stringify(ageRows) : null,
  };
}

function buildPayloadFromForm(formData) {
  const payload = {};

  for (const field of ALL_FIELDS) {
    const rawValue = formData.get(field.key);

    if (field.type === "number") {
      if (field.key === "views_followers") {
        payload.views_followers = normalizePercent(rawValue);
        continue;
      }
      if (field.key === "views_non_followers") {
        const followersPercent = normalizePercent(formData.get("views_followers"));
        payload.views_non_followers = followersPercent === null ? null : roundPercent(100 - followersPercent);
        continue;
      }
      if (field.key === "audience_men") {
        payload.audience_men = normalizeSexRatio(rawValue);
        continue;
      }
      if (field.key === "audience_women") {
        const menRatio = normalizeSexRatio(formData.get("audience_men"));
        payload.audience_women = menRatio === null ? null : Math.max(0, 1 - menRatio);
        continue;
      }
      payload[field.key] = toNumberOrNull(rawValue);
      continue;
    }

    if (field.type === "datetime-local") {
      const text = String(rawValue || "").trim();
      payload[field.key] = text ? new Date(text).toISOString() : null;
      continue;
    }

    if (field.key === "watch_time" || field.key === "duration") {
      const parsed = parseTimeToSeconds(rawValue);
      payload[field.key] = parsed;
      continue;
    }

    const text = String(rawValue || "").trim();
    payload[field.key] = text || null;
  }

  const countryRows = parseBreakdownFromForm(formData, "audience_country");
  const ageRows = parseBreakdownFromForm(formData, "audience_age");
  payload.audience_country = countryRows.length ? JSON.stringify(countryRows) : null;
  payload.audience_age = ageRows.length ? JSON.stringify(ageRows) : null;

  for (const metric of ["views", "likes", "comments", "saves", "shares", "follows", "accounts_reached"]) {
    if (payload[metric] === null || payload[metric] === undefined) {
      payload[metric] = 0;
    }
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

function ratioToPercentString(value) {
  if (value === null || value === undefined || value === "") return "-";
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  const ratio = numeric > 1 ? numeric / 100 : numeric;
  return `${roundPercent(clamp(ratio, 0, 1) * 100)}%`;
}

function metricNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
}

function metricDisplay(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString();
}

function percentDisplay(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `${roundPercent(numeric)}%`;
}

function timeMetricDisplay(value) {
  const numeric = toNumberOrNull(value);
  if (numeric === null) return "-";
  return formatSeconds(numeric);
}

function pointsFromRetention(row) {
  const points = [];
  for (let second = 0; second <= 90; second += 1) {
    const v = toNumberOrNull(row[`sec_${second}`]);
    if (v === null) continue;
    points.push({ x: second, y: clamp(v, 0, 100) });
  }
  return points;
}

function retentionChartMarkup(row) {
  const points = pointsFromRetention(row);
  if (!points.length) {
    return '<div class="chart-empty">No retention points yet. Fill sec_0..sec_90 to see the curve.</div>';
  }

  const width = 820;
  const height = 250;
  const pad = { left: 42, right: 18, top: 14, bottom: 44 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const maxX = 90;
  const scaleX = (x) => pad.left + (x / maxX) * innerW;
  const scaleY = (y) => pad.top + ((100 - y) / 100) * innerH;
  const poly = points.map((p) => `${scaleX(p.x)},${scaleY(p.y)}`).join(" ");
  const xAxisY = height - pad.bottom;

  const yTicks = [0, 25, 50, 75, 100]
    .map((tick) => {
      const y = scaleY(tick);
      return `
        <line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" class="grid-line"></line>
        <text x="${pad.left - 8}" y="${y + 4}" class="axis-label" text-anchor="end">${tick}%</text>
      `;
    })
    .join("");

  const xTicks = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90]
    .map((tick) => {
      const x = scaleX(tick);
      return `
        <line x1="${x}" y1="${xAxisY}" x2="${x}" y2="${xAxisY + 5}" class="tick-line"></line>
        <text x="${x}" y="${height - 20}" class="axis-label" text-anchor="middle">${tick}s</text>
      `;
    })
    .join("");
  const pointDots = points
    .map((p) => `<circle cx="${scaleX(p.x)}" cy="${scaleY(p.y)}" r="1.8" class="point-dot"></circle>`)
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="insight-chart" role="img" aria-label="Retention curve">
      <rect x="${pad.left}" y="${pad.top}" width="${innerW}" height="${innerH}" class="chart-bg"></rect>
      ${yTicks}
      <line x1="${pad.left}" y1="${xAxisY}" x2="${width - pad.right}" y2="${xAxisY}" class="axis-line"></line>
      <polyline points="${poly}" class="line-path"></polyline>
      ${pointDots}
      ${xTicks}
      <text x="${pad.left + innerW / 2}" y="${height - 6}" class="axis-title" text-anchor="middle">Seconds (s)</text>
    </svg>
  `;
}

function barsMarkup(items) {
  const max = Math.max(...items.map((item) => item.value), 1);
  return items
    .map((item) => {
      const width = roundPercent((item.value / max) * 100);
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(item.label)}</div>
          <div class="bar-track"><span class="bar-fill" style="width:${width}%"></span></div>
          <div class="bar-value">${escapeHtml(metricDisplay(item.value))}</div>
        </div>
      `;
    })
    .join("");
}

function percentageBarsMarkup(rows) {
  if (!rows.length) return '<div class="chart-empty">No data yet.</div>';
  return rows
    .map((row) => {
      const pct = clamp(metricNumber(row.value), 0, 100);
      return `
        <div class="bar-row">
          <div class="bar-label">${escapeHtml(row.label)}</div>
          <div class="bar-track"><span class="bar-fill" style="width:${pct}%"></span></div>
          <div class="bar-value">${escapeHtml(percentDisplay(pct))}</div>
        </div>
      `;
    })
    .join("");
}

function renderReelInsights(row) {
  if (!insightsContentEl) return;
  if (!row) {
    insightsContentEl.innerHTML = '<p class="meta">Click a reel title in the table to view visual insights.</p>';
    return;
  }

  const url = String(row.url || "").trim();
  const safeUrl = /^https?:\/\//i.test(url) ? url : "";
  const menPct = clamp((normalizeSexRatio(row.audience_men) || 0) * 100, 0, 100);
  const womenPct = roundPercent(100 - menPct);
  const followerPct = normalizePercent(row.views_followers) ?? 0;
  const nonFollowerPct = roundPercent(100 - followerPct);
  const views = metricNumber(row.views);
  const reached = metricNumber(row.accounts_reached);
  const engagementTotal = metricNumber(row.likes) + metricNumber(row.comments) + metricNumber(row.saves) + metricNumber(row.shares);
  const engagementRate = views > 0 ? roundPercent((engagementTotal / views) * 100) : 0;

  const engagementBars = barsMarkup([
    { label: "Views", value: metricNumber(row.views) },
    { label: "Likes", value: metricNumber(row.likes) },
    { label: "Comments", value: metricNumber(row.comments) },
    { label: "Saves", value: metricNumber(row.saves) },
    { label: "Shares", value: metricNumber(row.shares) },
    { label: "Follows", value: metricNumber(row.follows) },
  ]);

  const countryRows = parseBreakdown(row.audience_country);
  const ageRows = parseBreakdown(row.audience_age);
  const topCountry = [...countryRows].sort((a, b) => metricNumber(b.value) - metricNumber(a.value))[0] || null;
  const topAge = [...ageRows].sort((a, b) => metricNumber(b.value) - metricNumber(a.value))[0] || null;
  const audienceSummary = [
    Number.isFinite(menPct) ? `Men ${roundPercent(menPct)}% / Women ${roundPercent(womenPct)}%` : "",
    topCountry ? `Top country: ${topCountry.label} ${roundPercent(metricNumber(topCountry.value))}%` : "",
    topAge ? `Top age: ${topAge.label} ${roundPercent(metricNumber(topAge.value))}%` : "",
  ]
    .filter(Boolean)
    .join(" • ");

  insightsContentEl.innerHTML = `
    <div class="insights-head">
      <div>
        <h4>${escapeHtml(cardValue(row.title))}</h4>
        <p class="meta">Published: ${escapeHtml(toDisplayDate(row.published_at))} • Source: ${escapeHtml(cardValue(row.top_source_of_views))}</p>
      </div>
      ${safeUrl ? `<a class="table-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Open Reel</a>` : ""}
    </div>

    <div class="kpi-grid">
      <div class="kpi"><span>Views</span><strong>${escapeHtml(metricDisplay(views))}</strong></div>
      <div class="kpi"><span>Average Watch Time</span><strong>${escapeHtml(timeMetricDisplay(row.average_watch_time))}</strong></div>
      <div class="kpi"><span>Engagement Rate</span><strong>${escapeHtml(percentDisplay(engagementRate))}</strong></div>
      <div class="kpi"><span>Accounts Reached</span><strong>${escapeHtml(metricDisplay(reached))}</strong></div>
      <div class="kpi kpi-wide"><span>Audience Snapshot</span><strong>${escapeHtml(audienceSummary || "No audience data yet")}</strong></div>
    </div>

    <div class="insights-grid">
      <section class="insight-card full">
        <h5>Retention Curve</h5>
        ${retentionChartMarkup(row)}
      </section>

      <section class="insight-card">
        <h5>Engagement Mix</h5>
        <div class="bar-list">${engagementBars}</div>
      </section>

      <section class="insight-card">
        <h5>Audience Split</h5>
        <div class="bar-list">
          ${percentageBarsMarkup([
            { label: "Men", value: menPct },
            { label: "Women", value: womenPct },
            { label: "Followers", value: followerPct },
            { label: "Non-followers", value: nonFollowerPct },
          ])}
        </div>
      </section>

      <section class="insight-card">
        <h5>Top Countries</h5>
        <div class="bar-list">${percentageBarsMarkup(countryRows)}</div>
      </section>

      <section class="insight-card">
        <h5>Age Groups</h5>
        <div class="bar-list">${percentageBarsMarkup(ageRows)}</div>
      </section>
    </div>
  `;
}

function renderList(rows) {
  if (!rows.length) {
    listEl.innerHTML = '<div class="meta">No reels saved yet.</div>';
    renderReelInsights(null);
    return;
  }

  const bodyRows = rows
    .map((row) => {
      const url = String(row.url || "").trim();
      const safeUrl = /^https?:\/\//i.test(url) ? url : "";
      const isSelected = String(selectedInsightId || "") === String(row.id);
      return `
        <tr data-id="${escapeHtml(String(row.id))}" class="${isSelected ? "is-selected" : ""}">
          <td class="reel-title-cell">
            <button type="button" class="title-link-btn" data-action="insight">${escapeHtml(cardValue(row.title))}</button>
          </td>
          <td>${escapeHtml(toDisplayDate(row.published_at))}</td>
          <td>${safeUrl ? `<a class="table-link" href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">Open</a>` : "-"}</td>
          <td>${escapeHtml(cardValue(row.views))}</td>
          <td>${escapeHtml(cardValue(row.likes))}</td>
          <td>${escapeHtml(cardValue(row.comments))}</td>
          <td>${escapeHtml(cardValue(row.saves))}</td>
          <td>${escapeHtml(cardValue(row.shares))}</td>
          <td>${escapeHtml(cardValue(row.follows))}</td>
          <td>${escapeHtml(cardValue(row.accounts_reached))}</td>
          <td>${escapeHtml(ratioToPercentString(row.audience_men))}</td>
          <td>${escapeHtml(ratioToPercentString(row.audience_women))}</td>
          <td>
            <div class="row-actions">
              <button type="button" class="row-btn secondary" data-action="edit">Edit</button>
              <button type="button" class="row-btn danger" data-action="delete">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  listEl.innerHTML = `
    <div class="table-wrap">
      <table class="reels-table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Date</th>
            <th>URL</th>
            <th>Views</th>
            <th>Likes</th>
            <th>Comments</th>
            <th>Saves</th>
            <th>Shares</th>
            <th>Follows</th>
            <th>Reached</th>
            <th>Men</th>
            <th>Women</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  `;

  const selected = rows.find((row) => String(row.id) === String(selectedInsightId)) || rows[0];
  selectedInsightId = selected?.id || null;
  renderReelInsights(selected || null);
}

function resetForm() {
  editId = null;
  formTitleEl.textContent = "Add Reel";
  cancelEditBtn.classList.add("hidden");
  renderFormFields(null);
  recomputeFollowerSplit();
  recomputeGenderSplit();
  setSaving(false);
}

function startEdit(row) {
  editId = row.id;
  formTitleEl.textContent = "Edit Reel";
  cancelEditBtn.classList.remove("hidden");
  renderFormFields(row);
  recomputeFollowerSplit();
  recomputeGenderSplit();
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

function parseMissingColumn(errorMessage) {
  const message = String(errorMessage || "");
  const match = message.match(/Could not find the '([^']+)' column/i);
  return match?.[1] || "";
}

async function insertWithMissingColumnFallback(row) {
  const payload = { ...row };
  const removedColumns = [];
  const attempted = new Set();

  while (true) {
    const { error } = await withTimeout(
      supabase.from(REELS_TABLE).insert([payload]),
      REQUEST_TIMEOUT_MS,
      "Insert timed out",
    );
    if (!error) return removedColumns;

    const missingColumn = parseMissingColumn(error.message);
    if (!missingColumn || attempted.has(missingColumn)) throw error;

    attempted.add(missingColumn);
    if (Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      delete payload[missingColumn];
      removedColumns.push(missingColumn);
      continue;
    }
    throw error;
  }
}

async function updateWithMissingColumnFallback(id, userId, row) {
  const payload = { ...row };
  const removedColumns = [];
  const attempted = new Set();

  while (true) {
    const { error } = await withTimeout(
      supabase.from(REELS_TABLE).update(payload).eq("id", id).eq("user_id", userId),
      REQUEST_TIMEOUT_MS,
      "Update timed out",
    );
    if (!error) return removedColumns;

    const missingColumn = parseMissingColumn(error.message);
    if (!missingColumn || attempted.has(missingColumn)) throw error;

    attempted.add(missingColumn);
    if (Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      delete payload[missingColumn];
      removedColumns.push(missingColumn);
      continue;
    }
    throw error;
  }
}

formEl.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser) {
    window.location.href = "/index.html";
    return;
  }

  const fd = new FormData(formEl);
  const breakdownValidation = getBreakdownValidation(fd);
  if (!breakdownValidation.country.valid || !breakdownValidation.age.valid) {
    syncAudienceTotalHints();
    const errors = [];
    if (!breakdownValidation.country.valid) {
      errors.push(`Country total is ${formatPercent(breakdownValidation.country.total)}. It must equal 100%.`);
    }
    if (!breakdownValidation.age.valid) {
      errors.push(`Age total is ${formatPercent(breakdownValidation.age.total)}. It must equal 100%.`);
    }
    setStatus(errors.join(" "), true);
    return;
  }

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

    const removedColumns = editId
      ? await updateWithMissingColumnFallback(editId, currentUser.id, row)
      : await insertWithMissingColumnFallback(row);

    if (removedColumns.length) {
      setStatus(
        `Saved, but schema is missing columns: ${removedColumns.join(", ")}. Run SQL migration to persist them.`,
        true,
      );
    } else {
      setStatus(editId ? "Reel updated." : "Reel saved.");
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
  const rawTarget = event.target;
  const target =
    rawTarget instanceof Element
      ? rawTarget
      : rawTarget && "parentElement" in rawTarget
        ? rawTarget.parentElement
        : null;
  if (!target || !currentUser) return;

  const actionNode = target.closest("[data-action]");
  const action = actionNode?.getAttribute("data-action");
  const rowNode = (actionNode?.closest("[data-id]")) || target.closest("[data-id]");
  if (!rowNode) return;

  const id = String(rowNode.getAttribute("data-id") || "").trim();
  if (!id) return;

  // Click anywhere in row selects reel insights, except direct anchor clicks.
  if (!action) {
    if (target.closest("a")) return;
    selectedInsightId = id;
    renderList(cachedRows);
    return;
  }

  if (action === "insight") {
    selectedInsightId = id;
    renderList(cachedRows);
    return;
  }

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
  formEl.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const name = target.getAttribute("name") || "";
    if (name === "views_followers") {
      recomputeFollowerSplit();
    }
    if (name === "audience_men") {
      recomputeGenderSplit();
    }
    if (name.startsWith("audience_country_") || name.startsWith("audience_age_")) {
      syncAudienceTotalHints();
    }
  });
  audienceFieldsEl.addEventListener("click", (event) => {
    const rawTarget = event.target;
    const target =
      rawTarget instanceof Element
        ? rawTarget
        : rawTarget && "parentElement" in rawTarget
          ? rawTarget.parentElement
          : null;
    if (!target) return;
    const tabNode = target.closest("[data-audience-tab]");
    const actionNode = target.closest("[data-country-action]");
    const tab = tabNode?.getAttribute("data-audience-tab");
    const countryAction = actionNode?.getAttribute("data-country-action");
    const draft = captureAudienceDraft();
    if (countryAction) {
      if (countryAction === "add") {
        countryRowCount = clamp(countryRowCount + 1, MIN_COUNTRY_ROWS, MAX_COUNTRY_ROWS);
      } else if (countryAction === "remove") {
        countryRowCount = clamp(countryRowCount - 1, MIN_COUNTRY_ROWS, MAX_COUNTRY_ROWS);
      }
      renderAudienceFields(draft);
      recomputeGenderSplit();
      syncAudienceTotalHints();
      return;
    }
    if (!tab) return;
    activeAudienceTab = tab;
    renderAudienceFields(draft);
    recomputeGenderSplit();
    syncAudienceTotalHints();
  });
  recomputeFollowerSplit();
  recomputeGenderSplit();
  syncAudienceTotalHints();
  await refreshList();
}

init();
