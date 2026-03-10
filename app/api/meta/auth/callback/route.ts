import { NextRequest, NextResponse } from "next/server";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getInstagramAccount,
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

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorDescription = url.searchParams.get("error_description");

  if (errorDescription) {
    return buildRedirect(request.url, "error", errorDescription);
  }

  if (!code || !state || !verifyInstagramOAuthState(state)) {
    return buildRedirect(request.url, "error", "Instagram auth state validation failed");
  }

  try {
    const shortLivedToken = await exchangeCodeForShortLivedToken(code);
    const { accessToken, expiresIn } = await exchangeForLongLivedToken(shortLivedToken);
    const igAccount = await getInstagramAccount(accessToken);

    if (!igAccount) {
      return buildRedirect(
        request.url,
        "error",
        "No Instagram business account found for this Meta login"
      );
    }

    const tokenExpiresAt =
      expiresIn === null ? null : new Date(Date.now() + expiresIn * 1000).toISOString();

    const { error } = await supabaseAdmin.from("meta_instagram_connections").upsert(
      {
        id: 1,
        ig_user_id: igAccount.igUserId,
        ig_username: igAccount.username,
        access_token: accessToken,
        token_expires_at: tokenExpiresAt
      },
      { onConflict: "id" }
    );

    if (error) {
      throw error;
    }

    return buildRedirect(request.url, "connected");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Instagram connection failed";
    return buildRedirect(request.url, "error", message);
  }
}
