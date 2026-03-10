import { createHmac, randomUUID, timingSafeEqual } from "crypto";

const GRAPH_VERSION = "v21.0";
const OAUTH_STATE_TTL_SECONDS = 10 * 60;
const PENDING_SELECTION_TTL_SECONDS = 15 * 60;
const GRAPH_TIMEOUT_MS = 15_000;
export const META_PENDING_SELECTION_COOKIE = "meta_ig_pending_selection";

const META_SCOPES = [
  "instagram_basic",
  "instagram_manage_insights",
  "pages_show_list",
  "pages_read_engagement"
];

type MetaConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
};

type GraphError = {
  error?: {
    message?: string;
  };
};

export type InstagramAccount = {
  igUserId: string;
  username: string | null;
};

export type InstagramAccountOption = {
  igUserId: string;
  username: string | null;
  pageId: string;
  pageName: string | null;
};

type PendingInstagramSelection = {
  accessToken: string;
  tokenExpiresAt: string | null;
  createdAt: number;
  accounts: InstagramAccountOption[];
};

export type InstagramMedia = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
};

export type ReelInsights = {
  plays: number | null;
  reach: number | null;
  saved: number | null;
  shares: number | null;
};

const getMetaConfig = (): MetaConfig => {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;

  if (!appId) throw new Error("Missing META_APP_ID");
  if (!appSecret) throw new Error("Missing META_APP_SECRET");
  if (!redirectUri) throw new Error("Missing META_REDIRECT_URI");

  return { appId, appSecret, redirectUri };
};

const parseGraphError = async (response: Response) => {
  let message = `Graph API request failed with status ${response.status}`;

  try {
    const json = (await response.json()) as GraphError;
    if (json.error?.message) {
      message = json.error.message;
    }
  } catch {
    // Ignore JSON parse failures and keep fallback message.
  }

  return message;
};

const fetchWithTimeout = async (url: string, init: RequestInit = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
};

const graphGet = async <T>(path: string, params: Record<string, string>) => {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}${path}`);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetchWithTimeout(url.toString(), {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await parseGraphError(response));
  }

  return (await response.json()) as T;
};

export const buildInstagramAuthUrl = (state: string) => {
  const { appId, redirectUri } = getMetaConfig();
  const url = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", META_SCOPES.join(","));
  return url.toString();
};

export const createInstagramOAuthState = () => {
  const { appSecret } = getMetaConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const payload = `${timestamp}.${nonce}`;
  const signature = createHmac("sha256", appSecret).update(payload).digest("hex");
  return `${payload}.${signature}`;
};

export const verifyInstagramOAuthState = (state: string) => {
  const { appSecret } = getMetaConfig();
  const parts = state.split(".");

  if (parts.length !== 3) {
    return false;
  }

  const [timestampRaw, nonce, signature] = parts;
  const timestamp = Number(timestampRaw);

  if (!Number.isFinite(timestamp) || !nonce || !signature) {
    return false;
  }

  const now = Math.floor(Date.now() / 1000);
  const age = now - timestamp;

  if (age < -60 || age > OAUTH_STATE_TTL_SECONDS) {
    return false;
  }

  const payload = `${timestampRaw}.${nonce}`;
  const expectedSignature = createHmac("sha256", appSecret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const exchangeCodeForShortLivedToken = async (code: string) => {
  const { appId, appSecret, redirectUri } = getMetaConfig();
  const data = await graphGet<{ access_token?: string }>("/oauth/access_token", {
    client_id: appId,
    client_secret: appSecret,
    redirect_uri: redirectUri,
    code
  });

  if (!data.access_token) {
    throw new Error("Meta OAuth did not return an access token");
  }

  return data.access_token;
};

export const exchangeForLongLivedToken = async (shortLivedToken: string) => {
  const { appId, appSecret } = getMetaConfig();
  const data = await graphGet<{ access_token?: string; expires_in?: number }>(
    "/oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken
    }
  );

  if (!data.access_token) {
    throw new Error("Failed to get a long-lived Meta access token");
  }

  return {
    accessToken: data.access_token,
    expiresIn: data.expires_in ?? null
  };
};

export const getInstagramAccount = async (
  accessToken: string
): Promise<InstagramAccount | null> => {
  const accounts = await listInstagramAccounts(accessToken);
  const first = accounts[0];

  if (!first) {
    return null;
  }

  return {
    igUserId: first.igUserId,
    username: first.username
  };
};

export const listInstagramAccounts = async (
  accessToken: string
): Promise<InstagramAccountOption[]> => {
  const data = await graphGet<{
    data?: Array<{
      id?: string;
      name?: string;
      instagram_business_account?: { id?: string; username?: string };
      connected_instagram_account?: { id?: string; username?: string };
    }>;
  }>("/me/accounts", {
    access_token: accessToken,
    fields:
      "id,name,instagram_business_account{id,username},connected_instagram_account{id,username}",
    limit: "50"
  });

  const pages = data.data ?? [];
  const result: InstagramAccountOption[] = [];
  const dedupe = new Set<string>();

  for (const page of pages) {
    const account = page.instagram_business_account ?? page.connected_instagram_account;
    if (account?.id && !dedupe.has(account.id)) {
      dedupe.add(account.id);
      result.push({
        igUserId: account.id,
        username: account.username ?? null,
        pageId: page.id ?? "",
        pageName: page.name ?? null
      });
    }
  }

  return result;
};

export const createPendingInstagramSelectionToken = (
  input: Omit<PendingInstagramSelection, "createdAt">
) => {
  const { appSecret } = getMetaConfig();
  const payload = Buffer.from(
    JSON.stringify({ ...input, createdAt: Math.floor(Date.now() / 1000) })
  ).toString("base64url");
  const signature = createHmac("sha256", appSecret).update(payload).digest("hex");
  return `${payload}.${signature}`;
};

export const verifyPendingInstagramSelectionToken = (
  token: string
): PendingInstagramSelection | null => {
  const { appSecret } = getMetaConfig();
  const parts = token.split(".");

  if (parts.length !== 2) {
    return null;
  }

  const [payload, signature] = parts;
  const expectedSignature = createHmac("sha256", appSecret).update(payload).digest("hex");
  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const receivedBuffer = Buffer.from(signature, "hex");

  if (expectedBuffer.length !== receivedBuffer.length) {
    return null;
  }

  if (!timingSafeEqual(expectedBuffer, receivedBuffer)) {
    return null;
  }

  let parsed: PendingInstagramSelection;

  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (!parsed.createdAt || now - parsed.createdAt > PENDING_SELECTION_TTL_SECONDS) {
    return null;
  }

  if (!Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
    return null;
  }

  if (typeof parsed.accessToken !== "string" || !parsed.accessToken) {
    return null;
  }

  return parsed;
};

export const fetchInstagramReels = async (
  accessToken: string,
  igUserId: string,
  maxItems = 25
): Promise<InstagramMedia[]> => {
  const reels: InstagramMedia[] = [];

  let nextUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${igUserId}/media`);
  nextUrl.searchParams.set("access_token", accessToken);
  nextUrl.searchParams.set(
    "fields",
    "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count"
  );
  nextUrl.searchParams.set("limit", String(Math.min(50, Math.max(10, maxItems))));

  for (let safety = 0; safety < 10 && reels.length < maxItems; safety += 1) {
    const response = await fetchWithTimeout(nextUrl.toString(), {
      method: "GET",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(await parseGraphError(response));
    }

    const json = (await response.json()) as {
      data?: InstagramMedia[];
      paging?: { next?: string };
    };

    const mediaItems = json.data ?? [];
    const filtered = mediaItems.filter(
      (item) => item.media_product_type === "REELS" || item.media_type === "VIDEO"
    );

    for (const item of filtered) {
      reels.push(item);
      if (reels.length >= maxItems) {
        break;
      }
    }

    if (!json.paging?.next) {
      break;
    }

    nextUrl = new URL(json.paging.next);
  }

  return reels;
};

export const fetchReelInsights = async (
  accessToken: string,
  mediaId: string
): Promise<ReelInsights> => {
  const fallback: ReelInsights = {
    plays: null,
    reach: null,
    saved: null,
    shares: null
  };

  try {
    const data = await graphGet<{ data?: Array<{ name?: string; values?: Array<{ value?: number }> }> }>(
      `/${mediaId}/insights`,
      {
        access_token: accessToken,
        metric: "plays,reach,saved,shares",
        period: "lifetime"
      }
    );

    for (const metric of data.data ?? []) {
      const value = metric.values?.[0]?.value;
      if (typeof value !== "number") continue;

      if (metric.name === "plays") fallback.plays = value;
      if (metric.name === "reach") fallback.reach = value;
      if (metric.name === "saved") fallback.saved = value;
      if (metric.name === "shares") fallback.shares = value;
    }

    return fallback;
  } catch {
    return fallback;
  }
};
