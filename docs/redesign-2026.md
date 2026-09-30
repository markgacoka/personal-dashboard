# Dashboard redesign (2026)

A new frontend for gacoka.com, built from scratch in `web/`. The classic UI in
`public/` stays untouched and reachable at `/classic` until the new one is
approved; `git tag ui-classic-2026-09-30` marks the last commit before this work.

## Scope

Same features, same data, same API. No backend behaviour changes beyond serving
the new bundle. The sign-in page (`/login`) is unchanged.

The new UI never calls data-pulling or initialization endpoints on its own
(FR24/FlightAware/OpenSky track fetches, Plaid sync, NICE AIR sync, Garmin auth).
User-triggered actions that already exist (Plaid Sync, Link account, flight
logging with the OpenSky lookup) remain, behind explicit buttons.

## Stack

Vite + React 19 + TypeScript, Tailwind CSS v4, Radix primitives (shadcn-style
components kept in `web/src/components/ui`), TanStack Query, React Router,
Recharts, MapLibre GL, cmdk (command palette), Sonner (toasts), Vaul (mobile
sheets), Motion, Geist Sans / Geist Mono (bundled, no font CDN).

Built in the Docker image (multi-stage) to `web/dist` and served by Fastify
ahead of `public/`. Assets are hashed under `/assets/`, which never collides
with the classic `/js` and `/css` paths.

## Information architecture

| Route | Replaces | Content |
|---|---|---|
| `/` Today | Overview | Daily brief: readiness, flying conditions, currency alerts, net worth, chess, mail |
| `/training`, `/training/:id` | Activities, detail | Load heatmap, weekly volume, filterable activity table, detail with map + zones + splits |
| `/sleep` | Sleep | Last night, hypnogram, vitals, 30-night trends |
| `/flying` | Logbook | Totals vs. §61.109 minimums, filterable flight table, log/edit flight |
| `/flying/:id` | Flight detail | Map-first view, track playback with altitude/speed profile, aircraft, weather, NICE AIR |
| `/flying/weather` | Airport brief | METAR, wind/runway compass, TAF, NOTAMs for the home airport |
| `/flying/pilot` | Credentials + currency | Certificates, medical, §61.56/§61.57 currency |
| `/money`, `/money/connections` | Finance dashboard, Linked accounts | Net worth trend, allocation, accounts, holdings, retirement goal; Plaid items |
| `/chess` | Chess progress | Rating trend, record, monthly comparison, recent games |
| `/mail/*` | Mail, thread, settings | Three-pane client, composer, settings tabs |
| `/account` | Account | Sessions, two-factor, passkeys |

Old hash links (`/#flight/12`, `/#mail`, …) redirect to the new paths.

## Shell

Collapsible sidebar (desktop), bottom tab bar + sheet (phone), top bar with
breadcrumbs, ⌘K command palette (navigate, jump to a flight/activity, actions),
theme (system/light/dark), and a global privacy toggle that masks balances.

## Design principles

- Full content width with a responsive grid; one surface layer (cards on the page
  plane, hairline borders); no nested tinted containers.
- Numbers in Geist Mono tabular figures; ICAO codes and tail numbers in mono.
- Secondary text ≥ 13px; 12px only for dates/meta in dense rows.
- Charts follow the dataviz method: validated categorical palette, one axis,
  2px lines, ≤24px bars with rounded data ends, hover tooltips, legends for ≥2 series.
- Status (current/expiring/lapsed, GO/CAUTION/NO-GO) always pairs color with icon + label.
- Every data view has loading skeletons, empty states and error states.

## Revert

Delete `web/` wiring in `api/src/app.js` (or set `UI=classic`), and the classic UI
serves from `/` again. Nothing in `public/` changed.
