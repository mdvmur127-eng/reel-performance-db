import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

type MetricPayload = Record<string, string | number | undefined>;

const textFields = [
  "url",
  "top_source_of_views",
  "audience_country",
  "audience_age"
] as const;

const numericFields = [
  "views",
  "likes",
  "comments",
  "saves",
  "shares",
  "follows",
  "watch_time",
  "duration",
  "views_followers",
  "views_non_followers",
  "accounts_reached",
  "this_reels_skip_rate",
  "typical_skip_rate",
  "average_watch_time",
  "audience_men",
  "audience_women",
  ...Array.from({ length: 91 }, (_, index) => `sec_${index}`)
] as const;

const asNullableNumber = (value: string | number | undefined) => {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export async function GET() {
  const { data, error } = await supabaseAdmin
    .from("reel_metrics")
    .select("*")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}

export async function POST(request: Request) {
  const body = (await request.json()) as MetricPayload;

  const date = String(body.date ?? "").trim();
  const title = String(body.title ?? "").trim();

  if (!date) {
    return NextResponse.json({ error: "date is required" }, { status: 400 });
  }

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const payload: Record<string, string | number | null> = {
    date,
    title
  };

  for (const field of textFields) {
    const value = body[field];
    payload[field] = value === undefined ? null : String(value).trim() || null;
  }

  for (const field of numericFields) {
    payload[field] = asNullableNumber(body[field]);
  }

  const { data, error } = await supabaseAdmin
    .from("reel_metrics")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data }, { status: 201 });
}
