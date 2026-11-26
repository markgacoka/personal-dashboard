# gacoka.com — Personal Dashboard

## What This Is

Personal dashboard at gacoka.com: fitness (Garmin), flight logbook with GPS
tracks, finances (Plaid), and chess (chess.com).

## Stack

- `web/` — the dashboard: Vite + React + TypeScript, Tailwind CSS v4, Radix
  primitives (components in `src/components/ui`), TanStack Query, React Router,
  Recharts, MapLibre. Features live in `src/features/<area>`, shared logic in
  `src/lib`. Built inside the Docker image; `cd web && npm run dev` (proxies
  `/api` to `DEV_API`, default http://localhost:3000), `npm test` (Vitest).
  Design notes: `docs/redesign-2026.md`.
- `public/` — only the sign-in page (`login.html`, `css/app.css`,
  `js/login.js`, `js/webauthn.js`) and `favicon.svg`; these are on the auth
  gate's public allowlist.
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

## Flight tracks and NICE AIR auto-logging

Tracks come from free sources only, stitched into one (`services/stitch.js`:
per-source outlier removal, best source per moment, missing speed/track/rate
derived; ground points kept with `on_ground`), each point tagged with its source:
an owner-uploaded GPS file (GPX/KML/CSV, `POST /api/flights/:id/track-file`),
every OpenSky leg the aircraft flew in the window (OpenSky splits a flight at
each landing), adsb.fi and airplanes.live recent traces (about the last 24 h,
snapshots kept in `ads_traces`), plus adsb.lol's daily archive (`services/adsblol.js`; the UTC
day is published ~3–4 h after it ends, streamed and cached in `adsblol_traces`).
`services/autolog.js` runs every 20 min: syncs NICE AIR booking emails, and for
each booking from 2026-10-11 on that has ended, wasn't cancelled, and has ADS-B
evidence, creates an entry with `foreflight_source = 'nice-air-auto'`. The
`nice_air_autolog` ledger stops deleted entries coming back; untouched auto
entries are rebuilt when adsb.lol adds coverage. `POST /api/nice-air/autolog/run`
runs it now; `POST /api/flights/:id/refresh-track` re-collects one track.

## Watch assistant log

The Assistant page (`/assistant`, `web/src/features/assistant/`) shows every request made from the Garmin watch
assistant (repo `markgacoka/watch-assistant`, its own compose project on the `web` network). `api/src/routes/assistant.js`
reads `http://watch-assistant:8000/assistant/v1/log` and `/models` with the read-only `ASSISTANT_LOG_TOKEN` from
`/var/www/app/.env` (`ASSISTANT_URL` overrides the address). Without the token the routes answer 503.

## NICE AIR charges and Hobbs

`services/niceAirPortal.js` signs in to NICE AIR's Paperless141 portal
(niceair.paperlessfbo.com; no API, so ASP.NET form postbacks) with
`NICE_AIR_USERNAME` / `NICE_AIR_PASSWORD` from `.env`, turns paging off and
downloads the two Excel exports: My Flights (aircraft charge, Hobbs meter) and
the account statement. They're mirrored into `nice_air_meter` and
`nice_air_charges` (an export with fewer rows than stored is refused) and linked
to logbook entries by date, tail and duration. A flight's cost (`cost` on
`GET /api/flights/:id`) is the aircraft charge plus that day's flight and
pre/post-ground instruction; headset rental is listed but not counted, and
ground lessons on days without a flight stay unlinked. The meter row is the
logged time: a linked flight takes its Hobbs readings and hours as its total
(all-dual/solo/PIC/XC columns follow; night/instrument are capped), re-checked
every scheduler tick; NICE AIR has no tach data.
It runs every 12 h, and hourly while a logbook flight in a booking from the
last 3 days has no charge yet. `GET /api/nice-air/portal` shows its state;
`POST /api/nice-air/portal/sync` runs it now.

## Flight planner

`/flying/plan` (spec: `docs/flight-planner.md`). Calculations are pure and
client-side (`web/src/features/planner/calc.ts`, `model.ts`'s `derive()`), with
172P POH tables transcribed in `poh.ts` (figure numbers kept). The API side
(`routes/planner.js`) serves NASR airport records, a weather/risk bundle from
aviationweather.gov, FAA NAS status and tfr.faa.gov (`services/awc.js`,
`services/faaStatus.js`, cached in memory), D-ATIS, terrain, and the saved
`planner_plans` / `planner_aircraft` / `planner_settings` tables. Route tokens
(airports, navaids, fixes, VFR waypoints, radial/DME, coordinates) resolve via
`services/waypoints.js` against `nasr_points` (NASR NAV_BASE/FIX_BASE, loaded
with the airports each cycle). `services/pohCatalog.js` matches a tail's
make/model/year to a public POH PDF and stores it in `planner_documents` on
first use, unless you uploaded a POH for that tail (or model), which wins. A model
the catalog lacks is looked up in Sprinkle's public manual library
(`services/pohFinder.js`; kept only if the book's first pages name the model), and
every POH's page map comes from its headings (`services/pohPages.js`, OCR in the
background for scans). For a model without a hand-transcribed profile, the
takeoff, landing, climb and cruise tables and their wind/grass notes are read
from the book's text layer (`services/pohTables.js`, stored versioned in
`planner_documents.tables`) and replace the 172P's (`poh.ts` `withTables`);
whatever can't be read stays the 172P's and is named. Every POH's spec sheet (engine, propeller,
oil, fuel system, gear and tires, brakes, electrical, airspeed markings and
limits, normal speeds, stall speeds, load factors, published performance) is
read from its text (`services/pohSpecs.js`, Cessna and Piper wording, OCR for
scans in the background; stored versioned in `planner_documents.specs`) and its
speeds, tanks, oil and crosswind feed the profile (`poh.ts` `withSpecs`); the FAA registry adds registration and airworthiness dates
(`faa-registry.js` `registrationOf`). Pilot records (certificates, medical, ID,
endorsements, logbook) and per-tail aircraft records (airworthiness,
registration, radio licence, W&B, equipment list, airframe and engine logs) are
`planner_documents` kinds (`records.ts`, `RecordsList.tsx`); a pilot record carries the pilot profile's id (`person_id`, NULL for the self pilot). Per-tail
aircraft profiles (`planner_aircraft.data.profile`, applied by `poh.ts`'s
`applyEdits`) and airport profiles (`planner_airport_profiles`) override the
POH/NASR values. Your certificates (`planner_settings` key `certificates`) and the flight's role (PIC or dual, `plan.crew`) drive the Part 61 checks in `pilot.ts`. Checklist uploads (PDF or photo) are read into steps (`services/docText.js`: poppler / Tesseract in the image; `checklistParse.ts`). Profiles (`/flying/plan/profiles`; `profiles.ts`): you (settings `pilot`, `certificates`, `minimums`), people (settings `people`: instructors and passengers with weights, picked per seat), aircraft (`planner_aircraft`) and airports (`planner_airport_profiles`), each with its own create/read/update/delete. Aircraft profiles also hold the airplane's own checklist (`AircraftChecklist.tsx`). Layout and rules (flight file sections, work sheet, profile creation at the step that needs it, status vocabulary, edge cases): `docs/planner-ux.md`. A new flight asks where and when, the aircraft and who's flying; then sections Summary, Pilot, Aircraft, Airports, Route and fuel, and the outputs NavLog, Weight and balance, Weather briefing (`PlannerPage.tsx`, `Sections.tsx`), data in `useFlight.ts`, what's still open in `readiness.ts`; any underlined figure opens the work sheet (`WorkSheet.tsx`) with its workings, sources and assumptions. Inputs: (tail, departure / route / arrival — one
flight, middle points always flown over — engine start, RPM, seats, fuel, taxi time). All derived, with the
checklists (IMSAFE, maintenance, equipment) stored in the plan — per-flight automatic altitude,
automatic checkpoints (airports, VFR waypoints, VORs, RNAV fixes from NASR), automatic alternate,
WMM magnetic variation (`magvar`; NASR values are decades old), and model
winds aloft (`services/modelWinds.js`, Open-Meteo HRRR/GFS on a grid over the
route; the NWS FB ended 2026-11-03), with your briefing winds per flight as the
manual backup. Every NavLog row and W&B line can be selected to show its
workings, source tier and expected range (`explain.ts`; method in
`docs/navlog-method.md`). The route chart
suggests points and lets you drag the line (`suggest.ts`, `services/landmarks.js`:
OpenFreeMap/OSM, HIFLD power lines, FAA obstacles).

## Portfolio

`/portfolio` (signed in, like the rest): the products I've built. Each product
is one entry in `web/src/features/portfolio/products.ts` (status, summary,
gallery, features, facts, links and a `metrics` list); images live beside it
in `assets/`. The page shows a totals strip once there are two or more
products, a sideways carousel of product cards, and the selected product
(`?p=<id>`) with its metrics. A metric with `value: null` reads "Not tracked
yet"; `series` draws a trend line; live sources can be merged in by `key`.

## Mail

`#mail` is a mail client for hello@gacoka.com backed by a self-hosted
Stalwart server (compose service `stalwart`; JMAP at http://stalwart:8080 on
the docker network) with outgoing mail relayed through Resend. Setup, env
vars, DNS and maintenance: `docs/mail.md`. Server setup and repair:

    docker exec current-api-1 node src/cli/mail.mjs bootstrap|configure|dns|set-password

## Tests

`cd web && npm test` runs the frontend unit tests (Vitest; also part of `npm run build`).
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
