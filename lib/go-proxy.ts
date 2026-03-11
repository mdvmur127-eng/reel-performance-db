import { NextResponse } from "next/server";

const GO_BACKEND_URL = process.env.GO_BACKEND_URL ?? "http://127.0.0.1:8080";

const passthroughHeaders = new Set(["content-type", "location", "cache-control", "vary"]);

export const proxyToGo = async (request: Request, path: string): Promise<Response> => {
  const source = new URL(request.url);
  const target = new URL(path, GO_BACKEND_URL.endsWith("/") ? GO_BACKEND_URL : `${GO_BACKEND_URL}/`);
  target.search = source.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const cookie = request.headers.get("cookie");

  if (contentType) headers.set("content-type", contentType);
  if (accept) headers.set("accept", accept);
  if (cookie) headers.set("cookie", cookie);

  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > 0) {
      body = Buffer.from(raw);
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to reach Go backend";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const responseHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (passthroughHeaders.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  }

  const headersWithCookies = upstream.headers as Headers & {
    getSetCookie?: () => string[];
  };

  if (typeof headersWithCookies.getSetCookie === "function") {
    for (const cookieValue of headersWithCookies.getSetCookie()) {
      responseHeaders.append("set-cookie", cookieValue);
    }
  } else {
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) {
      responseHeaders.set("set-cookie", setCookie);
    }
  }

  const payload = await upstream.arrayBuffer();
  return new Response(payload, {
    status: upstream.status,
    headers: responseHeaders
  });
};
