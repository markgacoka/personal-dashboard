// Checklist content for the planner: the pilot (IMSAFE, PAVE), the airplane's
// paperwork and equipment (AV1ATES, §91.205 ATOMATOFLAMES / FLAPS), and the
// 1982 172P POH Section 4 normal-procedure checklists by phase.

export interface CheckItem { key: string; label: string; detail: string }

export const IMSAFE: CheckItem[] = [
  { key: 'illness', label: 'Illness', detail: 'No symptoms of illness — cold, congestion, fever, nausea.' },
  { key: 'medication', label: 'Medication', detail: 'No medication that impairs (check the FAA "Do Not Issue / Do Not Fly" list; antihistamines, sleep aids).' },
  { key: 'stress', label: 'Stress', detail: 'No pressure from work, family or the schedule that will crowd out attention.' },
  { key: 'alcohol', label: 'Alcohol', detail: '8 hours bottle to throttle and under 0.04 % BAC (§91.17); no hangover.' },
  { key: 'fatigue', label: 'Fatigue', detail: 'Rested — slept enough last night and not at the end of a long day.' },
  { key: 'emotion', label: 'Emotion / Eating', detail: 'Emotionally settled, hydrated and fed.' },
]

export const PAVE: (CheckItem & { prompt: string })[] = [
  { key: 'pilot', label: 'Pilot', detail: 'IMSAFE, currency and recency for this flight, proficiency in this airplane.', prompt: 'Anything about me today that adds risk?' },
  { key: 'aircraft', label: 'Aircraft', detail: 'Airworthy, equipped for the flight, fuel and performance margins, familiar avionics.', prompt: 'Anything about the airplane that adds risk?' },
  { key: 'environment', label: 'enVironment', detail: 'Weather, terrain, airports, airspace, night, NOTAMs and TFRs.', prompt: 'Anything about the weather, terrain or airports that adds risk?' },
  { key: 'external', label: 'External pressures', detail: 'Schedules, passengers, "get-there-itis", cost of cancelling — plan the alternative now.', prompt: 'What would make me push on when I shouldn\'t? What\'s my out?' },
]

// Inspections a rental is required to have (§91.409, §91.411, §91.413, §91.207, ADs).
// `months` is the interval; `hours` the 100-hour for aircraft used for hire or flight instruction.
export const AV1ATES: (CheckItem & { months?: number; hours?: number; ifrOnly?: boolean })[] = [
  { key: 'annual', label: 'Annual inspection', detail: '§91.409(a): within the preceding 12 calendar months.', months: 12 },
  { key: 'vor', label: 'VOR check', detail: '§91.171: within 30 days — IFR only.', ifrOnly: true },
  { key: 'hundred', label: '100-hour inspection', detail: '§91.409(b): required when the airplane is used for hire or flight instruction (NICE AIR rentals).', hours: 100 },
  { key: 'ad', label: 'Airworthiness directives', detail: 'Recurring ADs complied with (aircraft maintenance records).' },
  { key: 'transponder', label: 'Transponder', detail: '§91.413: tested within 24 calendar months.', months: 24 },
  { key: 'elt', label: 'ELT', detail: '§91.207: inspected within 12 calendar months; battery replaced at 1 hour cumulative use or 50 % of its life.', months: 12 },
  { key: 'static', label: 'Altimeter / static system', detail: '§91.411: within 24 calendar months — IFR in controlled airspace.', months: 24, ifrOnly: true },
]

// §91.205(b) day VFR required equipment.
export const ATOMATOFLAMES: CheckItem[] = [
  { key: 'airspeed', label: 'Airspeed indicator', detail: '' },
  { key: 'tach', label: 'Tachometer', detail: 'For each engine.' },
  { key: 'oilpress', label: 'Oil pressure gauge', detail: '' },
  { key: 'manifold', label: 'Manifold pressure gauge', detail: 'Altitude engines only — n/a on a 172.' },
  { key: 'altimeter', label: 'Altimeter', detail: '' },
  { key: 'temp', label: 'Temperature gauge', detail: 'Liquid-cooled engines only — n/a on a 172.' },
  { key: 'oiltemp', label: 'Oil temperature gauge', detail: '' },
  { key: 'fuelgauge', label: 'Fuel gauge', detail: 'For each tank.' },
  { key: 'gear', label: 'Landing gear position indicator', detail: 'Retractable gear only — n/a on a 172.' },
  { key: 'anticoll', label: 'Anti-collision lights', detail: 'Aircraft certificated after March 11, 1996.' },
  { key: 'compass', label: 'Magnetic compass', detail: '' },
  { key: 'elt', label: 'ELT', detail: 'Per §91.207.' },
  { key: 'belts', label: 'Safety belts / shoulder harnesses', detail: '' },
]

// §91.205(c) night VFR, in addition.
export const FLAPS: CheckItem[] = [
  { key: 'fuses', label: 'Fuses', detail: 'Spare fuses, or circuit breakers.' },
  { key: 'landing', label: 'Landing light', detail: 'If the aircraft is operated for hire.' },
  { key: 'anticoll', label: 'Anti-collision lights', detail: 'Approved system.' },
  { key: 'position', label: 'Position lights', detail: 'Navigation lights.' },
  { key: 'source', label: 'Source of electricity', detail: 'Adequate for all installed electrical and radio equipment.' },
]

export interface Phase { key: string; label: string; items: [string, string][]; when: 'preflight' | 'ground' | 'departure' | 'enroute' | 'arrival' }

export const POH_CHECKLISTS: Phase[] = [
  { key: 'cabin', label: 'Preflight — cabin', when: 'preflight', items: [['POH', 'AVAILABLE IN THE AIRPLANE'], ['Parking brake', 'SET'], ['Control wheel lock', 'REMOVE'], ['Ignition switch', 'OFF'], ['Avionics power switch', 'OFF'], ['Master switch', 'ON'], ['Fuel quantity indicators', 'CHECK QUANTITY'], ['Avionics cooling fan', 'CHECK AUDIBLY'], ['Master switch', 'OFF'], ['Static pressure alternate source', 'OFF'], ['Fuel selector valve', 'BOTH'], ['Baggage door', 'CHECK']] },
  { key: 'empennage', label: 'Preflight — empennage', when: 'preflight', items: [['Rudder gust lock', 'REMOVE'], ['Tail tie-down', 'DISCONNECT'], ['Control surfaces', 'CHECK freedom of movement and security']] },
  { key: 'rwing', label: 'Preflight — right wing', when: 'preflight', items: [['Aileron', 'CHECK freedom and security'], ['Wing tie-down', 'DISCONNECT'], ['Main wheel tire', 'CHECK inflation'], ['Fuel tank sump', 'DRAIN — water, sediment, grade'], ['Fuel selector quick-drain', 'DRAIN'], ['Fuel quantity', 'CHECK VISUALLY'], ['Fuel filler cap', 'SECURE']] },
  { key: 'nose', label: 'Preflight — nose', when: 'preflight', items: [['Engine oil', 'CHECK — not less than 5 qt; 7 qt for extended flight'], ['Fuel strainer drain', 'PULL ~4 s, check CLOSED'], ['Propeller and spinner', 'CHECK nicks and security'], ['Carburetor air filter', 'CHECK'], ['Nose strut and tire', 'CHECK inflation'], ['Nose tie-down', 'DISCONNECT'], ['Static source (left)', 'CHECK for stoppage']] },
  { key: 'lwing', label: 'Preflight — left wing', when: 'preflight', items: [['Main wheel tire', 'CHECK'], ['Fuel tank sump', 'DRAIN'], ['Fuel quantity', 'CHECK VISUALLY'], ['Fuel filler cap', 'SECURE'], ['Pitot tube cover', 'REMOVE, check opening'], ['Fuel tank vent', 'CHECK'], ['Stall warning opening', 'CHECK'], ['Wing tie-down', 'DISCONNECT'], ['Landing lights', 'CHECK'], ['Aileron', 'CHECK freedom and security']] },
  { key: 'beforestart', label: 'Before starting engine', when: 'ground', items: [['Preflight inspection', 'COMPLETE'], ['Passenger briefing', 'COMPLETE'], ['Seats, belts, harnesses', 'ADJUST and LOCK'], ['Brakes', 'TEST and SET'], ['Avionics power switch', 'OFF'], ['Circuit breakers', 'CHECK IN'], ['Electrical equipment, autopilot', 'OFF'], ['Fuel selector valve', 'BOTH']] },
  { key: 'start', label: 'Starting engine', when: 'ground', items: [['Prime', 'AS REQUIRED (2–6 strokes; none if warm)'], ['Carburetor heat', 'COLD'], ['Throttle', 'OPEN 1/8 INCH'], ['Mixture', 'RICH'], ['Propeller area', 'CLEAR'], ['Master switch', 'ON'], ['Ignition', 'START'], ['Oil pressure', 'CHECK'], ['Avionics power switch', 'ON'], ['Nav lights, beacon', 'ON as required'], ['Radios', 'ON']] },
  { key: 'runup', label: 'Before takeoff', when: 'departure', items: [['Parking brake', 'SET'], ['Seats, belts, harnesses', 'CHECK SECURE'], ['Cabin doors', 'CLOSED and LOCKED'], ['Flight controls', 'FREE and CORRECT'], ['Flight instruments', 'CHECK and SET'], ['Fuel quantity', 'CHECK'], ['Mixture', 'RICH'], ['Fuel selector valve', 'RECHECK BOTH'], ['Elevator trim', 'SET for takeoff'], ['Throttle', '1700 RPM — mags (≤125 drop, ≤50 diff), carb heat, suction, engine instruments and ammeter'], ['Throttle', '1000 RPM or less'], ['Throttle friction lock', 'ADJUST'], ['Radios and avionics', 'SET'], ['Wing flaps', 'SET for takeoff'], ['Brakes', 'RELEASE']] },
  { key: 'takeoff', label: 'Takeoff (normal / short field)', when: 'departure', items: [['Wing flaps', '0–10° (short field: 10°)'], ['Carburetor heat', 'COLD'], ['Throttle', 'FULL OPEN (short field: on brakes, then release)'], ['Mixture', 'RICH (above 3000 ft, lean for max RPM)'], ['Elevator', 'LIFT NOSE WHEEL at 55 KIAS (short field: slightly tail low)'], ['Climb speed', '70–80 KIAS (short field: 56 KIAS until obstacles cleared)']] },
  { key: 'climb', label: 'Enroute climb', when: 'enroute', items: [['Airspeed', '70–85 KIAS'], ['Throttle', 'FULL OPEN'], ['Mixture', 'RICH (above 3000 ft, lean for max RPM)']] },
  { key: 'cruise', label: 'Cruise', when: 'enroute', items: [['Power', '2100–2700 RPM (≤75 % recommended)'], ['Trim', 'ADJUST'], ['Mixture', 'LEAN']] },
  { key: 'descent', label: 'Descent', when: 'arrival', items: [['Fuel selector valve', 'BOTH'], ['Power', 'AS DESIRED'], ['Mixture', 'ADJUST (full rich for idle)'], ['Carburetor heat', 'FULL HEAT AS REQUIRED']] },
  { key: 'beforelanding', label: 'Before landing', when: 'arrival', items: [['Seats, belts, harnesses', 'SECURE'], ['Fuel selector valve', 'BOTH'], ['Mixture', 'RICH'], ['Carburetor heat', 'ON (before reducing power)']] },
  { key: 'landing', label: 'Landing (normal / short field)', when: 'arrival', items: [['Airspeed', '65–75 KIAS flaps up'], ['Wing flaps', 'AS DESIRED (0–10° below 110, 10–30° below 85) — short field 30°'], ['Airspeed', '60–70 KIAS flaps down (short field: 61 KIAS until flare)'], ['Touchdown', 'MAIN WHEELS FIRST'], ['Landing roll', 'LOWER NOSE WHEEL GENTLY'], ['Braking', 'MINIMUM REQUIRED (short field: heavy, flaps retract)']] },
  { key: 'balked', label: 'Balked landing', when: 'arrival', items: [['Throttle', 'FULL OPEN'], ['Carburetor heat', 'COLD'], ['Wing flaps', '20° immediately'], ['Climb speed', '55 KIAS'], ['Wing flaps', '10° until obstacles cleared; retract at safe altitude and 60 KIAS']] },
  { key: 'after', label: 'After landing and securing', when: 'arrival', items: [['Carburetor heat', 'COLD'], ['Wing flaps', 'UP'], ['Parking brake', 'SET'], ['Avionics, electrical', 'OFF'], ['Mixture', 'IDLE CUT-OFF'], ['Ignition', 'OFF'], ['Master', 'OFF'], ['Control lock', 'INSTALL']] },
]
