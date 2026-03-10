"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Metric = {
  id: string;
  date: string;
  title: string;
  url: string | null;
  views: number | null;
  views_non_followers: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  follows: number | null;
  average_watch_time: number | null;
  duration: number | null;
  accounts_reached: number | null;
  created_at: string;
  [key: string]: string | number | null | undefined;
};

type FormState = Record<string, string>;
type MetricSource = Record<string, string | number | null | undefined>;
type InstagramStatus = {
  connected: boolean;
  account: {
    ig_user_id: string;
    ig_username: string | null;
    token_expires_at: string | null;
    updated_at: string;
  } | null;
};

type PendingInstagramAccount = {
  igUserId: string;
  username: string | null;
  pageId: string;
  pageName: string | null;
};

type FieldConfig = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "url" | "textarea" | "select";
  options?: string[];
  required?: boolean;
};

const today = new Date().toISOString().slice(0, 10);

const primaryFields: FieldConfig[] = [
  { key: "date", label: "Date", type: "date", required: true },
  { key: "title", label: "Title", type: "text", required: true },
  { key: "url", label: "URL", type: "url" },
  { key: "views", label: "Views", type: "number" },
  { key: "likes", label: "Likes", type: "number" },
  { key: "comments", label: "Comments", type: "number" },
  { key: "saves", label: "Saves", type: "number" },
  { key: "shares", label: "Shares", type: "number" },
  { key: "follows", label: "Follows", type: "number" },
  { key: "watch_time", label: "Watch Time", type: "number" },
  { key: "duration", label: "Duration", type: "number" },
  { key: "accounts_reached", label: "Accounts Reached", type: "number" }
];

const audienceFields: FieldConfig[] = [
  { key: "views_followers", label: "Views (Followers)", type: "number" },
  { key: "views_non_followers", label: "Views (Non-followers)", type: "number" },
  { key: "this_reels_skip_rate", label: "This reel's skip rate", type: "number" },
  { key: "typical_skip_rate", label: "Typical skip rate", type: "number" },
  { key: "average_watch_time", label: "Average watch time", type: "number" },
  { key: "audience_men", label: "Audience (Men)", type: "number" },
  { key: "audience_women", label: "Audience (Women)", type: "number" },
  {
    key: "audience_country",
    label: "Audience (Country)",
    type: "select",
    options: [
      "United States",
      "United Kingdom",
      "Canada",
      "Australia",
      "India",
      "Germany",
      "France",
      "Italy",
      "Spain",
      "Brazil",
      "Mexico",
      "N/A"
    ]
  },
  {
    key: "audience_age",
    label: "Audience (Age)",
    type: "select",
    options: ["13-17", "18-24", "25-34", "35-44", "45-54", "55-64", "65+", "N/A"]
  },
  {
    key: "top_source_of_views",
    label: "Top source of views",
    type: "select",
    options: ["Reels tab", "Explore", "Profile", "Feed", "N/A"]
  }
];

const secFields: FieldConfig[] = Array.from({ length: 91 }, (_, second) => ({
  key: `sec_${second}`,
  label: `sec_${second}`,
  type: "number"
}));

const fields = [...primaryFields, ...audienceFields, ...secFields];

const createInitialForm = () => {
  const initial: FormState = {};
  for (const field of fields) {
    initial[field.key] = field.key === "date" ? today : "";
  }
  return initial;
};

export default function Home() {
  const [form, setForm] = useState<FormState>(createInitialForm);
  const [rows, setRows] = useState<Metric[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedInsightId, setSelectedInsightId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Loading...");
  const [igStatus, setIgStatus] = useState<InstagramStatus | null>(null);
  const [igSyncing, setIgSyncing] = useState(false);
  const [igMessage, setIgMessage] = useState("");
  const [pendingAccounts, setPendingAccounts] = useState<PendingInstagramAccount[]>([]);
  const [showAccountPicker, setShowAccountPicker] = useState(false);
  const [pickingAccountId, setPickingAccountId] = useState<string | null>(null);

  const totalViews = useMemo(
    () => rows.reduce((sum, row) => sum + (row.views ?? 0), 0),
    [rows]
  );
  const latestRow = rows[0];
  const selectedInsightRow = useMemo(
    () => rows.find((row) => row.id === selectedInsightId) ?? null,
    [rows, selectedInsightId]
  );

  const loadRows = async () => {
    const res = await fetch("/api/metrics");
    const json = await res.json();

    if (!res.ok) {
      setMessage(json.error ?? "Failed to load metrics");
      return;
    }

    setRows(json.data ?? []);
    setMessage(`Loaded ${json.data?.length ?? 0} records`);
  };

  const loadInstagramStatus = async () => {
    const res = await fetch("/api/meta/status");
    const json = (await res.json()) as InstagramStatus & { error?: string };

    if (!res.ok) {
      setIgMessage(json.error ?? "Failed to load Instagram connection status");
      return;
    }

    setIgStatus(json);
  };

  const loadPendingAccounts = async () => {
    const res = await fetch("/api/meta/pending");
    const json = (await res.json()) as {
      pending: boolean;
      accounts: PendingInstagramAccount[];
      error?: string;
    };

    if (!res.ok) {
      setIgMessage(json.error ?? "Failed to load Instagram account options");
      return;
    }

    if (json.pending && (json.accounts?.length ?? 0) > 0) {
      setPendingAccounts(json.accounts);
      setShowAccountPicker(true);
      setIgMessage("Select the Instagram account you want to connect");
      return;
    }

    setPendingAccounts([]);
    setShowAccountPicker(false);
  };

  useEffect(() => {
    loadRows().catch(() => setMessage("Failed to load metrics"));
    loadInstagramStatus().catch(() =>
      setIgMessage("Failed to load Instagram connection status")
    );

    const query = new URLSearchParams(window.location.search);
    const igState = query.get("ig");
    const igStateMessage = query.get("ig_message");

    if (igState === "connected") {
      setIgMessage("Instagram connected successfully");
    }

    if (igState === "error") {
      setIgMessage(igStateMessage ?? "Instagram connection failed");
    }

    if (igState === "choose") {
      loadPendingAccounts().catch(() =>
        setIgMessage("Failed to load Instagram account options")
      );
    }

    if (igState || igStateMessage) {
      query.delete("ig");
      query.delete("ig_message");
      const nextQuery = query.toString();
      const cleanUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`;
      window.history.replaceState({}, "", cleanUrl);
    }
  }, []);

  useEffect(() => {
    if (!selectedInsightId) return;
    const stillExists = rows.some((row) => row.id === selectedInsightId);
    if (!stillExists) {
      setSelectedInsightId(null);
    }
  }, [rows, selectedInsightId]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const activeEditId = editingId;
    const isEditing = activeEditId !== null;

    setLoading(true);
    setMessage(isEditing ? "Updating..." : "Saving...");

    const res = await fetch("/api/metrics", {
      method: isEditing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isEditing ? { ...form, id: activeEditId } : form)
    });

    const json = await res.json();

    if (!res.ok) {
      setLoading(false);
      setMessage(json.error ?? "Could not save metric");
      return;
    }

    setLoading(false);

    if (isEditing && activeEditId) {
      setRows((current) =>
        current.map((row) => (row.id === activeEditId ? json.data : row))
      );
      setEditingId(null);
      setMessage("Updated metric entry");
      return;
    }

    const nextForm = createInitialForm();
    nextForm.date = form.date;
    setForm(nextForm);
    setRows((current) => [json.data, ...current]);
    setMessage("Saved metric entry");
  };

  const metricToForm = (metric: MetricSource): FormState => {
    const next = createInitialForm();
    for (const field of fields) {
      const value = metric[field.key];
      next[field.key] = value === null || value === undefined ? "" : String(value);
    }
    if (!next.date) {
      next.date = today;
    }
    return next;
  };

  const startEditingRow = (row: Metric) => {
    setForm(metricToForm(row));
    setEditingId(row.id);
    setMessage(`Editing "${row.title}"`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const viewInsightsForRow = (row: Metric) => {
    setSelectedInsightId(row.id);
    document.getElementById("calculated-metrics")?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  };

  const cancelEditing = () => {
    setEditingId(null);
    setForm(createInitialForm());
    setMessage("Edit canceled");
  };

  const syncInstagramReels = async () => {
    setIgSyncing(true);
    setIgMessage("Syncing reels from Instagram...");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);

    let res: Response;

    try {
      res = await fetch("/api/meta/sync", {
        method: "POST",
        signal: controller.signal
      });
    } catch {
      clearTimeout(timeout);
      setIgSyncing(false);
      setIgMessage("Sync timed out. Try again (or reconnect IG).");
      return;
    }

    clearTimeout(timeout);
    const json = (await res.json()) as {
      imported?: number;
      scanned?: number;
      message?: string;
      error?: string;
    };

    if (!res.ok) {
      setIgSyncing(false);
      setIgMessage(json.error ?? "Failed to sync reels");
      return;
    }

    const imported = json.imported ?? 0;
    const scanned = json.scanned ?? imported;
    setIgMessage(
      imported > 0
        ? `Synced ${imported} reels (scanned ${scanned})`
        : json.message ?? `No reels imported (scanned ${scanned})`
    );
    await Promise.all([loadRows(), loadInstagramStatus()]);
    setIgSyncing(false);
  };

  const quickSyncInstagramReels = async () => {
    setIgSyncing(true);
    setIgMessage("Quick syncing reels...");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);

    let res: Response;

    try {
      res = await fetch("/api/meta/sync?quick=1", {
        method: "POST",
        signal: controller.signal
      });
    } catch {
      clearTimeout(timeout);
      setIgSyncing(false);
      setIgMessage("Sync timed out. Try again (or reconnect IG).");
      return;
    }

    clearTimeout(timeout);
    const json = (await res.json()) as {
      imported?: number;
      scanned?: number;
      message?: string;
      error?: string;
    };

    if (!res.ok) {
      setIgSyncing(false);
      setIgMessage(json.error ?? "Failed to sync reels");
      return;
    }

    const imported = json.imported ?? 0;
    const scanned = json.scanned ?? imported;
    setIgMessage(
      imported > 0
        ? json.message ?? `Quick synced ${imported} reels (scanned ${scanned})`
        : json.message ?? `No reels imported (scanned ${scanned})`
    );
    await Promise.all([loadRows(), loadInstagramStatus()]);
    setIgSyncing(false);
  };

  const switchInstagramAccount = async () => {
    setIgMessage("Switching account...");

    const res = await fetch("/api/meta/disconnect", {
      method: "POST"
    });
    const json = (await res.json()) as { error?: string };

    if (!res.ok) {
      setIgMessage(json.error ?? "Failed to disconnect current Instagram account");
      return;
    }

    window.location.href = "/api/meta/auth/start";
  };

  const closeAccountPicker = async () => {
    setShowAccountPicker(false);
    setPendingAccounts([]);
    await fetch("/api/meta/pending", { method: "DELETE" }).catch(() => undefined);
  };

  const selectInstagramAccount = async (igUserId: string) => {
    setPickingAccountId(igUserId);
    const res = await fetch("/api/meta/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ igUserId })
    });
    const json = (await res.json()) as { error?: string };
    setPickingAccountId(null);

    if (!res.ok) {
      setIgMessage(json.error ?? "Failed to connect selected Instagram account");
      return;
    }

    setShowAccountPicker(false);
    setPendingAccounts([]);
    setIgMessage("Instagram account connected");
    await loadInstagramStatus();
  };

  const parseMaybeNumber = (value: string) => {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const formatNumberString = (value: number) => {
    if (Number.isInteger(value)) return String(value);
    return String(Number(value.toFixed(4)));
  };

  const handleFieldChange = (fieldKey: string, value: string) => {
    setForm((current) => {
      const next = { ...current, [fieldKey]: value };
      const numericValue = parseMaybeNumber(value);

      // Keep gender split consistent at 100%.
      if (fieldKey === "audience_men") {
        if (numericValue !== null) {
          const men = Math.max(0, Math.min(100, numericValue));
          next.audience_men = formatNumberString(men);
          next.audience_women = formatNumberString(100 - men);
        } else {
          next.audience_women = "";
        }
      }

      if (fieldKey === "audience_women") {
        if (numericValue !== null) {
          const women = Math.max(0, Math.min(100, numericValue));
          next.audience_women = formatNumberString(women);
          next.audience_men = formatNumberString(100 - women);
        } else {
          next.audience_men = "";
        }
      }

      // Keep follower/non-follower views consistent with total views.
      const totalViews = parseMaybeNumber(next.views);

      if (fieldKey === "views_followers" && totalViews !== null && numericValue !== null) {
        const followers = Math.max(0, Math.min(totalViews, numericValue));
        next.views_followers = formatNumberString(followers);
        next.views_non_followers = formatNumberString(totalViews - followers);
      }

      if (
        fieldKey === "views_non_followers" &&
        totalViews !== null &&
        numericValue !== null
      ) {
        const nonFollowers = Math.max(0, Math.min(totalViews, numericValue));
        next.views_non_followers = formatNumberString(nonFollowers);
        next.views_followers = formatNumberString(totalViews - nonFollowers);
      }

      if (fieldKey === "views" && totalViews !== null) {
        const followers = parseMaybeNumber(next.views_followers);
        const nonFollowers = parseMaybeNumber(next.views_non_followers);

        if (followers !== null) {
          const safeFollowers = Math.max(0, Math.min(totalViews, followers));
          next.views_followers = formatNumberString(safeFollowers);
          next.views_non_followers = formatNumberString(totalViews - safeFollowers);
        } else if (nonFollowers !== null) {
          const safeNonFollowers = Math.max(0, Math.min(totalViews, nonFollowers));
          next.views_non_followers = formatNumberString(safeNonFollowers);
          next.views_followers = formatNumberString(totalViews - safeNonFollowers);
        }
      }

      return next;
    });
  };

  const renderFields = (group: FieldConfig[], gridClassName = "grid") => (
    <div className={gridClassName}>
      {group.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.required ? "*" : ""}
          {field.type === "textarea" ? (
            <textarea
              required={field.required}
              value={form[field.key]}
              onChange={(event) => handleFieldChange(field.key, event.target.value)}
            />
          ) : field.type === "select" ? (
            <select
              required={field.required}
              value={form[field.key]}
              onChange={(event) => handleFieldChange(field.key, event.target.value)}
            >
              <option value="">Select...</option>
              {(field.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={field.type}
              required={field.required}
              value={form[field.key]}
              onChange={(event) => handleFieldChange(field.key, event.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );

  const asNumber = (value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const ratio = (
    numerator: string | number | null | undefined,
    denominator: string | number | null | undefined
  ) => {
    const top = asNumber(numerator);
    const bottom = asNumber(denominator);
    if (top === null || bottom === null || bottom <= 0) return null;
    return top / bottom;
  };

  const secValue = (source: MetricSource, second: number) =>
    asNumber(source[`sec_${second}`]);

  const completionRate = (source: MetricSource) => {
    const sec0 = secValue(source, 0);
    if (sec0 === null || sec0 <= 0) return null;

    const duration = asNumber(source.duration);
    if (duration !== null) {
      const target = Math.max(0, Math.min(90, Math.round(duration)));
      const direct = secValue(source, target);
      if (direct !== null) return direct / sec0;
    }

    for (let i = 90; i >= 0; i -= 1) {
      const value = secValue(source, i);
      if (value !== null) return value / sec0;
    }

    return null;
  };

  const formatPercent = (value: number | null) =>
    value === null ? "-" : `${(value * 100).toFixed(2)}%`;

  const formatNumber = (value: number | null) =>
    value === null ? "-" : value.toFixed(3);

  const toExternalUrl = (value: string) => {
    if (/^https?:\/\//i.test(value)) {
      return value;
    }
    return `https://${value}`;
  };

  const metricSource: MetricSource = selectedInsightRow ?? latestRow ?? form;

  const derivedMetrics = metricSource
    ? (() => {
        const sec0 = secValue(metricSource, 0);
        const sec3 = secValue(metricSource, 3);
        const hookRetention =
          sec0 !== null && sec0 > 0 && sec3 !== null ? sec3 / sec0 : null;
        const engagementTop =
          (asNumber(metricSource.likes) ?? 0) +
          (asNumber(metricSource.comments) ?? 0) +
          (asNumber(metricSource.saves) ?? 0) +
          (asNumber(metricSource.shares) ?? 0);

        return [
          { label: "Hook Retention", value: formatPercent(hookRetention) },
          {
            label: "Early Drop",
            value: formatPercent(hookRetention === null ? null : 1 - hookRetention)
          },
          {
            label: "Average Retention",
            value: formatPercent(ratio(metricSource.average_watch_time, metricSource.duration))
          },
          { label: "Completion Rate", value: formatPercent(completionRate(metricSource)) },
          {
            label: "Non-Follower Ratio",
            value: formatPercent(ratio(metricSource.views_non_followers, metricSource.views))
          },
          {
            label: "Views per Reach",
            value: formatNumber(ratio(metricSource.views, metricSource.accounts_reached))
          },
          {
            label: "Engagement Rate",
            value: formatPercent(ratio(engagementTop, metricSource.views))
          },
          { label: "Save Rate", value: formatPercent(ratio(metricSource.saves, metricSource.views)) },
          { label: "Share Rate", value: formatPercent(ratio(metricSource.shares, metricSource.views)) },
          {
            label: "Follow Rate",
            value: formatPercent(ratio(metricSource.follows, metricSource.views))
          }
        ];
      })()
    : [];

  return (
    <main>
      <header className="page-header">
        <div>
          <h1>Reels Metrics Database</h1>
          <p className="subtitle">Structured form for clean manual reel snapshots.</p>
        </div>
        <div className="header-actions">
          {igStatus?.connected ? (
            <>
              <span className="ig-pill">
                IG Connected: @{igStatus.account?.ig_username ?? igStatus.account?.ig_user_id}
              </span>
              <button
                className="secondary-btn"
                type="button"
                onClick={quickSyncInstagramReels}
                disabled={igSyncing}
              >
                {igSyncing ? "Syncing IG..." : "Quick Sync"}
              </button>
              <button
                className="secondary-btn"
                type="button"
                onClick={syncInstagramReels}
                disabled={igSyncing}
              >
                {igSyncing ? "Syncing IG..." : "Full Sync"}
              </button>
              <button
                className="secondary-btn"
                type="button"
                onClick={switchInstagramAccount}
                disabled={igSyncing}
              >
                Switch IG Account
              </button>
            </>
          ) : (
            <a className="secondary-btn" href="/api/meta/auth/start">
              Connect IG
            </a>
          )}
        </div>
      </header>
      {igMessage ? <p className="subtitle ig-message">{igMessage}</p> : null}

      {showAccountPicker ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="account-picker-modal">
            <div className="account-picker-head">
              <h3>Choose Instagram account</h3>
              <button
                className="secondary-btn table-btn subtle-btn"
                type="button"
                onClick={closeAccountPicker}
              >
                Close
              </button>
            </div>
            <p className="subtitle">
              Select which Instagram profile you want to connect to this app.
            </p>
            <div className="account-picker-list">
              {pendingAccounts.map((account) => (
                <div key={account.igUserId} className="account-picker-item">
                  <div className="account-picker-info">
                    <strong>@{account.username ?? account.igUserId}</strong>
                    <span>
                      Facebook Page: {account.pageName ?? (account.pageId || "Unknown")}
                    </span>
                  </div>
                  <button
                    className="secondary-btn table-btn"
                    type="button"
                    onClick={() => selectInstagramAccount(account.igUserId)}
                    disabled={pickingAccountId !== null}
                  >
                    {pickingAccountId === account.igUserId ? "Connecting..." : "Select"}
                  </button>
                </div>
              ))}
            </div>
            <div className="account-picker-actions">
              <button
                className="secondary-btn subtle-btn table-btn"
                type="button"
                onClick={() => loadPendingAccounts()}
                disabled={pickingAccountId !== null}
              >
                Refresh list
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="card">
        <form onSubmit={onSubmit}>
          <h2 className="section-title">Core Metrics</h2>
          {editingId ? (
            <p className="subtitle edit-mode-note">
              Editing existing entry. Update fields and click <strong>Update Entry</strong>.
            </p>
          ) : null}
          {renderFields(primaryFields)}

          <h2 className="section-title">Audience + Performance</h2>
          {renderFields(audienceFields)}

          <details className="expander">
            <summary>Second-by-second Retention (sec_0 to sec_90)</summary>
            {renderFields(secFields, "grid grid-tight")}
          </details>

          <div className="actions">
            <button disabled={loading} type="submit">
              {loading
                ? editingId
                  ? "Updating..."
                  : "Saving..."
                : editingId
                  ? "Update Entry"
                  : "Save Metrics"}
            </button>
            {editingId ? (
              <button className="secondary-btn subtle-btn" disabled={loading} type="button" onClick={cancelEditing}>
                Cancel Edit
              </button>
            ) : null}
            <span className="feedback">{message}</span>
          </div>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Recent Entries</h2>
        <p className="subtitle">Total views in loaded records: {totalViews.toLocaleString()}</p>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Title</th>
                <th>URL</th>
                <th>Views</th>
                <th>Likes</th>
                <th>Comments</th>
                <th>Saves</th>
                <th>Shares</th>
                <th>Follows</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className={selectedInsightId === row.id ? "selected-row" : undefined}
                >
                  <td>{row.date}</td>
                  <td>{row.title}</td>
                  <td className="url-cell">
                    {row.url ? (
                      <a
                        className="url-link"
                        href={toExternalUrl(row.url)}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {row.url}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td>{row.views?.toLocaleString() ?? "-"}</td>
                  <td>{row.likes?.toLocaleString() ?? "-"}</td>
                  <td>{row.comments?.toLocaleString() ?? "-"}</td>
                  <td>{row.saves?.toLocaleString() ?? "-"}</td>
                  <td>{row.shares?.toLocaleString() ?? "-"}</td>
                  <td>{row.follows?.toLocaleString() ?? "-"}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        type="button"
                        className="secondary-btn table-btn"
                        onClick={() => viewInsightsForRow(row)}
                      >
                        {selectedInsightId === row.id ? "Viewing" : "View Insights"}
                      </button>
                      <button
                        type="button"
                        className="secondary-btn table-btn subtle-btn"
                        onClick={() => startEditingRow(row)}
                      >
                        {editingId === row.id ? "Editing" : "Edit"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="calculated-metrics" className="card">
        <div className="card-head">
          <h2 style={{ marginTop: 0 }}>Calculated Metrics</h2>
          {selectedInsightRow ? (
            <button
              type="button"
              className="secondary-btn subtle-btn table-btn"
              onClick={() => setSelectedInsightId(null)}
            >
              Show Latest Reel
            </button>
          ) : null}
        </div>
        <p className="subtitle">
          {selectedInsightRow
            ? `${selectedInsightRow.title} · ${selectedInsightRow.date} (selected reel insights)`
            : latestRow
            ? `${latestRow.title} · ${latestRow.date} (latest saved entry)`
            : "Live preview from current form values"}
        </p>
        {selectedInsightRow?.url ? (
          <p className="subtitle">
            Reel URL:{" "}
            <a
              className="url-link"
              href={toExternalUrl(selectedInsightRow.url)}
              target="_blank"
              rel="noreferrer noopener"
            >
              {selectedInsightRow.url}
            </a>
          </p>
        ) : null}
          <div className="grid metric-grid">
            {derivedMetrics.map((metric) => (
              <div key={metric.label} className="metric-tile">
                <strong>{metric.label}</strong>
                <div className="metric-value">{metric.value}</div>
              </div>
            ))}
          </div>
      </section>
    </main>
  );
}
