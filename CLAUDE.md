# gacoka.com — Personal Dashboard

## What This Is

Personal dashboard at gacoka.com. Planned features:
- Training metrics visualization (Garmin / Strava integration)
- Flight log
- Personal to-do

## Stack

- `public/` — static HTML/CSS frontend served by nginx
- `api/` — Node.js 20 + Fastify backend, runs on port 3000 via PM2
- Served by nginx on VPS at 89.116.157.98 (nginx proxies `/api/` and `/auth/` to port 3000)
- Deployed via GitHub Actions on merge to `main`

## Deploy Path

```
public/        ← web root (nginx serves this)
api/           ← Fastify API (PM2 process: dashboard-api)
```

On deploy: both `public/` and `api/` are archived, shipped to VPS, unpacked to `/var/www/app/releases/<sha>`, npm deps installed, symlinked to `/var/www/app/current`, PM2 restarted, nginx reloaded.

Persistent files on VPS (not in releases):
- `/var/www/app/.env` — env vars (STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, etc.)
- `/var/www/app/tokens.json` — Strava OAuth tokens (written by /auth/strava/callback)

## Branch Rules

- `main` → auto-deploys to gacoka.com
- `develop` → integration (no auto-deploy)
- `feature/*`, `fix/*` → PR to develop

## Commit Convention

`feat:`, `fix:`, `chore:`, `docs:` — see cicd-framework for full convention.
