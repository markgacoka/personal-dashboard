# Flight planner (PRD)

Replaces the single-airport **Airport brief** (`/flying/weather`) with a VFR
flight planner at `/flying/plan`. The old route redirects to it.

## Problem

Planning a NICE AIR flight today means a 100-page 1800wxbrief PDF, a paper
NavLog (NICE AIR NavLog v2.0 / Jeppesen VFR NavLog), a W&B worksheet from the
POH, the Chart Supplement, a sectional, and a personal-minimums card. The facts
are connected — the TAF at the ETA sets the density altitude, which sets the
takeoff distance, which depends on the weight, which depends on the fuel the
navlog says is needed — but on paper each is worked separately and the
go/no-go decision is never written down.

## The seven questions

The page reads top to bottom as seven questions. Each section shows its answer
in one line and a status (OK / caution / no-go / incomplete). The decision at
the bottom collects every check with a link back to where it came from.

| # | Question | Section | Answers it with |
|---|---|---|---|
| 1 | Where am I going? | Trip | Route (departure, stops, destination), alternate, departure time, cruise altitude; the map; each airport's characteristics |
| 2 | Am I okay to go? | Pilot | IMSAFE, PAVE, §61.56/§61.57 currency from the logbook, personal minimums |
| 3 | What am I going with? | Aircraft | Tail number → registry, photo, POH used, V-speeds, limitations, equipment, AV1ATES inspections, ATOMATOFLAMES/FLAPS, POH checklists by phase |
| 4 | Can it carry the load? | Weight & balance | Stations from the POH, empty weight per tail, CG envelope with takeoff and landing points |
| 5 | Can it get off and back on the ground? | Performance | POH takeoff/landing distances at each airport for the forecast temperature, pressure altitude, weight and wind; runway margins; crosswind |
| 6 | How do I get there? | Navlog | Legs, TC/WCA/TH/MH, winds aloft used, TAS/GS, ETE/ETA, fuel; frequencies; airspace and terrain on the route; hemispheric altitude; flight plan |
| 7 | Is it safe there and back? | Weather & risks | METAR/TAF at ETA per airport, ATIS, PIREPs, SIGMET/G-AIRMET/CWA on the corridor, TFRs, NOTAMs, ATC delays, winds aloft, freezing level, daylight |
| — | Go or no-go? | Decision | Every check, grouped by question, with the reason |

## Inputs (what the pilot types)

Route (airport IDs, in order), alternate (suggested, overridable), departure
time (local), cruise altitude and RPM, tail number, people and baggage weights
by station, fuel on board, IMSAFE/PAVE answers, personal minimums, the
aircraft's empty weight/moment and inspection dates (saved per tail), equipment.
Everything else is fetched or derived on the page.

## Data sources (free; every block shows when it was fetched or issued)

| Data | Source | Refresh |
|---|---|---|
| Airports: runways (true heading, length, width, surface, lights, LDA, displaced threshold, VGSI, pattern side), TPA, magnetic variation, tower and hours, frequencies, AWOS/ASOS + phone, airspace class, Chart Supplement remarks | FAA NASR 28-day subscription (already imported into `nasr_airports`) | Each AIRAC cycle; cycle date shown |
| METAR, TAF, PIREP, SIGMET (incl. convective), G-AIRMET, CWA, FB winds/temps aloft, area forecast discussion | aviationweather.gov Data API (NOAA/AWC) | Cached 5–15 min server-side |
| NOTAMs | FAA NOTAM Search (existing `/api/external/notam`) | 1 h cache |
| TFRs | tfr.faa.gov list + WFS geometry | 15 min |
| ATC delays / ground stops / closures | FAA NAS Status (nasstatus.faa.gov) | 5 min |
| D-ATIS (towered fields that publish it) | clowd.io D-ATIS mirror of FAA D-ATIS | 2 min; others show ATIS/AWOS frequency + phone |
| Terrain along the route | Open-Meteo elevation (Copernicus DEM 90 m) | Static |
| Airspace, US airports layers | FAA ArcGIS (existing map layers) | Each cycle |
| Registry, photo | FAA registry + photo sources (existing) | On lookup |
| Performance, limitations, W&B, checklists | Cessna 172P POH (1982, scanned copy on file), Figures 2-x, 4-x, 5-3/5-5/5-7/5-8/5-11, 6-5 | Static; figure numbers shown |
| Flight Service | 1-800-WX-BRIEF, 122.2 MHz | Static |

## Aircraft profiles

The fleet is C172M/N/P. The only POH on file with legible tables is the 1982
172P. Profiles are keyed by model; a tail whose model has no profile uses the
closest one and says so in a banner (e.g. "No 172N POH on file — using 1982
172P tables; 172N max gross is 2,300 lb, so weights above that are flagged").
Per-model max weights and CG limits come from TCDS 3A12 where the POH is
missing. Per-tail empty weight/moment start from the POH sample airplane and are
marked "sample" until replaced with the tail's own W&B record.

## Calculations (all client-side, pure functions, unit-tested)

- Pressure altitude = field elevation + (29.92 − altimeter) × 1000; ISA temp;
  density altitude.
- Takeoff/landing: bilinear interpolation in pressure altitude × temperature,
  linear in weight (takeoff sheets at 2400/2200/2000 lb; landing at max weight),
  POH wind correction (−10 % per 9 kt headwind; +10 % per 2 kt tailwind),
  grass correction, ASI +50 % margin; compared to runway length / LDA.
- Wind components per runway end (magnetic heading from true + variation).
- W&B: Σ weight × arm; ramp → takeoff (−7 lb taxi fuel) → landing (− trip fuel);
  envelope polygon test; baggage limits; utility category check.
- Navlog per leg: great-circle distance and initial true course; winds at the
  cruise altitude interpolated from the nearest FB stations and levels; TAS from
  the POH cruise table at the chosen RPM / pressure altitude / temperature
  deviation; wind triangle → WCA, TH, GS; magnetic variation from NASR; climb
  from Fig. 5-7 (time, fuel, distance, +10 % per 10 °C above standard).
- Fuel: taxi 1.1 gal + climb + cruise legs + reserve (§91.151: 30 min day,
  45 min night) vs. usable fuel; personal reserve on top.
- Hemispheric rule (§91.159) on the magnetic course; terrain clearance from the
  highest sampled elevation on each leg.
- Daylight: sunrise/sunset/civil twilight at each airport (night ⇒ FLAPS and
  night currency).
- Freezing level from FB temperatures.

## Decision checks (examples)

No-go: over max weight, CG out of envelope, runway shorter than required
distance, IMSAFE item failed, fuel below legal reserve, TAF/METAR below VFR
minimums or personal minimums at an airport at its ETA, active TFR on the
route, convective SIGMET on the corridor, required inspection overdue, required
currency lapsed for the planned operation.
Caution: crosswind above personal limit but within demonstrated, runway margin
below the +50 % recommendation, MVFR, G-AIRMET IFR/mountain obscuration/icing
on the corridor, PIREP turbulence or icing, ATC delay at an airport, NOTAM
runway/airport closure keyword, sample (unverified) empty weight, closest-model
POH.

## Layout (wizard)

The seven questions are steps 1–7 of a wizard (step bar on top, Back/Next at
the bottom, progress saved in the draft); step 8, Review, shows every step
read-only with Edit links and the go/no-go decision, and is what Print prints.
A reference panel (docked right on wide screens, full-screen on phones) keeps
the POH and the weather briefing open on every step; POH figure links in the
steps jump to the page. POHs and briefings are PDFs in `planner_documents`:
uploaded, or briefings imported from the Leidos Flight Service emails
(DO_NOT_REPLY@afss.com) with "From email".

The navlog has one row per checkpoint: departure, top of climb, airports
within 5 nm of the line (≥ 8 nm apart), top of descent, each stop or fly-over
point — with wind, TAS, TC, WCA, TH, variation, MH, deviation/CH, distance
leg/remaining, GS, ETE, ETA, fuel leg/remaining and terrain, plus actual GS,
ATA and fuel columns to fill in flight. Route entries ending in `*` are flown
over (no landing, no ground time).

### Original layout notes

Header: plan name, route chips, departure time, overall verdict.
Left rail (≥ xl): the seven questions with status, sticky; on smaller screens a
horizontal step strip. Sections stack in order, full width, one surface layer.
The map (route, airspace, airports with flight-category dots, PIREPs, SIGMET /
G-AIRMET / TFR polygons) leads the Trip section and stays in the Weather
section as the risk overlay. Print view gives a NavLog + W&B + weather log sheet
in the shape of the NICE AIR NavLog.

## Persistence

`planner_plans` (named plans, JSON), `planner_aircraft` (per-tail empty weight,
moment, fuel capacity, equipment, inspection dates), `planner_settings`
(personal minimums). Writes only from explicit user edits.

## Out of scope (v1)

IFR planning, filing the flight plan with Leidos (the page produces the form
text to paste), magnetic deviation cards, VOR radials/checkpoint picking along
the line (user can add airports as checkpoints), non-Cessna-172 performance
tables, sectional raster tiles.
