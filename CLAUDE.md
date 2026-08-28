# gacoka.com — Personal Dashboard

## What This Is

Personal dashboard at gacoka.com. Planned features:
- Training metrics visualization (Garmin Connect integration)
- Flight log
- Personal to-do

## Stack

- `public/` — static HTML/CSS frontend (served by the Fastify container)
- `api/` — Node.js 20 + Fastify, containerised
- `traefik/` — Traefik v3 static config (HTTPS + Docker routing)
- `docker-compose.yml` — two services: traefik + api
- VPS at 89.116.157.98, deployed via GitHub Actions on merge to `main`

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
