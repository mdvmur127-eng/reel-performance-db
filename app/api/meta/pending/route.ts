import { NextRequest, NextResponse } from "next/server";
import {
  META_PENDING_SELECTION_COOKIE,
  verifyPendingInstagramSelectionToken
} from "@/lib/meta";

const clearPendingCookie = (response: NextResponse) => {
  response.cookies.set(META_PENDING_SELECTION_COOKIE, "", {
    maxAge: 0,
    path: "/"
  });
};

export async function GET(request: NextRequest) {
  const token = request.cookies.get(META_PENDING_SELECTION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json({ pending: false, accounts: [] });
  }

  const parsed = verifyPendingInstagramSelectionToken(token);

  if (!parsed) {
    const response = NextResponse.json({ pending: false, accounts: [] });
    clearPendingCookie(response);
    return response;
  }

  return NextResponse.json({
    pending: true,
    accounts: parsed.accounts
  });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  clearPendingCookie(response);
  return response;
}

