# Reels Metrics Database

Next.js frontend + Go backend + Supabase.  
All business logic/API processing now runs in Go (`go-backend/main.go`).  
`app/api/*` in Next.js are proxy routes only.

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
   - `GO_BACKEND_URL`: URL of Go backend used by Next proxy routes. Local default: `http://127.0.0.1:8080`.
   - `GO_SERVER_ADDR`: address for local Go backend server. Default: `:8080`.
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

You need both servers running:

Terminal 1 (Go backend):

```bash
cd go-backend
go run .
```

Terminal 2 (Next.js frontend):

```bash
cd ..
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 5) Deploy to Vercel

Vercel hosts your Next.js frontend/proxy.  
Go backend must run separately (for example Fly.io/Render/Railway/VM), then Vercel forwards API calls to it via `GO_BACKEND_URL`.

1. Deploy Go backend (`go-backend`) to a reachable URL.
2. Set `GO_BACKEND_URL` in Vercel to that URL.
3. Set all other env vars in both environments (Go backend + Vercel).
4. Deploy Next app on Vercel.
