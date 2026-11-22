# NavLog and W&B method

How the flight planner works out each NavLog column and each weight-and-balance
line. Every item lists what it assumes, the steps, where its inputs come from
(with the backup used when the source is missing), and the result to expect, so
a wrong number is easy to spot. The planner shows the same content for the
row or line you select (`web/src/features/planner/explain.ts`); this page is
the reference.

Source tiers, as the planner labels them:

| Tier | Meaning |
|---|---|
| Primary | The intended source, current |
| Backup | A fallback source, or the primary's last good copy |
| Yours | A value you entered; it overrides both |
| Stand-in | A default used because nothing else exists; the numbers aren't this flight's |

## Order of work

Each step needs the one before it:

1. Route and checkpoints
2. Cruise altitude
3. True course, variation, magnetic course
4. Wind and temperature at altitude
5. True airspeed and fuel flow
6. Wind correction, headings
7. Climb and descent split (TOC, TOD)
8. Ground speed, time, ETA
9. Fuel per row, fuel remaining, reserve
10. Weight and balance at ramp, takeoff and each landing

## NavLog

### 1. Route and checkpoints

- **Assumes:** Legs are great-circle lines between the route points. Middle
  points are flown over, not landed at. Automatic checkpoints are added on legs
  over 20 nm.
- **Steps:**
  1. Resolve each route token in FAA NASR: airport, navaid, fix, VFR waypoint,
     radial/distance or coordinates.
  2. Take candidate checkpoints near the line: airports and VFR waypoints
     within 5 nm, VORs within 4 nm, RNAV fixes within 2 nm.
  3. Keep candidates that are at least 8 nm apart and clear of the climb and
     descent, visual points first, at most 8 per leg.
- **Source:** FAA NASR, the current 28-day cycle. **Backup:** none. A token
  that doesn't resolve is a no-go; enter it as coordinates instead.
- **Expect:** Every row has a position. Checkpoints sit within a few miles of
  the line.

### 2. Cruise altitude

- **Assumes:** VFR cruising altitudes (§91.159) apply above 3,000 ft AGL. The
  planner wants at least 1,000 ft over the highest terrain on the line, and
  cautions under 2,000 ft because towers can stand 1,000 ft above the ground.
- **Steps:**
  1. Find the magnetic course of the flight: eastbound is 0–179°, westbound
     180–359°.
  2. Find the highest terrain along the line, sampled every 2 nm.
  3. Take the lowest altitude that is odd thousands + 500 eastbound (even
     thousands + 500 westbound), at least 3,500 ft, and 1,000 ft or more above
     that terrain.
  4. On short hops, stay below 3,000 ft AGL instead.
- **Source:** Open-Meteo elevation (Copernicus GLO-90 DEM). **Backup:** the
  field elevations alone, flagged as terrain unknown. **Yours:** the altitude
  you set for the flight.
- **Expect:** Eastbound 3,500, 5,500, 7,500 ft; westbound 4,500, 6,500 ft.
  Never within 1,000 ft of the terrain figure.

### 3. True course, variation, magnetic course

- **Assumes:** The course of each row is the initial great-circle course from
  its start to its end. Variation is the average of the two ends.
- **Steps:**
  1. TC = initial great-circle course.
  2. Variation from the World Magnetic Model on the flight date, at each end.
  3. MC = TC − east variation (+ west).
- **Source:** NASR positions and WMM 2025. **Backup:** NASR's per-airport
  variation, which can be decades old.
- **Expect:** About 13° E in the San Francisco Bay Area, so MC is about 13°
  less than TC.

### 4. Wind and temperature at altitude

- **Assumes:** The wind for a row is the forecast at the row's midpoint, at
  its altitude, for the forecast hour that covers the time the row is flown.
  Climb rows use the mid-climb altitude; descent rows use the
  mid-descent altitude.
- **Steps:**
  1. Pick the forecast window that contains the row's time.
  2. Take the three nearest forecast points and weight them by inverse distance
     squared.
  3. At each point, interpolate between the levels above and below the
     altitude. Direction is averaged as a vector, so 350° and 010° give 360°,
     not 180°.
  4. Temperature is interpolated the same way. With no temperature, the
     standard lapse rate (2 °C per 1,000 ft) is applied from the nearest level.
- **Source:** NOAA weather-model winds (HRRR out to 18 hours, GFS beyond), via
  Open-Meteo, sampled on a grid over the route at 1000–600 hPa and
  converted to the 3,000, 6,000, 9,000 and 12,000 ft levels.
- **Backup, in order:**
  1. The NWS text winds-aloft forecast (FB), if it is ever published again.
     NWS ended it on Nov 3, 2026 with the NAM model (SCN 26-47).
  2. The last good model fetch, up to 6 hours old, labelled with its age.
  3. **Yours:** the winds and temperature from your briefing, entered once per
     flight. A value typed into one row overrides only that row.
  4. **Stand-in:** calm wind and standard temperature, which is a caution.
- **Expect:** Speeds within a few knots of the winds/temps chart on
  aviationweather.gov's Graphical Forecasts for Aviation (GFA) or your Flight
  Service briefing.
  Temperature near 15 − 2 × (altitude ÷ 1,000) °C, give or take 10 °C. Model
  winds aren't an official FAA product, so cross-check them with an approved
  briefing.

### 5. True airspeed and fuel flow

- **Assumes:** Cruise at the RPM you chose, leaned as the POH recommends.
- **Steps:**
  1. ISA deviation = forecast temperature − standard temperature at the
     altitude.
  2. Interpolate the POH cruise table by pressure altitude, ISA deviation and
     RPM, giving %BHP, KTAS and GPH.
  3. Climb TAS = POH climb IAS + 2 % per 1,000 ft, at mid-climb altitude.
  4. The CAS column is TAS converted back for the altitude and temperature.
- **Source:** the POH for this model (cruise table, climb chart). **Backup:**
  the closest POH, flagged. **Yours:** the cruise KTAS and GPH in the aircraft
  profile, or a CAS typed into a row.
- **Expect:** Cessna 172P at 2,400 RPM: about 105–110 KTAS and 6.5–7 GPH at
  4,000–6,000 ft.

### 6. Wind correction, true and magnetic heading

- **Assumes:** Steady wind through the row.
- **Steps:**
  1. WCA = asin(wind speed × sin(wind direction − TC) ÷ TAS).
  2. TH = TC + WCA.
  3. MH = TH − east variation.
  4. CH = MH + compass deviation, from the aircraft's deviation card (you
     enter it).
- **Source:** steps 3–5. **Backup:** calm wind gives WCA 0, so TH = TC.
- **Expect:** |WCA| ≤ asin(wind speed ÷ TAS), about 8° for 15 kt at 110 KTAS.
  The correction points into the wind.

### 7. Climb and descent: TOC and TOD

- **Assumes:**
  - Climb follows the POH time, fuel and distance-to-climb chart: the value at
    cruise minus the value at field pressure altitude, plus 10 % per 10 °C
    above standard.
  - Descent is 500 fpm at cruise TAS, from cruise to pattern altitude. The POH
    has no descent table, so this is a planning figure.
- **Steps:**
  1. Climb ground distance = climb time × climb ground speed, with the wind
     at mid-climb.
  2. TOD distance = (cruise − pattern altitude) ÷ 500 fpm × descent ground
     speed.
  3. If climb and descent need more than the leg, both are scaled down to
     fit, and a caution says the leg is shorter than the climb.
- **Source:** the POH climb chart. **Backup:** the closest POH.
- **Expect:** For the 172P to 3,500 ft from near sea level: about 6–7 min,
  1–1.5 gal, 7–9 nm.

### 8. Ground speed, ETE, ETA

- **Assumes:** Takeoff time = engine start + start, taxi and run-up minutes
  (10 by default).
- **Steps:**
  1. GS = TAS × cos(WCA) + headwind component (from the wind triangle).
  2. ETE = distance ÷ GS × 60. Climb rows use the POH climb time.
  3. ETA = takeoff time + the sum of ETEs to that row.
- **Source:** steps 1–7.
- **Expect:** TAS − wind speed ≤ GS ≤ TAS + wind speed.

### 9. Fuel per row, fuel remaining, reserve

- **Assumes:**
  - 6 lb/gal (100LL).
  - Start, taxi and takeoff use the POH allowance (1.1 gal in the 172P) per
    takeoff.
  - Reserve is the larger of §91.151 (30 min by day, 45 at night) and your
    personal minimum, at cruise fuel flow.
- **Steps:**
  1. Row fuel = ETE ÷ 60 × GPH. Climb rows use the POH climb fuel.
  2. Fuel remaining = usable − taxi − the running total.
  3. Required = trip + taxi + reserve.
- **Source:** steps 5 and 8; usable fuel from the POH tank table or your
  entry.
- **Expect:** Fuel remaining at the last row ≥ the reserve. A row under the
  reserve shows red.

## Weight and balance

Moments are lb-in. The CG is the total moment ÷ the total weight.

### 1. Basic empty weight and moment

- **Assumes:** Includes unusable fuel and full oil, as the weighing record
  states.
- **Source:** this tail's W&B record, entered under Brief → Aircraft.
  **Stand-in:** the POH sample airplane (1,467 lb, 57.3 lb-in/1000 for the
  172P), which is a caution: a real airplane can differ by 100 lb or more.
- **Expect:** A 172 is about 1,400–1,700 lb, CG about 38–40 in.

### 2. Occupants and baggage

- **Assumes:**
  - Weights as entered, with clothing and headsets.
  - Pilot and front passenger share an arm, as do the rear seats.
- **Steps:**
  1. Front = pilot + front passenger.
  2. Rear = left + right.
  3. Weight × the POH arm for each station.
- **Source:** your entries and POH station arms. **Yours:** arms in the
  aircraft profile.
- **Expect:**
  - 172P front seats 34–46 in, rear 73 in.
  - Baggage area 1 at most 120 lb, area 2 at most 50 lb, both together at most
    120 lb.

### 3. Fuel

- **Steps:** gallons × 6 lb/gal × the POH fuel arm (48 in in the 172P).
- **Source:** your fuel entry, or full usable for the tanks.
- **Expect:** 40 gal usable is 240 lb.

### 4. Ramp, takeoff and landing

- **Steps:**
  1. Ramp = the sum of steps 1–3.
  2. Takeoff = ramp − start, taxi and run-up fuel (7 lb in the 172P), at the
     fuel arm.
  3. Landing = takeoff − the NavLog trip fuel × 6, at the fuel arm.
  4. The CG of each total must lie inside the POH envelope (normal
     category), and each weight under its maximum.
- **Source:** POH Section 2 limits and the Section 6 envelope. **Yours:** the
  limits in the aircraft profile.
- **Expect:**
  - 172P: ramp ≤ 2,407 lb, takeoff and landing ≤ 2,400 lb.
  - CG between 35.0 and 47.3 in at the weight's limit line.
  - Burning fuel moves the CG slightly forward, because the fuel arm (48 in)
    is aft of a typical CG.
