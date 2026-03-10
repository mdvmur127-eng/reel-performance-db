import { NextRequest, NextResponse } from "next/server";
import {
  META_PENDING_SELECTION_COOKIE,
  verifyPendingInstagramSelectionToken
} from "@/lib/meta";
import { supabaseAdmin } from "@/lib/supabase";

const clearPendingCookie = (response: NextResponse) => {
  response.cookies.set(META_PENDING_SELECTION_COOKIE, "", {
    maxAge: 0,
    path: "/"
  });
};

export async function POST(request: NextRequest) {
  const token = request.cookies.get(META_PENDING_SELECTION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json(
      { error: "No pending Instagram account selection found" },
      { status: 400 }
    );
  }

  const parsed = verifyPendingInstagramSelectionToken(token);

  if (!parsed) {
    const response = NextResponse.json(
      { error: "Pending selection expired. Please connect Instagram again." },
      { status: 400 }
    );
    clearPendingCookie(response);
    return response;
  }

  const body = (await request.json()) as { igUserId?: string };
  const igUserId = String(body.igUserId ?? "").trim();

  if (!igUserId) {
    return NextResponse.json({ error: "igUserId is required" }, { status: 400 });
  }

  const selected = parsed.accounts.find((account) => account.igUserId === igUserId);

  if (!selected) {
    return NextResponse.json(
      { error: "Selected Instagram account is not available in this session" },
      { status: 400 }
    );
  }

  const { error } = await supabaseAdmin.from("meta_instagram_connections").upsert(
    {
      id: 1,
      ig_user_id: selected.igUserId,
      ig_username: selected.username,
      access_token: parsed.accessToken,
      token_expires_at: parsed.tokenExpiresAt
    },
    { onConflict: "id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const response = NextResponse.json({
    connected: true,
    account: selected
  });
  clearPendingCookie(response);
  return response;
}

