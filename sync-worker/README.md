# golfcalc-sync-worker

Secure live-round sync relay for GolfCalculator. A Cloudflare Worker routes
each four-character join code to one SQLite-backed Durable Object. Host and
seat bearer tokens authorize mutations while room reads remain available via
the public join code.

## What it does

Each room Durable Object serializes seat claims, score writes and betting
decisions, preventing lost-update races. Tokens are generated with Web Crypto,
stored as SHA-256 hashes, and compared in constant time. Rooms expire after
24 hours through a Durable Object alarm.

Shared tours use a separate Durable Object namespace. An organizer publishes
an immutable roster and course snapshot with editable competition conditions, invitation links are exchanged for
revocable per-device contributor tokens, and accepted rounds are recomputed
server-side and deduplicated by their client round ID. Durable Object alarms
complete tours after their end date and later remove them after retention;
request-time reconciliation provides the same transition if an alarm is delayed.

See `src/index.js` for the endpoints (`POST /room`, `GET /room/:code`,
`PATCH /room/:code`, `POST /room/:code/claim`, `POST /room/:code/bets`,
`POST /room/:code/bets/:id/respond`, `POST /room/:code/bets/:id/cancel`).

Tour endpoints are `POST /tour`, `GET /tour/:code`, `POST /tour/:code/join`,
`GET /tour/:code/access`, `POST /tour/:code/rounds`, and the organizer-only
`GET /tour/:code/manage`, `POST /tour/:code/rotate-invitation`,
`PATCH /tour/:code/conditions`, `POST /tour/:code/complete`, `POST /tour/:code/cancel`,
`DELETE /tour/:code`, and
`POST /tour/:code/contributors/:id/revoke`.

## Authorization

- Creating a room returns a public join code, a private host token and the
  private token for seat 0.
- Claiming an open seat returns that seat's private token.
- Seat tokens authorize only that seat's scores and betting actions.
- The host token authorizes markers, note/weather, unclaimed-seat scores and
  cancellation of any pending bet.
- Public room responses expose only `claimed: true|false`, never credentials or
  internal ownership identifiers.
- Public tour responses never expose token hashes. Invitation secrets are used
  only for joining; organizer and contributor bearer tokens authorize changes.

Every mutation sends `X-Golf-Protocol: 2` and includes `protocolVersion: 2` in
its bounded JSON body.

## Local test (no Cloudflare account needed)

Runs the real Worker and Durable Objects inside Cloudflare's Workers test
runtime, including concurrent requests and alarms:

```bash
npm test
```

## Deploy

You'll need a free Cloudflare account and the `wrangler` CLI.

```bash
# 1. Install wrangler (or use npx wrangler for one-off commands)
npm install

# 2. Log in — opens a browser to authorize
npx wrangler login

# 3. Deploy staging, then production
npm run deploy:staging
npm run deploy
```

This prints your Worker's URL, something like:

```
https://golfcalc-sync.<your-subdomain>.workers.dev
```

That base URL is wired into the app as `LIVE_SYNC_BASE` in `index.html` —
update it there if you ever redeploy the Worker under a different
subdomain or name.

## Local dev server (optional, for iterating on the Worker itself)

```bash
npx wrangler dev
```

Runs the Worker locally with simulated Durable Object bindings, so you can
`curl` it directly while making changes.

Staging and production use different Durable Object namespaces, so their room
data cannot mix.

## Redeploying and rollback

Bump nothing on the app side — deployment keeps the same production URL. The
GitHub workflow deploys staging, checks `/health`, and only then deploys
production.

```bash
npm run deploy
```

After the initial Durable Object lifecycle deployment, roll back a later Worker
version with:

```bash
npx wrangler rollback --env production
```

The first deployment that creates the Durable Object namespaces is a lifecycle
change and cannot be rolled back across that boundary. Validate that deployment
on staging before allowing the production job to proceed.

## Passwordless accounts

The Worker provides optional magic-link accounts and versioned cloud snapshots
through D1. Anonymous and offline use remains available.

- D1 binding: `ACCOUNTS_DB` (configured in `wrangler.jsonc`)
- Worker secret: `RESEND_API_KEY` in staging and production
- Sender: `Poängbogey <login@golf.brosenius.se>`
- Link destination: `APP_BASE_URL`

Apply migrations before deploying a version that uses the account routes:

```bash
npx wrangler d1 migrations apply ACCOUNTS_DB --env staging --remote
npx wrangler d1 migrations apply ACCOUNTS_DB --env production --remote
```

Verify `golf.brosenius.se` in Resend before enabling login emails. Keep the
Resend API key in Worker secrets; never commit it or expose it to the browser.
