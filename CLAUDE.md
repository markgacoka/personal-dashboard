# gacoka.com — Personal Dashboard

## What This Is

Personal dashboard at gacoka.com. Planned features:
- Training metrics visualization (Garmin / Strava integration)
- Flight log
- Personal to-do

## Stack

- Static HTML/CSS for now — expanding to a full app soon
- Served by nginx on VPS at 89.116.157.98
- Deployed via GitHub Actions on merge to `main`

## Deploy Path

```
public/        ← web root (nginx serves this)
```

On deploy: `public/` is archived, shipped to VPS, unpacked to `/var/www/app/releases/<sha>`, and symlinked to `/var/www/app/current`. nginx reloads to pick it up.

## Branch Rules

- `main` → auto-deploys to gacoka.com
- `develop` → integration (no auto-deploy)
- `feature/*`, `fix/*` → PR to develop

## Commit Convention

`feat:`, `fix:`, `chore:`, `docs:` — see cicd-framework for full convention.
