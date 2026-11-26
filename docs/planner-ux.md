# Flight planner UX

How the planner at `/flying/plan` is organised and why. `flight-planner.md`
covers what it calculates.

## Summary, profiles in modals, runway diagram (current)

- **Summary** (was Overview) is tiles, not text: route, fuel as one bar
  (taxi, trip, reserve, extra against usable), takeoff weight against the
  maximum and the CG between the envelope's limits at that weight, a runway
  diagram for the departure and the arrival, and each airport's flight
  category and wind. Then "To resolve" (titles only, each linking to its
  section) and the suggestions folded behind one line. The verdict chip in the
  header is hidden on the Summary, which states it once.
- **Profiles are added and edited in modals** (`ProfileForms.tsx`
  `PersonDialog`, `AircraftDialog`; airport profiles in `Pickers.tsx`
  `RouteAirportProfiles`). Every profile tile on the new-flight screen and in
  Pilot and Aircraft has edit and delete; delete asks in a confirm dialog and
  says how many saved flights use it (`profiles.ts` `usedBy`). The self pilot
  can't be deleted; a logbook tail without a profile has nothing to delete.
- **Documents belong to a profile**: a pilot record (certificate, medical, ID,
  endorsements, logbook) is uploaded to that pilot's profile
  (`planner_documents.person_id`; records from before profiles belong to the
  self pilot), an aircraft record or checklist to its tail.
- **Runway diagram** (`RunwayDiagram.tsx`): the runways to scale, true north
  up, from the NASR runway-end coordinates (the Chart Supplement's data), the
  runway in use (D-ATIS, else the favored one) in the accent colour with its
  direction of travel and its traffic pattern on the published or profiled
  side, and wind streaks drifting with the wind. Headwind and crosswind beside
  it. Motion stops for reduced motion and print.
- **NavLog shows only the log.** No inline workings. Each computed column
  carries a numbered mark (1 course, 2 wind, 3 TAS, 4 heading, 5 time, 6 fuel)
  matching a source key under the sheet: the APIs (with fetch time) and POH
  figures each column used, across all rows. Any figure opens that row's
  workings in the side sheet and highlights the row; figures have no underline
  on the sheet, only a hover. The key prints with the sheet on one page.
- **Less text**: section and panel subtitles and input-group hints are gone;
  task rows inside a section show titles only.

## Summary

Top to bottom: the verdict (No-go as planned, Go with caution, Brief
incomplete, Ready to fly) with what's left to resolve; the route, fuel and
weight and balance tiles; then the route map (`RouteOverview.tsx`). The map
fits the departure, points flown over, arrival and alternate in view. Each leg
shows its magnetic course and altitude; TOC and TOD are marked; each airport
shows its flight category and surface wind. The runway in use is drawn with
the departure climb-out and, at the arrival, the recommended pattern entry
(AIM 4-3-3: a 45° entry to downwind from the pattern side, a midfield crossing
500 ft above pattern altitude from the other side; towered fields defer to
ATC). Both come from `procedures.ts`, built on the pattern trainer's geometry
(`features/pattern/geo.ts`): the arrival entry follows the direction you come
from (previous waypoint), and the departure follows the course to the next
waypoint: straight out (within 35° of the runway), a 45° turn-out toward the
pattern side, straight out past the pattern then turning (course on the other
side), or a downwind departure (course behind). The en-route line runs from
the departure's exit to the arrival's entry point; TOC is placed by walking
the climb distance from the runway along the departure path, TOD by walking
the descent distance back from the entry point. Markers are native MapLibre
markers, so they move with the map without lag. In light wind (4 kt or
less) the runway in use is the Chart Supplement's calm-wind runway, or the
longest when calm. Hovering or tapping an airport shows its weather at the
departure or arrival time, the runway in use with a to-scale diagram, wind
components, pattern side and altitude, distances and frequencies; a leg shows
its courses, heading, altitude, wind aloft, distance, ground speed, time, fuel
and terrain.

## Maps

- Summary: a plain route map (above).
- Route and fuel: every chart and layer; TFRs, NOTAMs, PIREPs and landmarks
  start on. Route points are numbered pins drawn as images (the number is
  centred); NOTAMs are amber squares with their count.
- Weather briefing: a plain dark map, taller, with only weather layers, all
  on: radar (NWS NEXRAD), METAR flight categories, winds, PIREPs, SIGMETs and
  G-AIRMETs, CWAs (aviationweather.gov) and TFRs (tfr.faa.gov), plus the
  route, its points and the alternate.
- Weather at a time in the future: within an hour of now, the latest METAR;
  later, the TAF period in force at that time (the airport's own TAF or the
  nearest within 25 nm). With no TAF covering the time, the latest METAR
  stands in and a note says so. Winds aloft are the NOAA HRRR/GFS model
  forecast (Open-Meteo) for the flight's time and altitude.

## Route points

The NavLog holds only the points you chose, plus TOC and TOD: nothing is
added automatically. Add points from the suggestions (airports, VFR
waypoints, towns, roads, rivers, peaks, towers; RNAV fixes are off by
default), by typing an ident, or by clicking anywhere on the Route and fuel
map and naming the spot. Your points are filled, numbered pins; suggestions
are hollow rings. Rename a point from its chip or its map popup; remove it
from the chip, the popup or its NavLog row.

Aircraft from the logbook that you don't plan with can be removed from the
aircraft lists (settings `aircraft-hidden`; the logbook keeps them); deleting
an aircraft with a profile deletes the profile too.

## Layout rules

- Sections lay out against the width of the content column (`<main>` is a
  container; container queries, not viewport breakpoints), so opening the work
  sheet beside the page reflows them the same way a narrower window would.
- Groups of cards (airports, weather per airport, airspace and TFRs) use
  `.flow` (`index.css`): cards sit side by side at a minimum width and the last
  row stretches, so an odd card never leaves an empty half. A card that ends up
  full width splits into two inner columns (airport: runways and diagram |
  frequencies, NOTAMs, profile; weather: conditions | METAR, TAF, D-ATIS).
- Summary tiles use column counts that divide them evenly (six: 1, 2, 3 or 6
  across; five: the last spans two).
- Pilot: the crew picker heads the left column (rules, certificates,
  documents); minimums, IMSAFE and currency fill the right.
- Weight and balance: the CG chart stays in view beside the limits as they
  scroll. Checklists use balanced columns, never more than their sections.

## Flights, outputs and profiles

- **Flights** (`/flying/plan`, `FlightsPage.tsx`): every flight is its own
  saved plan at `/flying/plan/:id`, so several can be open at once. You can
  create one, open it, copy it as a new flight, or delete it (two presses).
  Edits save themselves about a second after you stop typing, and any change
  not yet sent is sent when you leave the page. A browser-only draft from
  before is offered once to keep or discard.
- **Outputs**: NavLog, Weight and balance, and Weather briefing. Each one prints
  on its own, and More → "Print all three" prints them together.
  - Under each checkpoint, the NavLog shows how every figure was worked out:
    the steps, the assumptions, and its sources (`explain.ts` `refs`).
  - Each source is the API used, with a link and the time it was fetched, or
    the POH figure, which opens the book at that page. A table standing in for
    another book is named without a link.
- **Pilots are profiles** (`useCrew` in `profiles.ts`):
  - Pilot, instructor and passenger profiles are loaded into a flight, or
    created in place.
  - Your earlier saved details appear as the pilot "self".
  - The Part 61 checks read the loaded pilot's certificate, medical and
    endorsements.
- **Checklist input**: upload a photo or PDF (it is read into lines for you to
  check), or add each line by hand in order: a section title, then each item
  and its value.

## The model: a flight file that ends in a NavLog

A flight is one file, read front to back in the order a pilot briefs:

```
New flight ─► Overview ─► Pilot ─► Aircraft ─► Weather ─► Airports ─► Route and fuel ─► Weight and performance ─► NavLog
(4 questions)  verdict,     PAVE first, then the numbers; each section holds its own inputs                         the output
               what's left
```

- **New flight** asks only what makes a flight (`PlannerPage.tsx` `NewFlight`):
  - where and when (from, via, to, engine start, power);
  - the aircraft;
  - who's flying.
  Your own pilot profile is asked once, the first time, above them.
- **Overview** gives:
  - the verdict;
  - the trip's numbers (each one opens its workings);
  - **Before this brief is complete**: open checks, worst first, each
    linking to its section;
  - one card per section with its answer;
  - **For a complete picture**: context that doesn't change the verdict, such
    as the airplane's own POH, its checklist, inspection dates and a standard
    briefing.
- **Each section** opens with its heading and what's still open in it, then
  its inputs, then the brief.
  - The inputs live where they belong: the route in Route and fuel, seats in
    Weight and performance, the airplane in Aircraft.
  - There is no separate input stage.
- **NavLog** is the final output: one sheet per flight, the reverse (weather
  log and flight plan), and the aircraft's checklist when it has one. Print
  gives all of it.
- **The rail** lists the sections with a mark for each:
  - a red dot: something rules the flight out;
  - an amber dot: a decision to make;
  - a ring with a count: things to finish;
  - a small dot: recommended context;
  - a tick: done.
  On phones the rail becomes a row of chips. Each section ends with a link to
  the next one.

## Workings, sources and assumptions: the work sheet

Every computed figure the pilot might question is a selectable figure, shown
with a dotted underline (`.fig`). Selecting one opens the **work sheet**
(`WorkSheet.tsx`). It sits beside the page at 1,536 px and wider, and over it
below that.

| Selected | The sheet shows |
|---|---|
| A NavLog cell (TC, TH, MH, WCA, variation, distance, distance left, TAS, GS, ETE, ETA, fuel, fuel remaining) or a checkpoint name | That row's workings, with the selected quantity first and highlighted. Each has its steps, the source used (tier: primary, backup, yours, stand-in) with its time, the backup, the assumptions, and the range it should fall in. Wind, temperature and CAS can be replaced for that row. |
| A W&B line or a CG chart point | That line's weight × arm and its source |
| An overview fact (times, fuel, weight and CG, cruise) | The matching topic in all workings |
| "Workings and sources" (rail or More) | Every calculation by topic, every assumption (with a link to the section that changes it) and every source with when it was fetched |

The same sheet holds the POH (opened at a figure from any POH link), the
aircraft's checklist (the profile's own when written, else the uploaded one)
and the briefing PDF.

## Status vocabulary

| Status  | Means | Mark | Changes verdict |
|---------|-------|------|-----------------|
| No-go   | Rules the flight out as planned | red ✕ / red dot | yes, to No-go |
| Decide  | A risk to weigh, or to talk through with the instructor | amber dot | yes, to Go with caution |
| Finish  | An entry or tick the plan still needs | hollow ring | yes, to Brief incomplete |
| Recommended | Context that replaces a stand-in (own POH, checklist, inspection dates, standard briefing) | small dot | no |
| Assumed | Data was missing or stale; what was used instead | muted ⓘ | no |
| Passed  | Checked and fine | muted tick | no |

The verdict appears in the header chip and the overview, nowhere else. Only a
no-go uses a full icon in a list. `readiness.ts` turns checks into tasks per
section and adds the recommended items.

## Profiles: created at the step that needs them

| Profile | Created | Asks | Changes in the plan |
|---|---|---|---|
| You | The first time, above the new-flight questions and in Pilot (`PilotSetup`) | Name, weight, certificate. Medical, endorsements and minimums are asked in Pilot, where they're checked. | Part 61 checks, minimums, the pilot seat, the flight-plan form |
| Instructor | Who's flying → Add an instructor (`PersonForm`) | Name, weight, CFI number | Dual role with them as PIC, seated front right with their weight |
| Passenger | Weight and performance → New passenger profile | Name, weight | Seat weight |
| Aircraft | New flight or Aircraft → Add an aircraft (`AircraftSetup`, five steps) | 1. Tail number (registry lookup, or make, model and year). 2. POH (what was found, what was read from it, and uploading the airplane's own). 3. Empty weight, moment and tanks. 4. Equipment (transponder, GPS, ADS-B Out, pitot heat, autopilot) and inspection dates. 5. Checklist. | Weight and balance, airworthiness checks, ADS-B rule, icing brief, your values over the POH's, the checklist in the brief and print |
| Airport | Airports → that airport's card | Pattern altitude, pattern side per runway end, notes | Climb, descent and TPA; notes on the NavLog |

Lifecycle:

- **Update:** each profile is edited where it shows: Pilot, Aircraft
  (profile and records, airworthiness, checklist) and Airports. Profiles
  (`/flying/plan/profiles`) lists and edits them all, with the same forms.
- **Delete:** two presses, saying how many saved flights use the profile and
  what happens to them. "You" can't be deleted.
- **What applies when:**
  - Aircraft and airport profiles apply whenever a flight opens.
  - Seat weights are copied into the flight when someone is seated.

## The aircraft in the brief

Aircraft is one continuous read with a jump list:

1. **At a glance:** registry, airworthiness classification and the airspeed
   strip with V-speeds.
2. **POH:** which book, what was read from it (tables, units, spec-sheet
   groups), what wasn't and what stands in for it (`PohReport`).
3. **Systems and limits:** engine, propeller, oil, fuel, gear and tires,
   brakes, electrical, pitot heat, load factors, icing, stall table and
   published performance.
4. **Performance this flight.**
5. **Checklist:** the airplane's own, written as steps or as plain text,
   imported from an uploaded checklist, or started from phase headings
   (`AircraftChecklist.tsx`). It can be ticked through and prints after the
   NavLog.
6. **Airworthiness for this flight:** AV1ATES dates, the documents (ARROW),
   §91.205 equipment ticks and installed equipment.
7. **Profile and records:** your values over the book's, documents and
   records.

## Principles

1. Quiet when fine: colour and icons only where the pilot has to act.
2. One verdict, said once; one list of what's left.
3. Inputs live with the brief they change.
4. Every number can show its working, and every stand-in says it's one.
5. A data gap is not a risk: it's "assumed" or "recommended", never a caution.
6. What's true across flights is a profile, entered once at the step that needs it.
7. Nothing is lost silently: leaving unsaved changes, deleting a flight and
   deleting a profile each ask first.

## Edge cases

| Case | Behaviour |
|------|-----------|
| No arrival yet | New flight's "Brief this flight" stays disabled and says what's missing |
| No aircraft profile for the chosen tail | Aircraft offers "Set up N…"; the brief uses the POH sample airplane and the empty weight is a to-do |
| Tail not in the registry | Setup asks make, model and year |
| No public POH, or tables or specs unreadable | The POH report says what stands in (the 172P's tables), and the workings name it per figure |
| Scanned POH still being read | The spec sheet shows that it's being read; the page polls |
| Weather or winds down | Assumed lines; no winds means a to-do to enter briefing winds |
| Departure in the past | To finish |
| Dual vs solo vs private | Who's flying; solo minimums on a dual flight become decisions |
| Unsaved changes, then open or start another flight | Save and continue, discard, or cancel |
| Old drafts (three-stage layout) | Migrated: the plan is kept and opens on the overview |
| Phone | The rail becomes chips; the sheet is full screen; the NavLog scrolls sideways at paper size |
| Print | The NavLog front, reverse and checklist on letter landscape; the screen chrome is hidden |
