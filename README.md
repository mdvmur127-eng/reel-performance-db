# Reels Metrics Database

A Next.js + Supabase app to manually enter and store Instagram Reels metrics.

## 1) Create the Supabase table

1. Open your Supabase dashboard.
2. Go to SQL Editor.
3. Run [`supabase/schema.sql`](./supabase/schema.sql).

The schema now uses the field set:
`Date, Title, URL, Views, Likes, Comments, Saves, Shares, Follows, Watch Time, Duration, Views (Followers), Views (Non-followers), Top source of views, Accounts Reached, This reel's skip rate, Typical skip rate, Average watch time, Audience (Men), Audience (Women), Audience (Country), Audience (Age), sec_0 ... sec_90`.

## 2) Set environment variables

1. Copy `.env.example` to `.env.local`.
2. Add values:
   - `NEXT_PUBLIC_SUPABASE_URL`: from Supabase project settings.
   - `SUPABASE_SERVICE_ROLE_KEY`: from Supabase project API keys.

## 3) Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 4) Deploy to Vercel

1. Push this folder to GitHub.
2. In Vercel, import the repo.
3. Add the same environment variables in Vercel Project Settings.
4. Deploy.
