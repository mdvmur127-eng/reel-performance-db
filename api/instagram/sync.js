const {
  clamp,
  extractMissingColumnName,
  json,
  methodNotAllowed,
  readJsonBody,
  requireUser,
  supabaseRest,
} = require("../_lib/server");
const {
  canonicalizeReelUrl,
  fetchInstagramMedia,
  getInstagramMetrics,
  normalizeAverageWatchSeconds,
  normalizePercentValue,
  reelTypeFromMedia,
} = require("../_lib/instagram");

function toNonNegativeInteger(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0;
}

function toOptionalNonNegative(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return Math.round(numeric);
}

function toOptionalPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return normalizePercentValue(numeric);
}

function normalizeInstagramToken(value) {
  let token = String(value || "").trim();
  if (!token) return "";

  token = token
    .replace(/^bearer\s+/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();

  const tokenParamMatch = token.match(/(?:^|[?#&])access_token=([^&#]+)/i);
  if (tokenParamMatch?.[1]) {
    token = decodeURIComponent(tokenParamMatch[1]);
  }

  token = token.replace(/\s+/g, "");
  return token;
}

function firstCaptionLine(caption, fallback) {
  const first = String(caption || "").split("\n")[0].trim();
  return first || fallback;
}

function stripColumns(row, droppedColumns) {
  if (!droppedColumns.size) return { ...row };
  const clone = { ...row };
  droppedColumns.forEach((column) => delete clone[column]);
  return clone;
}

function buildWatchFields(averageWatchTime, thisReelSkipRate) {
  const normalizedWatch = normalizeAverageWatchSeconds(averageWatchTime);
  const normalizedSkip = thisReelSkipRate === null ? null : toOptionalPercent(thisReelSkipRate);
  return {
    average_watch_time: normalizedWatch,
    avg_watch_time: normalizedWatch,
    this_reel_skip_rate: normalizedSkip,
  };
}

async function insertRowsWithFallback(rows, droppedColumns) {
  while (true) {
    try {
      const payload = rows.map((row) => stripColumns(row, droppedColumns));
      await supabaseRest("reels", {
        method: "POST",
        body: payload,
        prefer: "return=minimal",
      });
      return;
    } catch (error) {
      const missingColumn = extractMissingColumnName(error.message);
      if (missingColumn && !droppedColumns.has(missingColumn)) {
        droppedColumns.add(missingColumn);
        continue;
      }
      throw error;
    }
  }
}

async function updateRowWithFallback(id, userId, payload, droppedColumns) {
  while (true) {
    try {
      await supabaseRest("reels", {
        method: "PATCH",
        query: {
          id: `eq.${id}`,
          user_id: `eq.${userId}`,
        },
        body: stripColumns(payload, droppedColumns),
        prefer: "return=minimal",
      });
      return;
    } catch (error) {
      const missingColumn = extractMissingColumnName(error.message);
      if (missingColumn && !droppedColumns.has(missingColumn)) {
        droppedColumns.add(missingColumn);
        continue;
      }
      throw error;
    }
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return methodNotAllowed(res, ["POST"]);
  }

  try {
    const user = await requireUser(req);
    const body = await readJsonBody(req).catch(() => ({}));
    const limit = clamp(Number(body?.limit) || 12, 1, 50);
    const accessToken = normalizeInstagramToken(body?.token || body?.instagramToken || "");
    if (!accessToken) {
      return json(res, 400, { error: "Missing Instagram token. Paste a valid token and retry sync." });
    }

    const media = await fetchInstagramMedia(accessToken, limit);
    if (!media.length) {
      return json(res, 200, {
        inserted: 0,
        updated: 0,
        rowsWithImportedMetrics: 0,
        message: "No posts found for this account/token.",
        droppedColumns: [],
      });
    }

    const existingRows = await supabaseRest("reels", {
      query: {
        select: "*",
        user_id: `eq.${user.id}`,
        order: "created_at.desc",
      },
    });

    const existingByUrl = new Map();
    (Array.isArray(existingRows) ? existingRows : []).forEach((row) => {
      const canonical = canonicalizeReelUrl(row.video_url || row.storage_path);
      if (!canonical || existingByUrl.has(canonical)) return;
      existingByUrl.set(canonical, row);
    });

    const newRows = [];
    const updateRows = [];
    let rowsWithImportedMetrics = 0;

    for (const item of media) {
      const permalink = String(item.permalink || "").trim();
      if (!permalink) continue;

      const canonicalPermalink = canonicalizeReelUrl(permalink);
      if (!canonicalPermalink) continue;

      const metrics = await getInstagramMetrics(accessToken, item);
      const reelType = reelTypeFromMedia(item);
      const hasImportedMetrics =
        metrics.views > 0 ||
        metrics.likes > 0 ||
        metrics.comments > 0 ||
        metrics.saves > 0 ||
        metrics.average_watch_time !== null ||
        metrics.this_reel_skip_rate !== null ||
        metrics.accounts_reached !== null;
      if (hasImportedMetrics) rowsWithImportedMetrics += 1;

      const existing = existingByUrl.get(canonicalPermalink);
      if (existing) {
        const currentViews = toNonNegativeInteger(existing.views);
        const currentLikes = toNonNegativeInteger(existing.likes);
        const currentComments = toNonNegativeInteger(existing.comments);
        const currentSaves = toNonNegativeInteger(existing.saves);

        const currentAverageWatch = normalizeAverageWatchSeconds(existing.average_watch_time ?? existing.avg_watch_time);
        const currentSkipRate = toOptionalPercent(existing.this_reel_skip_rate);
        const currentAccountsReached = toOptionalNonNegative(existing.accounts_reached);

        updateRows.push({
          id: existing.id,
          payload: {
            published_at: existing.published_at || item.timestamp || null,
            views: Math.max(currentViews, metrics.views),
            likes: Math.max(currentLikes, metrics.likes),
            comments: Math.max(currentComments, metrics.comments),
            saves: Math.max(currentSaves, metrics.saves),
            ...buildWatchFields(currentAverageWatch ?? metrics.average_watch_time, currentSkipRate ?? metrics.this_reel_skip_rate),
            accounts_reached: currentAccountsReached ?? metrics.accounts_reached,
            reel_type: existing.reel_type || reelType,
            video_url: existing.video_url || permalink,
            storage_path: permalink,
            platform: existing.platform || "Instagram",
          },
        });
        continue;
      }

      newRows.push({
        user_id: user.id,
        title: firstCaptionLine(item.caption, `Instagram post ${item.id}`),
        platform: "Instagram",
        published_at: item.timestamp || null,
        storage_path: permalink,
        video_url: permalink,
        reel_type: reelType,
        views: metrics.views,
        likes: metrics.likes,
        comments: metrics.comments,
        saves: metrics.saves,
        ...buildWatchFields(metrics.average_watch_time, metrics.this_reel_skip_rate),
        accounts_reached: metrics.accounts_reached,
      });
    }

    if (!newRows.length && !updateRows.length) {
      return json(res, 200, {
        inserted: 0,
        updated: 0,
        rowsWithImportedMetrics,
        message: "No importable Instagram posts found.",
        droppedColumns: [],
      });
    }

    const droppedColumns = new Set();

    if (newRows.length) {
      await insertRowsWithFallback(newRows, droppedColumns);
    }

    if (updateRows.length) {
      for (const row of updateRows) {
        await updateRowWithFallback(row.id, user.id, row.payload, droppedColumns);
      }
    }

    return json(res, 200, {
      inserted: newRows.length,
      updated: updateRows.length,
      rowsWithImportedMetrics,
      droppedColumns: Array.from(droppedColumns),
      message: `Sync complete: ${newRows.length} new, ${updateRows.length} updated.`,
    });
  } catch (error) {
    const missingColumn = extractMissingColumnName(error?.message);
    if (missingColumn) {
      return json(res, 400, {
        error: `Supabase schema is missing '${missingColumn}'. Run the latest SQL migration, then retry sync.`,
      });
    }

    const statusCode = Number(error?.statusCode) || 500;
    return json(res, statusCode, { error: error.message || "Instagram sync failed." });
  }
};
