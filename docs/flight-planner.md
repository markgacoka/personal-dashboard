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

## One page, five inputs

The page asks for what only the pilot knows and derives the rest from the
sources a hand-made plan uses (POH, FAA NASR / Chart Supplement, aviationweather.gov,
FAA NOTAMs and TFRs). Below the inputs, in order: the go/no-go summary, one
NavLog front per flight (takeoff to landing), Performance (POH), weight and
balance, the weather brief with the chart, takeoff and landing distances, and
the NavLog reverse (weather log, flight plan).

## Inputs

| Input | Notes |
|---|---|
| Tail number (free text, any country) | Registry → make/model/year (typed only when the registry has none); prefix → units (lb/kg, gal/L, inHg/hPa); make/model → POH |
| Airports and route points | SkyVector/ForeFlight tokens: airports, navaids, fixes, VFR waypoints, radial/DME (SJC090020), coordinates (3651N12132W, 36.85/-121.53). Airports are stops; `*` (or the Fly over chip) flies over one |
| Departure (local) | |
| Cruise power (RPM) | From the POH cruise table |
| Occupants and baggage | Pilot, front, rear left, rear right, baggage area 1 |

Automatic values, shown with their reason and changeable in one panel: cruise
altitude per flight (lowest VFR cruising altitude for the magnetic course, at
least 3,500 ft and 1,000 ft above the highest terrain on the line; short hops
stay below 3,000 ft AGL), fuel on board (full usable), ground time per stop
(30 min), alternate (none), baggage area 2, the tail's empty weight and moment
(POH sample airplane until entered), personal minimums.

In the sheet (optional): per-row wind, temperature and CAS (E6B style, replace
the forecast for that row), compass deviation, actual times, GS and fuel, block
times, flight plan block 14 and aircraft color.

Derived: POH (catalog of public PDFs, downloaded once into `planner_documents`),
limits, arms, CG range, takeoff/climb/cruise/landing from the POH tables, TC and
distance, magnetic variation (World Magnetic Model 2025 on the flight date —
NASR's per-airport values keep their survey epoch, e.g. Reid-Hillview 1975),
winds and temperatures aloft, WCA/TH/MH/GS/ETE/ETA/fuel per row with TOC and TOD,
TPA per airport, highest terrain per flight, frequencies (ATIS, ground, tower,
departure/approach, CTAF, FSS, UNICOM, field elevation), briefing notes (TFR,
SIGMET, CWA, turbulence, G-AIRMET Sierra/Tango/Zulu, convective SIGMET, freezing
level, NOTAM highlights for both airports), the W&B sheet line by line (ramp,
run-up fuel, takeoff, flight burn, landing for each flight).

## Data sources (free; every block shows when it was fetched or issued)

| Data | Source | Refresh |
|---|---|---|
| Airports: runways (true heading, length, width, surface, lights, LDA, displaced threshold, VGSI, pattern side), TPA, magnetic variation, tower and hours, frequencies, AWOS/ASOS + phone, airspace class, Chart Supplement remarks | FAA NASR 28-day subscription (already imported into `nasr_airports`) | Each AIRAC cycle; cycle date shown |
| METAR, TAF, PIREP, SIGMET (incl. convective), G-AIRMET, CWA, FB winds/temps aloft, area forecast discussion | aviationweather.gov Data API (NOAA/AWC) | Cached 5–15 min server-side |
| Winds/temps aloft when no FB forecast is published (AWC windtemp answering 204 since Nov 2026) | Open-Meteo forecast API, pressure levels (NOAA HRRR/GFS), interpolated to 2,000–12,000 ft on a 3×3 grid over the route; flagged as model winds | 30 min |
| Magnetic variation | World Magnetic Model 2025 (`magvar` package) | Static model, date-dependent |
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

## Layout

Single page, no steps. A NavLog front per flight follows the hand-filled sheet:
departure and destination with TPA, "Terrain @ … MSL", cruise altitude and
power, the notes lines, the navlog (departure, TOC, route points, airports
within 5 nm on legs over 20 nm, TOD, landing) and the airport advisories and
frequencies panel. Times are 24-hour local HHMM, ETE in decimal minutes, fuel
to 0.01 gal. Print gives the sheets, POH page, W&B and weather in landscape.

Map: FAA VFR sectional tiles, NEXRAD radar (Iowa Environmental Mesonet),
METARs, PIREPs, SIGMET/G-AIRMET, CWA, TFRs, NOTAM counts, airspace, the route.

E6B: per row, TAS = CAS ÷ √σ (density ratio from pressure altitude and OAT,
as E6BX), WCA = asin(Vw·sin(W−TC)/TAS), GS = TAS·cos WCA − Vw·cos(W−TC),
MH = TH − east variation, CH = MH ± deviation, ETE = dist/GS, fuel = ETE × GPH;
climb rows use the POH climb table, descent is 500 fpm at cruise power to TPA.

The reference panel keeps the POH and briefings open; POH figure links jump to
the page.

## Persistence

`planner_plans` (named plans, JSON), `planner_aircraft` (per-tail empty weight,
moment, fuel capacity, equipment, inspection dates), `planner_settings`
(personal minimums). Writes only from explicit user edits.

## Out of scope (v1)

IFR planning, filing the flight plan with Leidos (the page produces the form
text to paste), magnetic deviation cards, VOR radials/checkpoint picking along
the line (user can add airports as checkpoints), non-Cessna-172 performance
tables, sectional raster tiles.
