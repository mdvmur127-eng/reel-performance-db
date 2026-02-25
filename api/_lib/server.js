const crypto = require("crypto");

const DEFAULT_SUPABASE_URL = "https://lhmbqwasymbkqnnqnjxr.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_b3GrtPN4T8dqorRlcAiuLQ_gnyyzhe9";

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

const SUPABASE_URL = envValue("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL") || DEFAULT_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  envValue(
    "SUPABASE_ANON_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ) || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
const SUPABASE_SERVICE_ROLE_KEY = envValue(
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE",
  "SUPABASE_SERVICE_KEY",
  "SUPABASE_SECRET_KEY",
);
const SUPABASE_AUTH_API_KEY = SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY;

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, allowedMethods) {
  res.setHeader("Allow", allowedMethods.join(", "));
  json(res, 405, { error: `Method not allowed. Use: ${allowedMethods.join(", ")}` });
}

function getHeader(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || "";
  return String(value || "");
}

function getBearerToken(req) {
  const authHeader = getHeader(req, "authorization");
  if (!authHeader.toLowerCase().startsWith("bearer ")) return "";
  return authHeader.slice(7).trim();
}

function getOrigin(req) {
  const forwardedProto = getHeader(req, "x-forwarded-proto").split(",")[0].trim();
  const protocol = forwardedProto || "https";
  const host = getHeader(req, "x-forwarded-host") || getHeader(req, "host");
  return host ? `${protocol}://${host}` : "";
}

function getRequestUrl(req) {
  const origin = getOrigin(req);
  if (!origin) return new URL("http://localhost");
  return new URL(req.url || "/", origin);
}

function randomState(size = 24) {
  return crypto.randomBytes(size).toString("hex");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseSupabaseError(payload, fallbackMessage) {
  if (!payload) return fallbackMessage;
  if (typeof payload === "string") return payload;
  return payload.message || payload.error_description || payload.error || fallbackMessage;
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

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function getQueryParam(req, key) {
  const raw = req.query?.[key];
  if (Array.isArray(raw)) return raw[0] || "";
  return String(raw || "");
}

async function supabaseAuthUser(accessToken) {
  if (!SUPABASE_AUTH_API_KEY) {
    const error = new Error(
      "Missing required environment variable: SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) and SUPABASE_SERVICE_ROLE_KEY.",
    );
    error.statusCode = 500;
    throw error;
  }

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    method: "GET",
    headers: {
      apikey: SUPABASE_AUTH_API_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const payload = await parseJsonSafe(response);
  if (!response.ok) {
    const error = new Error(parseSupabaseError(payload, "Failed to verify session."));
    error.statusCode = response.status === 401 ? 401 : 500;
    throw error;
  }

  return payload;
}

async function requireUser(req) {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    const error = new Error("Missing Authorization bearer token.");
    error.statusCode = 401;
    throw error;
  }

  const user = await supabaseAuthUser(accessToken);
  if (!user?.id) {
    const error = new Error("No authenticated user found.");
    error.statusCode = 401;
    throw error;
  }

  return user;
}

async function supabaseRest(table, { method = "GET", query = {}, body, prefer } = {}) {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error(
      "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SUPABASE_SERVICE_KEY / SUPABASE_SECRET_KEY).",
    );
    error.statusCode = 500;
    throw error;
  }

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  const headers = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  if (prefer) {
    headers.Prefer = prefer;
  }

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
    throw error;
  }

  return payload;
}

function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.end();
}

function redirectToApp(res, params = {}) {
  const query = new URLSearchParams(params).toString();
  const location = query ? `/app.html?${query}` : "/app.html";
  redirect(res, location);
}

function extractMissingColumnName(message) {
  const match = String(message || "").match(/Could not find the '([^']+)' column/i);
  return match?.[1] || "";
}

module.exports = {
  clamp,
  extractMissingColumnName,
  getOrigin,
  getQueryParam,
  json,
  methodNotAllowed,
  parseSupabaseError,
  randomState,
  readJsonBody,
  redirectToApp,
  envValue,
  requireUser,
  supabaseRest,
  getRequestUrl,
};
