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

## Wizard: one input step, then everything derived

Step 1 asks for what only the pilot knows. Every later step shows what was
looked up or computed for that flight, with its source, and takes an override
only where one makes sense. A step chip shows its worst check.

| Step | Shows | Inputs / overrides |
|---|---|---|
| 1 Flight | Registry match, POH match, route tokens resolved | Plan name (blank: named after the route on save); tail; departure, route (points flown over) and arrival — one flight, one navlog, so an airport in the route is flown over, never a stop; engine start (local), cruise RPM, seats and baggage areas 1–2, fuel (blank = full usable), start and taxi minutes (10) |
| 2 Aircraft | FAA registry (make, model, year, engine, serial, Mode S, owner, status), POH V-speeds and limits, Performance (POH) page with climb and cruise at each flight's altitude | Tail's empty weight and moment, tanks, inspection dates; the aircraft profile (make, model, year, engine, max weights, fuel, arms, V-speeds, crosswind, cruise TAS/GPH over the POH table), all saved per tail; upload the tail's POH and checklist PDFs (the newest upload is the one used, ahead of the catalog POH); maintenance/documents and §91.205 equipment checklists |
| 3 Route | The route as chips; the chart with suggested points; per leg the points you could fly over within 5 nm (NASR airports, VFR waypoints, VORs, fixes; towns, peaks, lakes, towers ≥ 200 ft AGL) and where the line crosses highways, rivers, railroads and power lines; cruise altitude and its reason; every navlog point (TOC, automatic checkpoints, TOD) with position, MC, altitude, leg distance, terrain; airspace and TFRs on the line | Add a suggested point (it goes into the step-1 route); name any point flown over (route chip or map popup; the name is the navlog checkpoint); drag the line to add a point, drag a point to move it, click it to remove it (drops snap to a nearby point, or onto a highway/river/railroad/power line, else a coordinate); altitude; drop an automatic checkpoint |
| 4 Airports | Per airport: runways (length × width, surface, pattern side, head/cross wind at ETA), the favored runway (or the D-ATIS runways in use), elevation, TPA, AWOS/ASOS and phone, FSS, sun, density altitude, frequencies, NOTAMs that affect VFR, Chart Supplement remarks; alternate | Alternate (automatic: nearest suitable airport within 40 nm of the destination, off the route, not reporting IFR); airport profile per field: pattern altitude, pattern side per runway end, notes (on the NavLog), saved for every plan |
| 5 Weather | METAR/TAF at each ETA, hazards (SIGMET, G-AIRMET, CWA, PIREP, TFR, NAS status), winds aloft, NOTAMs, map | — |
| 6 Weight & performance | W&B sheet from ramp to each landing; takeoff and landing distances | — |
| 7 Pilot | IMSAFE checklist; personal minimums held against the worst value at any ETA (ceiling, visibility, wind, gust, crosswind, runway length/width, fuel at landing, night); currency from the logbook | Minimums |
| 8 Review | Go / no-go with every check grouped by step | — |
| 9 NavLog | The sheet per flight and the reverse, print | E6B cells (wind, temperature, CAS), actuals |

Checklist answers live in the plan (`plan.checklist`: `imsafe.*`, `mx.*`,
`eq.*`); unanswered is "to do", a failed item is a no-go.

Automatic checkpoints, on legs over 20 nm: airports and VFR waypoints within
5 nm of the line, VORs within 4 nm, five-letter RNAV fixes within 2 nm (NASR
`nasr_points`), visual points first, at least 8 nm apart and clear of the climb
and descent. Your own points go in the route text.

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
| FB winds/temps aloft, second source | The same FBUS bulletin from api.weather.gov (FD1/FD2/FD3 = 6/12/24 h), used when issued within 9 h | 15 min |
| Winds/temps aloft when no FB forecast is published (AWC windtemp answering 204 and FBUS31 not issued since 2026-11-03 08Z) | Open-Meteo forecast API, pressure levels (NOAA HRRR/GFS), sampled at the AWC FB stations around the route (every one within 1° of the route box, at least the nearest four) at the FB levels 3,000/6,000/9,000/12,000 ft; flagged as model winds. The navlog interpolates these stations exactly as it would an FB | 30 min |
| Route landmarks | OpenFreeMap vector tiles (OpenStreetMap, zoom 10: towns, peaks, lakes, motorways/trunk roads with route numbers, rivers, railroads), HIFLD transmission lines ≥ 115 kV, FAA Digital Obstacle File (≥ 200 ft AGL); `GET /api/planner/landmarks` | 1–7 days in memory |
| Magnetic variation | World Magnetic Model 2025 (`magvar` package) | Static model, date-dependent |
| NOTAMs | FAA NOTAM Search (existing `/api/external/notam`) | 1 h cache |
| TFRs | tfr.faa.gov list + WFS geometry | 15 min |
| ATC delays / ground stops / closures | FAA NAS Status (nasstatus.faa.gov) | 5 min |
| D-ATIS (towered fields that publish it) | clowd.io D-ATIS mirror of FAA D-ATIS | 2 min; others show ATIS/AWOS frequency + phone |
| Terrain along the route | Open-Meteo elevation (Copernicus DEM 90 m) | Static |
| Airspace, US airports layers | FAA ArcGIS (existing map layers); the planner asks `/api/planner/airspace` for the polygons around the route only (the nationwide layer is ~90 MB) | Each cycle |
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

A NavLog front per flight follows the hand-filled sheet:
departure and destination with TPA, "Terrain @ … MSL", cruise altitude and
power, the notes lines, the navlog (departure, TOC, route points, automatic
checkpoints, TOD, landing) and the airport advisories and
frequencies panel. Time off is engine start plus start and taxi time. Times are 24-hour local HHMM, ETE in decimal minutes, fuel
to 0.01 gal. Print gives the sheets, POH page, W&B and weather in landscape.

Map: a base chart picker (FAA sectional, terminal area chart over the sectional, IFR enroute low, Esri satellite, Esri topographic, street; remembered per browser), NEXRAD radar (Iowa Environmental Mesonet),
METARs, PIREPs, SIGMET/G-AIRMET, CWA, TFRs, NOTAM counts, airspace, the route.

E6B: per row, TAS = CAS ÷ √σ (density ratio from pressure altitude and OAT,
as E6BX), WCA = asin(Vw·sin(W−TC)/TAS), GS = TAS·cos WCA − Vw·cos(W−TC),
MH = TH − east variation, CH = MH ± deviation, ETE = dist/GS, fuel = ETE × GPH;
climb rows use the POH climb table, descent is 500 fpm at cruise power to TPA.

The reference panel keeps the POH and briefings open; POH figure links jump to
the page.

Phones and tablets: the step chips scroll sideways and keep the current step in
view; header actions shorten on phones; the saved-plans list sits beside the
wizard from 1280 px (a dropdown below); map chart and layer buttons fold behind
one button when the map is narrower than 576 px; wide tables drop or fold
secondary columns on phones (takeoff and landing become cards); the NavLog
sheet stays paper-size and scrolls sideways.

## Persistence

`planner_plans` (named plans, JSON), `planner_aircraft` (per-tail empty weight,
moment, tanks, equipment, inspection dates, and `profile`: your values over the
POH/TCDS/registry ones), `planner_airport_profiles` (per airport: pattern
altitude MSL, pattern sides, notes), `planner_documents` (POH, checklist and
briefing PDFs; uploads carry the tail), `planner_settings` (personal minimums).
Writes only from explicit user edits.

## Out of scope (v1)

IFR planning, filing the flight plan with Leidos (the page produces the form
text to paste), magnetic deviation cards, VOR radials/checkpoint picking along
the line (user can add airports as checkpoints), non-Cessna-172 performance
tables, sectional raster tiles.
