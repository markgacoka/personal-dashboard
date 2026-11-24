# Flight planner UX

The standard the planner at `/flying/plan` is built to. `flight-planner.md`
covers what it calculates; this covers how it reads and behaves.

## Purpose

One question: **can I fly this flight as planned, and if not, what do I
change?** Everything on the page either answers it, shows the working
behind the answer, or produces the paper (NavLog, flight plan) that goes into
the cockpit.

## Principles

1. **Quiet when fine.** A passed check has no colour. Colour and icons appear
   only where the pilot has to act. A screen full of amber teaches the pilot
   to ignore amber.
2. **One verdict, said once.** The verdict (Go, Go with caution, No-go as
   planned, Incomplete) appears in the brief's banner only. Tabs, the sidebar
   count and area rows don't repeat it.
3. **One next action.** The banner names the single most important thing to
   do next and links to where it's done. Every other path is a tab or a link.
4. **A risk is not a data gap.** "Weather below your minimums" and "no METAR
   within 25 nm" are different kinds of statement. Only the first can change
   the verdict (see Status vocabulary).
5. **The answer first, the working on request.** Each brief area shows its
   answer on one line. The detail opens in place, and the arithmetic, sources
   and assumptions are in the sidebar's Workings.
6. **Profiles, not retyping.** What's true of a person, an airplane or an
   airport across flights is entered once, in a profile, and loaded by every
   plan (see Profiles).
7. **Nothing is lost silently.** Leaving a plan with unsaved changes, deleting
   a plan and deleting a profile each ask first and say what's affected.

## Status vocabulary

| Status  | Means                                                             | Mark                     | Changes verdict |
|---------|-------------------------------------------------------------------|--------------------------|-----------------|
| No-go   | Rules the flight out as planned (regulation, limit, minimum)      | red ✕ icon               | yes → No-go     |
| Decide  | A real risk to weigh, or to talk through with the instructor      | amber dot                | yes → Caution   |
| Finish  | An entry or tick the plan still needs                             | hollow ring              | yes → Incomplete|
| Assumed | Data was missing or stale; what was used instead (a "note")       | muted ⓘ                  | no              |
| Passed  | Checked and fine                                                  | muted tick               | no              |

Rules:

- A full status icon is used only for the verdict itself (`VerdictIcon`).
  Lists use the small marks (`StatusIcon`).
- Colour is never the only signal. Every mark carries its label for screen
  readers, and the sidebar groups checks under a written heading.
- Text stays in the text colours. The mark beside it carries the status.
- **Moved to Assumed:** the closest POH used, POH tables without a stated
  unit, the FAA data cycle ended, no METAR or TAF near an airport (now one line
  for all such airports), a weather product unavailable, stale or
  out-of-window winds-aloft forecasts, Class C at cruise (a radio call, not a
  hazard) and missing runway data.
- **Moved to Finish:** the departure time in the past, no winds-aloft forecast
  (enter the briefing winds), and the empty weight still being the POH
  sample's ("Enter N739HE's empty weight").
- Stand-in values in Workings are labelled, not coloured amber.

## Flow

```
New plan ─► Guided setup (5 steps) ─► Brief ─► NavLog / print
              who · aircraft · route        verdict + next action
              time and power · load         six areas, each opens in place
```

- **Plan** holds the inputs: who's flying, aircraft, route, time and power, and
  load. The route chart sits below them. Its one forward action is "Brief this
  flight".
- **Brief** shows the banner (verdict, the trip's numbers, the next action),
  then six areas in PAVE order: pilot, aircraft, weather, route and fuel,
  airports, weight and performance.
  - Each row shows the area's answer, a red or amber dot only when the area
    has a no-go or a decision, and its counts in words.
  - Opening a row shows that area's open checks, then its notes, then its
    detail.
- **NavLog** shows the printable sheets. Print is its action.
- **Ready state.** When nothing is left to fix or finish, the banner's next
  action becomes: get a standard briefing (§91.103), optionally file a VFR
  flight plan, preflight with the checklist, and a NavLog button.
- **Sidebar** has the same width on every tab:
  - **Checks:** groups for Fix before you fly, Decide and To finish, with
    Assumed and Passed folded below. There are no counters or filters; the
    groups are the summary.
  - **Workings:** calculations, assumptions and sources.
  - **POH, Checklist and Briefing:** the documents.
  - It sits beside the plan at 1,536 px and wider, and opens over the page
    below that width.
- **Header:**
  - The plan name (editable) and a one-line summary.
  - **Profiles** opens the Profiles view.
  - **Plans** lists saved plans and starts a new one.
  - **Save** is the primary button while there are unsaved changes; once
    saved it becomes muted "Saved 3 min ago" text.
  - **More** holds Print NavLog and Delete plan.
  - There is no separate New button and no amber "not saved" label.

## Profiles

The things a plan loads, each with its own create, read, update and delete,
reachable without opening a plan (`/flying/plan/profiles`), and also editable
in place from the plan.

| Profile   | Stored in                                       | What it changes in the plan |
|-----------|-------------------------------------------------|-----------------------------|
| You       | `planner_settings` `pilot`, `certificates`, `minimums`; pilot records | Part 61 checks for the role, go/no-go minimums, the pilot seat's weight, the flight-plan form |
| People    | `planner_settings` `people` (instructors, passengers) | Seat weights; an instructor in the right seat makes the flight dual with them as PIC |
| Aircraft  | `planner_aircraft` per tail; aircraft records   | Empty weight and moment (W&B), tanks, inspection dates (airworthiness), your values over the POH's (speeds, weights, arms, fuel), equipment |
| Airports  | `planner_airport_profiles` per ident            | Pattern altitude (climb, descent, NavLog), pattern side per runway, notes printed on the NavLog |

Lifecycle:

- **Create**
  - **People:** "Add an instructor or passenger". Instructors in your logbook
    are listed as ready-made drafts.
  - **Aircraft:** by tail number. Logbook tails are listed as drafts; saving
    any value creates the profile.
  - **Airports:** by identifier, checked against FAA NASR.
  - From inside a plan, the same editors exist under Brief → Pilot, Aircraft
    and Airports.
- **Read:** the list shows each profile with a one-line summary. Opening one
  shows what it changes in the plan before its fields.
- **Update**
  - Each editor saves explicitly and offers Discard.
  - Aircraft and airport profiles apply to every plan when it opens.
  - Seat weights are copied into the plan when a person is seated, so a later
    change to someone's weight doesn't rewrite a flight already planned.
- **Delete**
  - Every delete takes two presses.
  - The confirmation says how many saved plans use the profile and what
    happens to them. Plans keep their seat weights. A deleted aircraft
    profile falls back to the POH sample airplane's empty weight.
  - "You" can't be deleted. Deleting an aircraft profile leaves its registry
    entry, POH and uploaded records in place.

Loading into a plan:

- **Pilot seat:** a new plan's empty pilot seat takes your profile's weight.
- **Who sits where:** every seat has a "Who?" picker listing you and your
  people.
  - Picking someone copies their weight in.
  - Moving them to another seat empties the one they left.
  - A weight typed afterwards is this flight's own.
- **Instructor:** the field suggests your instructors from your profiles and
  logbook. Choosing one who has a profile seats them front right.
- **Aircraft:** typing the tail loads its profile. The Aircraft group links
  to it.
- **Airports:** each one's profile loads automatically from the route.

## Edge cases

| Case | Behaviour |
|------|-----------|
| No route, or one point | Verdict Incomplete; the next action is "Add a departure and a destination"; the brief's facts are hidden |
| Identifier not in NASR | No-go with the accepted formats; the route list marks it in red |
| Route starts or ends at a waypoint | No-go: flights start and end at airports |
| No tail, or not in the registry | To finish; make, model and year fields appear |
| No POH for the model | Assumed: the closest transcribed profile is used and named |
| Scanned POH still being read | Spec sheet says it's being read; the numbers use the closest profile until it's done |
| Weather service down | One Assumed line per product; checks that need it aren't run, not passed |
| No winds aloft | To finish: enter briefing winds; calm wind is assumed meanwhile |
| Departure in the past (an old plan) | To finish: change the engine start |
| Night | Detected from civil twilight; night minimums, reserve and endorsements apply |
| Dual vs solo vs private | Role table in Pilot; solo minimums breached on a dual flight become decisions, not no-gos |
| Certificate not saved | To finish; the checks assume a student pilot until it is |
| Unsaved changes, then open another plan or start new | Asks: save and continue, discard, or cancel |
| Delete plan | Second press required, with the plan's name |
| Delete a profile used by saved plans | Says how many and what happens to them |
| Browser storage unavailable (private mode) | The draft isn't kept between visits; saving to the server still works |
| Phone width | Tabs and the brief stack; the sidebar opens full screen; NavLog scrolls sideways at paper size |
| Print | NavLog front and reverse on letter landscape; the screen chrome is hidden |

## What stays out

- No dashboards of counts (the old four-number filter grid and bar).
- No duplicate navigation (the old back and next buttons under the brief).
- No amber for data provenance (stand-ins, the closest POH, an unsaved plan).
