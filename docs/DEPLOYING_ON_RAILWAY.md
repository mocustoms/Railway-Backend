# Deploying the Backend on Railway

This guide explains how to deploy the Tenzen/EasyMauzo backend to [Railway](https://railway.app) using the included config-as-code files.

## Files Involved

| File | Purpose |
|------|---------|
| `railway.toml` | Railway config (build/deploy). Use this **or** `railway.json`, not both. |
| `railway.json` | Same as above, JSON format. |
| `package.json` | `npm start` → `node server.js`; `npm run migrate` runs DB migrations. |

## Quick Setup

### 1. Create a Railway project and add PostgreSQL

1. In [Railway](https://railway.app), create a new project.
2. Add a **PostgreSQL** service (or use an existing one).
3. In the Postgres service → **Variables** (or **Connect**), Railway exposes:
   - `DATABASE_URL` (full URL)
   - `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`

### 2. Add the Backend service

1. Add a new service → **Deploy from GitHub repo** (or **Empty** and connect repo later).
2. Set **Root Directory** to `Tenzen_Backend` (so Railway uses this folder as the app root).
3. If your repo root is already `Tenzen_Backend`, leave Root Directory blank.

### 3. Link PostgreSQL to the Backend

1. Open the **Backend** service.
2. **Variables** → **Add variable** → **Add from reference**.
3. From the Postgres service, add:
   - `PGHOST` → `${{Postgres.PGHOST}}`
   - `PGPORT` → `${{Postgres.PGPORT}}`
   - `PGDATABASE` → `${{Postgres.PGDATABASE}}`
   - `PGUSER` → `${{Postgres.PGUSER}}`
   - `PGPASSWORD` → `${{Postgres.PGPASSWORD}}`

   Or add a single variable:
   - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`  
   (The app also supports individual `PG*` vars; see `env.js`.)

### 4. Required environment variables

Set these in the Backend service **Variables** (some may come from Postgres references above):

| Variable | Required | Description |
|----------|----------|-------------|
| `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` | Yes* | From linked Postgres (or use references above). |
| `PORT` | No | Railway sets this; default in app is `3000`. |
| `NODE_ENV` | No | Set to `production` for production. |
| `JWT_SECRET` | **Yes** | Strong secret for access tokens (e.g. 32+ random chars). |
| `JWT_REFRESH_SECRET` | **Yes** | Strong secret for refresh tokens. |
| `CORS_ORIGIN` | No | Allowed origins; default `*` in production. Set to your frontend URL(s) if needed. |

\* If you use `DATABASE_URL` and the app is updated to parse it, you can rely on that instead of `PG*` (see `env.js`).

**Example (manual values):**

```
NODE_ENV=production
JWT_SECRET=your-strong-secret-here-min-32-chars
JWT_REFRESH_SECRET=another-strong-refresh-secret-here
CORS_ORIGIN=https://your-frontend.railway.app
```

### 5. Use the Railway config file

- Railway looks for `railway.toml` or `railway.json` in the **service root** (e.g. `Tenzen_Backend/`).
- If the service root is the repo root, set **Config file path** in the Backend service to: `Tenzen_Backend/railway.toml` (or `Tenzen_Backend/railway.json`).

With the config in place, each deploy will:

1. **Build** – install deps (default Node/Railpack behavior).
2. **Pre-deploy** – run `npm run migrate` (DB migrations).
3. **Start** – run `npm start` → `node server.js`.
4. **Healthcheck** – HTTP GET `/api/health` (timeout 120s).

### 6. Deploy and check

1. Trigger a deploy (push to connected branch or **Deploy** in dashboard).
2. After deploy, open the service URL. You should see the API root or a simple page if one is configured.
3. Check **Health**: `https://<your-backend-url>/api/health` — should return JSON with `"status":"OK"` and `"database":"Connected"` when DB is linked and up.

## Optional variables (from `env.js`)

| Variable | Default / behaviour |
|----------|---------------------|
| `JWT_EXPIRES_IN` | `15m` |
| `JWT_REFRESH_EXPIRES_IN` | `7d` |
| `VERIFY_SCHEMA_ON_STARTUP` | unset; set `true` to run schema verification on startup |
| `DB_LOGGING` | unset; set `true` to log SQL (noisy, use only for debugging) |
| `COOKIE_DOMAIN` | unset in dev; set in production if you need a specific cookie domain |

## Server startup (502 fix)

The server is designed to **listen on the port immediately** when `node server.js` runs. Database connection, migrations, and schedulers run in the background after the HTTP server is bound. This avoids Railway (or any reverse proxy) getting **502 Bad Gateway** or **connection refused** while DB/migrations are still running. Until the DB is connected, `/api/health` may return 503 with `"database":"Disconnected"`; API routes that need the DB will also return 503 until the connection is ready.

## Troubleshooting

- **Migrations fail in pre-deploy**  
  Ensure the Backend service has DB variables (or `DATABASE_URL`) from the Postgres service and that Postgres is running.
- **Health check fails**  
  Confirm the service is listening on `PORT` and that `/api/health` returns 200. Increase `healthcheckTimeout` in `railway.toml` / `railway.json` if startup is slow.
- **502 Bad Gateway / connection refused**  
  The server now listens on the port before running DB init. If you still see 502, check deploy logs for crashes or port binding errors; ensure `PORT` is set by Railway and the process is not exiting before the proxy can connect.
- **CORS errors from frontend**  
  Set `CORS_ORIGIN` to your frontend origin(s), e.g. `https://your-app.railway.app`.

## One config format only

Use either `railway.toml` or `railway.json`. If both exist, Railway’s behaviour depends on its current precedence rules; keeping one avoids confusion.
