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

## Tests

`cd api && npm test` runs unit tests, smoke tests against gacoka.com
(`SKIP_SMOKE=1` to skip, `SMOKE_BASE=<url>` for another deployment), and DB
integration tests when `DATABASE_URL` is set. Never point the DB integration
tests at the production database: they write (and then delete) a test flight.

## Deploy Path

On push to `main`: source is archived, shipped to VPS, unpacked to
`/var/www/app/releases/<sha>`, symlinked to `/var/www/app/current`,
then `docker compose up -d --build` rebuilds and restarts the api container.
Traefik container stays running across deploys (only restarts if its config changes).

Persistent files on VPS (outside releases, never in git):
- `/var/www/app/.env` — GARMIN_USERNAME, GARMIN_PASSWORD, etc.
- `/var/www/app/acme.json` — Traefik Let's Encrypt store (chmod 600)
- `/var/www/app/garmin-session.json` — Garmin OAuth session cache

## Branch Rules

- `main` → auto-deploys to gacoka.com
- `develop` → integration (no auto-deploy)
- `feature/*`, `fix/*` → PR to develop

## Commit Convention

`feat:`, `fix:`, `chore:`, `docs:` — see cicd-framework for full convention.
