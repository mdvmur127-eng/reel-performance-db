"use strict";

const DEFAULT_SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";

function env(name) {
  const value = process.env[name];
  return value === undefined || value === null ? "" : String(value).trim();
}

function getRequiredEnv() {
  const values = {
    SUPABASE_URL: env("SUPABASE_URL") || DEFAULT_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env("SUPABASE_SERVICE_ROLE_KEY"),
    INSTAGRAM_CLIENT_ID: env("INSTAGRAM_CLIENT_ID"),
    INSTAGRAM_CLIENT_SECRET: env("INSTAGRAM_CLIENT_SECRET"),
  };

  const missing = Object.entries(values)
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    const error = new Error(`Missing required environment variable(s): ${missing.join(", ")}`);
    error.statusCode = 500;
    error.code = "MISSING_ENV";
    throw error;
  }

  return values;
}

function getBearerToken(req) {
  const raw = req.headers?.authorization;
  const header = Array.isArray(raw) ? raw[0] : String(raw || "");
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

async function parseJsonSafe(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function parseSupabaseError(payload, fallbackMessage) {
  if (!payload) return fallbackMessage;
  if (typeof payload === "string") return payload;
  return payload.message || payload.error_description || payload.error || fallbackMessage;
}

async function requireAuthenticatedUser(req) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    const error = new Error("Missing Authorization bearer token.");
    error.statusCode = 401;
    error.code = "MISSING_BEARER";
    throw error;
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getRequiredEnv();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await parseJsonSafe(response);

  if (!response.ok || !payload?.id) {
    const error = new Error(parseSupabaseError(payload, "Failed to verify authenticated user."));
    error.statusCode = response.status === 401 ? 401 : 500;
    error.code = "AUTH_FAILED";
    throw error;
  }

  return payload;
}

function buildRestUrl(baseUrl, table, query = {}) {
  const url = new URL(`${baseUrl}/rest/v1/${table}`);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

async function supabaseRest(table, { method = "GET", query = {}, body, prefer } = {}) {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getRequiredEnv();
  const url = buildRestUrl(SUPABASE_URL, table, query);
  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (prefer) headers.Prefer = prefer;

  const init = { method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    const error = new Error(parseSupabaseError(payload, `Supabase request failed (${response.status}).`));
    error.statusCode = response.status;
    error.code = "SUPABASE_REST_FAILED";
    throw error;
  }

  return payload;
}

async function selectRows(table, query = {}) {
  return supabaseRest(table, { method: "GET", query });
}

async function upsertRows(table, rows, onConflictColumns) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return supabaseRest(table, {
    method: "POST",
    query: { on_conflict: onConflictColumns },
    body: rows,
    prefer: "resolution=merge-duplicates,return=representation",
  });
}

module.exports = {
  getRequiredEnv,
  requireAuthenticatedUser,
  selectRows,
  upsertRows,
};
