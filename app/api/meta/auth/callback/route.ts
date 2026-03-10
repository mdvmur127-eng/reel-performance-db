import { NextRequest, NextResponse } from "next/server";
import {
  META_PENDING_SELECTION_COOKIE,
  createPendingInstagramSelectionToken,
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  listInstagramAccounts,
  verifyInstagramOAuthState
} from "@/lib/meta";
import { supabaseAdmin } from "@/lib/supabase";

const buildRedirect = (requestUrl: string, status: string, message?: string) => {
  const destination = new URL("/", requestUrl);
  destination.searchParams.set("ig", status);

  if (message) {
    destination.searchParams.set("ig_message", message.slice(0, 180));
  }

  return NextResponse.redirect(destination);
};

const clearPendingCookie = (response: NextResponse) => {
  response.cookies.set(META_PENDING_SELECTION_COOKIE, "", {
    maxAge: 0,
    path: "/"
  });
};

const saveConnection = async (
  igUserId: string,
  igUsername: string | null,
  accessToken: string,
  tokenExpiresAt: string | null
) => {
  const { error } = await supabaseAdmin.from("meta_instagram_connections").upsert(
    {
      id: 1,
      ig_user_id: igUserId,
      ig_username: igUsername,
      access_token: accessToken,
      token_expires_at: tokenExpiresAt
    },
    { onConflict: "id" }
  );

  if (error) {
    throw error;
  }
};

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorDescription = url.searchParams.get("error_description");

  if (errorDescription) {
    const response = buildRedirect(request.url, "error", errorDescription);
    clearPendingCookie(response);
    return response;
  }

  if (!code || !state || !verifyInstagramOAuthState(state)) {
    const response = buildRedirect(
      request.url,
      "error",
      "Instagram auth state validation failed"
    );
    clearPendingCookie(response);
    return response;
  }

  try {
    const shortLivedToken = await exchangeCodeForShortLivedToken(code);
    const { accessToken, expiresIn } = await exchangeForLongLivedToken(shortLivedToken);
    const igAccounts = await listInstagramAccounts(accessToken);

    if (igAccounts.length === 0) {
      return buildRedirect(
        request.url,
        "error",
        "No Instagram business account found for this Meta login"
      );
    }

    const tokenExpiresAt =
      expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000).toISOString();

    if (igAccounts.length === 1) {
      const single = igAccounts[0];
      await saveConnection(single.igUserId, single.username, accessToken, tokenExpiresAt);
      const response = buildRedirect(request.url, "connected");
      clearPendingCookie(response);
      return response;
    }

    const response = buildRedirect(request.url, "choose");
    response.cookies.set(
      META_PENDING_SELECTION_COOKIE,
      createPendingInstagramSelectionToken({
        accessToken,
        tokenExpiresAt,
        accounts: igAccounts
      }),
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 15 * 60
      }
    );
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram connection failed";
    const response = buildRedirect(request.url, "error", message);
    clearPendingCookie(response);
    return response;
  }
}
