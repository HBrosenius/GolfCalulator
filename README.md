# golfcalc-sync-worker

Live-round sync relay for GolfCalculator. A tiny Cloudflare Worker + KV
backend — no framework, no dependencies at runtime. Only `wrangler` is
needed locally to develop and deploy it.

## What it does

Stores one JSON blob per live round, keyed by a short room code, so
multiple phones can push/pull score updates for the same in-progress
round. Rooms auto-expire after 24h (KV TTL) — nothing to clean up.

See `src/index.js` for the four endpoints (`POST /room`, `GET /room/:code`,
`PATCH /room/:code`, `POST /room/:code/claim`).

## Local test (no Cloudflare account needed)

Runs the real Worker code against a `Map`-backed fake KV:

```bash
node test/local-test.js
```

## Deploy

You'll need a free Cloudflare account and the `wrangler` CLI.

```bash
# 1. Install wrangler (or use npx wrangler for one-off commands)
npm install

# 2. Log in — opens a browser to authorize
npx wrangler login

# 3. Create the KV namespace
npx wrangler kv namespace create GOLF_ROOMS
```

That last command prints an `id`. Copy it into `wrangler.toml`, replacing
`REPLACE_WITH_YOUR_KV_NAMESPACE_ID`:

```toml
kv_namespaces = [
  { binding = "GOLF_ROOMS", id = "PASTE_THE_ID_HERE" }
]
```

```bash
# 4. Deploy
npx wrangler deploy
```

This prints your Worker's URL, something like:

```
https://golfcalc-sync.<your-subdomain>.workers.dev
```

That's the base URL `index.html` will call for live rounds — I'll wire
it in as a constant (`SYNC_BASE_URL`) in the next phase, once you've got
this deployed and can hand me the URL.

## Local dev server (optional, for iterating on the Worker itself)

```bash
npx wrangler dev
```

Runs the Worker locally with a real (local-mode) KV binding, so you can
`curl` it directly while making changes.
