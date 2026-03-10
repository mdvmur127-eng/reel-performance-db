import { NextResponse } from "next/server";
import { buildInstagramAuthUrl, createInstagramOAuthState } from "@/lib/meta";

export async function GET() {
  try {
    const state = createInstagramOAuthState();
    const authUrl = buildInstagramAuthUrl(state);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start Instagram auth";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
