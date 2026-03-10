import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

const disconnectCurrentAccount = async () => {
  const { error } = await supabaseAdmin
    .from("meta_instagram_connections")
    .delete()
    .eq("id", 1);

  if (error) {
    throw error;
  }
};

export async function POST() {
  try {
    await disconnectCurrentAccount();
    return NextResponse.json({ disconnected: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to disconnect account";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    await disconnectCurrentAccount();
    const destination = new URL("/api/meta/auth/start", request.url);
    return NextResponse.redirect(destination);
  } catch (error) {
    const destination = new URL("/", request.url);
    const message = error instanceof Error ? error.message : "Failed to disconnect account";
    destination.searchParams.set("ig", "error");
    destination.searchParams.set("ig_message", message.slice(0, 180));
    return NextResponse.redirect(destination);
  }
}
