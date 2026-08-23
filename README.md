# pixl-down-notifier

Watches `pixl.hackclub.com` (and its subpages) every 5 minutes from GitHub Actions.
When any page returns a 404/403/5xx, times out, or fails DNS/TLS, you get an
urgent push notification on your phone via [ntfy](https://ntfy.sh) — plus a
recovery ping with how long it was down. Alerts only fire on state changes, so
no spam while a page stays down.

Monitored pages: `/`, `/play`, `/explore`, `/shop`, `/docs`, `/ideas`
(edit `PAGES` in `monitor.ts`).

## Setup

1. Pick an unguessable topic name — it is the password, e.g.
   `pixl-down-k7f3xq92m1`.
2. Install the ntfy app ([Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
   / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347)) and subscribe to
   that topic (Add subscription -> enter topic name).
3. Add the topic as the `NTFY_TOPIC` repository secret
   (Settings -> Secrets and variables -> Actions).
4. Done. The workflow runs every 5 minutes; run it manually anytime via
   Actions -> Uptime monitor -> Run workflow.

## How it works

- `monitor.ts` GETs each page with a 10s timeout, following redirects.
- Down = final HTTP status >= 400, timeout, DNS failure, TLS error.
- `state.json` remembers what was down so alerts only fire on transitions and
  recovery messages can include the downtime duration. The workflow commits it
  back when it changes.
- If ntfy publish fails, state is not updated, so the alert retries next run.

## Local testing

```bash
cp .env.example .env        # put your topic in it
bun monitor.ts              # normal run against production

PIXL_BASE_URL=https://this-domain-does-not-exist.test bun monitor.ts   # drill: everything down
```

Bun auto-loads `.env`. You can also poll your topic's recent messages without
the app: `curl https://ntfy.sh/<topic>/json?poll=1`.

## Caveats

- GitHub scheduled workflows are auto-disabled after ~60 days without any
  commits to the repo — push anything to re-enable them.
- Actions cron can drift by a few minutes; that is normal.
- ntfy push is instant but is not literally SMS. To also get SMS later, add a
  Twilio API call in `notify()`.
