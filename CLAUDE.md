# gacoka.com — Personal Dashboard

## What This Is

Personal dashboard at gacoka.com. Planned features:
- Training metrics visualization (Garmin Connect integration)
- Flight log
- Personal to-do

## Stack

- `public/` — static HTML/CSS frontend (served by Fastify)
- `api/` — Node.js 20 + Fastify, port 3000, PM2 process `dashboard-api`
- `traefik/` — Traefik v3 reverse proxy (handles HTTPS, routes all traffic to port 3000)
- VPS at 89.116.157.98, deployed via GitHub Actions on merge to `main`

## Deploy Path

```
public/        ← frontend static files (Fastify serves these)
api/           ← Fastify API + static file server
traefik/       ← Traefik dynamic routing config (deployed each push)
```

On deploy: archive shipped to VPS, unpacked to `/var/www/app/releases/<sha>`,
npm deps installed, symlinked to `/var/www/app/current`, PM2 restarted,
`traefik/dynamic.yml` copied to `/var/www/app/traefik-dynamic.yml` (Traefik
reloads automatically via file watcher).

Persistent files on VPS (not in releases):
- `/var/www/app/.env` — GARMIN_USERNAME, GARMIN_PASSWORD, etc.
- `/var/www/app/acme.json` — Traefik Let's Encrypt certificate store (chmod 600)
- `/var/www/app/traefik-dynamic.yml` — updated each deploy

## Branch Rules

- `main` → auto-deploys to gacoka.com
- `develop` → integration (no auto-deploy)
- `feature/*`, `fix/*` → PR to develop

## Commit Convention

`feat:`, `fix:`, `chore:`, `docs:` — see cicd-framework for full convention.
