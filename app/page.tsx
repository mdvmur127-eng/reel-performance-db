"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Metric = {
  id: string;
  date: string;
  title: string;
  url: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  follows: number | null;
  created_at: string;
};

type FormState = Record<string, string>;

type FieldConfig = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "url" | "textarea";
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
  { key: "audience_country", label: "Audience (Country)", type: "text" },
  { key: "audience_age", label: "Audience (Age)", type: "text" },
  { key: "top_source_of_views", label: "Top source of views", type: "text" }
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
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("Loading...");

  const totalViews = useMemo(
    () => rows.reduce((sum, row) => sum + (row.views ?? 0), 0),
    [rows]
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

  useEffect(() => {
    loadRows().catch(() => setMessage("Failed to load metrics"));
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage("Saving...");

    const res = await fetch("/api/metrics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });

    const json = await res.json();

    if (!res.ok) {
      setLoading(false);
      setMessage(json.error ?? "Could not save metric");
      return;
    }

    const nextForm = createInitialForm();
    nextForm.date = form.date;
    setForm(nextForm);
    setRows((current) => [json.data, ...current]);
    setLoading(false);
    setMessage("Saved metric entry");
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
              onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
            />
          ) : (
            <input
              type={field.type}
              required={field.required}
              value={form[field.key]}
              onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
            />
          )}
        </label>
      ))}
    </div>
  );

  return (
    <main>
      <header className="page-header">
        <h1>Reels Metrics Database</h1>
        <p className="subtitle">Structured form for clean manual reel snapshots.</p>
      </header>

      <section className="card">
        <form onSubmit={onSubmit}>
          <h2 className="section-title">Core Metrics</h2>
          {renderFields(primaryFields)}

          <h2 className="section-title">Audience + Performance</h2>
          {renderFields(audienceFields)}

          <details className="expander">
            <summary>Second-by-second Retention (sec_0 to sec_90)</summary>
            {renderFields(secFields, "grid grid-tight")}
          </details>

          <div className="actions">
            <button disabled={loading} type="submit">
              {loading ? "Saving..." : "Save Metrics"}
            </button>
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.date}</td>
                  <td>{row.title}</td>
                  <td>{row.url ?? "-"}</td>
                  <td>{row.views?.toLocaleString() ?? "-"}</td>
                  <td>{row.likes?.toLocaleString() ?? "-"}</td>
                  <td>{row.comments?.toLocaleString() ?? "-"}</td>
                  <td>{row.saves?.toLocaleString() ?? "-"}</td>
                  <td>{row.shares?.toLocaleString() ?? "-"}</td>
                  <td>{row.follows?.toLocaleString() ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
