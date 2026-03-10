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
   - `META_APP_ID`: from your Meta app.
   - `META_APP_SECRET`: from your Meta app.
   - `META_REDIRECT_URI`: callback URL, e.g. `https://your-domain.com/api/meta/auth/callback`.
   - `META_SYNC_LIMIT`: optional reels import limit per sync (default `25`).
   - `META_INSIGHT_CONCURRENCY`: optional parallel insight requests (default `5`).
   - `META_FETCH_INSIGHTS`: set `true` to fetch insights during full sync (default `false` for faster imports).

## 3) Meta app setup (for Connect IG)

1. In [Meta for Developers](https://developers.facebook.com/), create/select your app.
2. Add Facebook Login product.
3. Add the permissions used by this app: `instagram_basic`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`.
4. Add your callback URL to Facebook Login valid OAuth redirect URIs:
   - Local example: `http://localhost:3000/api/meta/auth/callback`
   - Prod example: `https://your-domain.com/api/meta/auth/callback`
5. Ensure your Instagram account is a Professional account connected to a Facebook Page.
6. To check a different Instagram account, use **Switch IG Account** in the app, then authenticate the other account.

## 4) Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 5) Deploy to Vercel

1. Push this folder to GitHub.
2. In Vercel, import the repo.
3. Add the same environment variables in Vercel Project Settings.
4. Deploy.
