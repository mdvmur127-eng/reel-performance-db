import { NextResponse } from "next/server";
import { fetchInstagramReels, fetchReelInsights } from "@/lib/meta";
import { supabaseAdmin } from "@/lib/supabase";

type MetaConnection = {
  ig_user_id: string;
  access_token: string;
};

const toDate = (timestamp?: string) => {
  if (!timestamp) return new Date().toISOString().slice(0, 10);
  return timestamp.slice(0, 10);
};

const toTitle = (caption: string | undefined, mediaId: string) => {
  const firstLine = (caption ?? "").split("\n")[0]?.trim();
  if (firstLine) return firstLine.slice(0, 200);
  return `Reel ${mediaId.slice(-8)}`;
};

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const quickMode = requestUrl.searchParams.get("quick") === "1";

  const { data: connection, error: connectionError } = await supabaseAdmin
    .from("meta_instagram_connections")
    .select("ig_user_id, access_token")
    .eq("id", 1)
    .maybeSingle();

  if (connectionError) {
    return NextResponse.json({ error: connectionError.message }, { status: 500 });
  }

  if (!connection) {
    return NextResponse.json(
      { error: "Instagram is not connected. Click Connect IG first." },
      { status: 400 }
    );
  }

  const typedConnection = connection as MetaConnection;
  const syncLimit = Math.max(
    5,
    Math.min(
      50,
      Number(process.env.META_SYNC_LIMIT ?? (quickMode ? 12 : 25))
    )
  );
  const insightConcurrency = Math.max(
    1,
    Math.min(8, Number(process.env.META_INSIGHT_CONCURRENCY ?? 5))
  );
  const fetchInsights = process.env.META_FETCH_INSIGHTS === "true" && !quickMode;

  try {
    const reels = await fetchInstagramReels(
      typedConnection.access_token,
      typedConnection.ig_user_id,
      syncLimit
    );

    if (reels.length === 0) {
      return NextResponse.json({
        imported: 0,
        scanned: 0,
        message: "No reels found on this connected Instagram account"
      });
    }

    const rows = [] as Array<Record<string, string | number | null>>;

    for (let i = 0; i < reels.length; i += insightConcurrency) {
      const batch = reels.slice(i, i + insightConcurrency);
      const batchRows = await Promise.all(
        batch.map(async (reel) => {
          const insights = fetchInsights
            ? await fetchReelInsights(typedConnection.access_token, reel.id)
            : { plays: null, reach: null, saved: null, shares: null };

          return {
            date: toDate(reel.timestamp),
            title: toTitle(reel.caption, reel.id),
            url: reel.permalink ?? null,
            views: insights.plays,
            likes: reel.like_count ?? null,
            comments: reel.comments_count ?? null,
            saves: insights.saved,
            shares: insights.shares,
            accounts_reached: insights.reach,
            top_source_of_views: "Reels tab"
          };
        })
      );

      rows.push(...batchRows);
    }

    const { error: upsertError } = await supabaseAdmin
      .from("reel_metrics")
      .upsert(rows, { onConflict: "date,title,url" });

    if (upsertError) {
      return NextResponse.json({ error: upsertError.message }, { status: 500 });
    }

    return NextResponse.json({
      imported: rows.length,
      scanned: reels.length,
      message: fetchInsights
        ? `Synced ${rows.length} reels with insights`
        : `Synced ${rows.length} reels (quick mode, insights skipped)`
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync reels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
