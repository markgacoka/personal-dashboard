# gacoka.com — Personal Dashboard

## What This Is

Personal dashboard at gacoka.com: fitness (Garmin), flight logbook with GPS
tracks, finances (Plaid), and chess (chess.com).

## Stack

- `public/` — static frontend, no build step. `index.html` is the markup;
  `css/app.css` the styles; `js/*.js` are classic scripts loaded in order and
  sharing one global scope (inline `onclick` handlers call their functions).
  Load order matters: top-level code may only use what earlier files define.
  `js/helpers.js` holds DOM-free helpers the API test suite runs directly.
- `api/` — Node.js 20 + Fastify, containerised
  - `src/routes/` — HTTP endpoints by area (flights, tracks, aircraft, aviation, …)
  - `src/services/` — external integrations and domain logic (OpenSky, FR24 /
    FlightAware track backfill, NICE AIR schedule matching, Garmin, Plaid, …)
  - `src/lib/` — small shared helpers (HTTP fetch with timeout, CSV parsing)
  - `src/db/migrate.js` — migrations; each runs once, recorded in `schema_migrations`
- PostgreSQL 16 (compose service `postgres`)
- `traefik/` — Traefik v3 static config (HTTPS + Docker routing)
- VPS at 89.116.157.98, deployed via GitHub Actions on push to `main`

## Authentication

Every page, file, and API route requires a signed-in session except `/login`,
its assets, `/health`, `/api/health`, and Better Auth's own `/api/auth/*`
(see `api/src/routes/authGate.js`; `api/src/auth.js` holds the config). One
owner account. The password is always required; with two-factor on (Account
view), sign-in then asks for a second step: Touch ID (a passkey added from the
Account view; `api/src/lib/passkeySecondFactor.js`), a code emailed to the
account address (sent through the mail server), the authenticator app, or a
backup code. Passkeys never replace the password: the passkey plugin's own
sign-in endpoints are disabled. Public sign-up is disabled; the account is managed
on the server:

    docker exec -it current-api-1 node src/cli/account.mjs create        # first time
    docker exec -it current-api-1 node src/cli/account.mjs set-password  # reset
    docker exec -it current-api-1 node src/cli/account.mjs disable-2fa   # lost authenticator
    docker exec -it current-api-1 node src/cli/account.mjs sign-out-all

Requires `BETTER_AUTH_SECRET` (32+ characters) in `/var/www/app/.env`; the API
refuses to start in production without it. `BETTER_AUTH_URL` defaults to
https://gacoka.com. Writes must come from the site's own Origin (CSRF defence).

## Mail

`#mail` is a mail client for hello@gacoka.com backed by a self-hosted
Stalwart server (compose service `stalwart`; JMAP at http://stalwart:8080 on
the docker network) with outgoing mail relayed through Resend. Setup, env
vars, DNS and maintenance: `docs/mail.md`. Server setup and repair:

    docker exec current-api-1 node src/cli/mail.mjs bootstrap|configure|dns|set-password

## Tests

`cd api && npm test` runs unit tests, signed-out security checks against
gacoka.com (`SKIP_SMOKE=1` to skip, `SMOKE_BASE=<url>` for another deployment),
signed-in smoke tests when `SMOKE_COOKIE` holds a session token, and DB
integration tests (including every-route auth coverage) when `DATABASE_URL` is set. Never point the DB integration
tests at the production database: they write (and then delete) a test flight.

## Deploy Path

On push to `main`: source is archived, shipped to VPS, unpacked to
`/var/www/app/releases/<sha>`, symlinked to `/var/www/app/current`,
then `docker compose up -d --build` rebuilds and restarts the api container.
Traefik container stays running across deploys (only restarts if its config changes).

Persistent files on VPS (outside releases, never in git):
- `/var/www/app/.env` — BETTER_AUTH_SECRET, GARMIN_USERNAME, GARMIN_PASSWORD, etc.
- `/var/www/app/acme.json` — Traefik Let's Encrypt store (chmod 600)
- `/var/www/app/garmin-session.json` — Garmin OAuth session cache
- `/var/www/app/mail/` — Stalwart config and mail store (owned by UID 2000; back this up)

## Branch Rules

- `main` → auto-deploys to gacoka.com
- `develop` → integration (no auto-deploy)
- `feature/*`, `fix/*` → PR to develop

## Commit Convention

`feat:`, `fix:`, `chore:`, `docs:` prefixes are the documented convention; recent history uses plain imperative subjects.
