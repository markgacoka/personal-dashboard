import { pool } from './client.js'

// V2 migration: additive ForeFlight-aligned columns
const SCHEMA_V2 = `
-- Aircraft: ForeFlight classification fields
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS type_code         TEXT;
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS category          TEXT DEFAULT 'Airplane';
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS aircraft_class    TEXT DEFAULT 'ASEL';
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS gear_type         TEXT DEFAULT 'fixed_tricycle';
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS is_complex        BOOLEAN DEFAULT false;
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS is_high_performance BOOLEAN DEFAULT false;
ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS is_pressurized    BOOLEAN DEFAULT false;

-- Flights: ForeFlight logbook fields
ALTER TABLE flights ADD COLUMN IF NOT EXISTS sic                REAL DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS time_out           TEXT;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS time_in            TEXT;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS on_duty            TEXT;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS off_duty           TEXT;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS distance_nm        REAL;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS day_takeoffs       INTEGER DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS day_landings_full_stop   INTEGER DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS night_landings_full_stop INTEGER DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS actual_instrument  REAL DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS hobbs_start        REAL;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS hobbs_end          REAL;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS tach_start         REAL;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS tach_end           REAL;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS holds              INTEGER DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS dual_received      REAL DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS simulated_flight   REAL DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS ground_training    REAL DEFAULT 0;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS instructor_comments TEXT;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS flight_review      BOOLEAN DEFAULT false;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS checkride          BOOLEAN DEFAULT false;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS ipc                BOOLEAN DEFAULT false;
ALTER TABLE flights ADD COLUMN IF NOT EXISTS foreflight_source  TEXT;

-- Approach table: one row per approach per flight
CREATE TABLE IF NOT EXISTS approaches (
  id             SERIAL PRIMARY KEY,
  flight_id      INTEGER REFERENCES flights(id) ON DELETE CASCADE,
  approach_type  TEXT,
  airport_icao   TEXT,
  runway         TEXT,
  circle_to_land BOOLEAN DEFAULT false
);

-- Track log GPS points
CREATE TABLE IF NOT EXISTS track_log_points (
  id             SERIAL PRIMARY KEY,
  flight_id      INTEGER REFERENCES flights(id) ON DELETE CASCADE,
  ts             TIMESTAMPTZ NOT NULL,
  lat            REAL NOT NULL,
  lon            REAL NOT NULL,
  altitude_ft    INTEGER,
  groundspeed_kts INTEGER,
  track_deg      INTEGER,
  vertical_speed_fpm INTEGER
);
`

const SCHEMA = `
CREATE TABLE IF NOT EXISTS airports (
  icao TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT DEFAULT 'CA',
  lat  REAL NOT NULL,
  lon  REAL NOT NULL,
  elevation_ft INTEGER,
  type TEXT DEFAULT 'small_airport'
);

CREATE TABLE IF NOT EXISTS aircraft (
  id          SERIAL PRIMARY KEY,
  tail_number TEXT UNIQUE NOT NULL,
  make        TEXT NOT NULL,
  model       TEXT NOT NULL,
  year        INTEGER,
  engine_type TEXT,
  engine_hp   INTEGER,
  seats       INTEGER DEFAULT 4,
  ifr_equipped    BOOLEAN DEFAULT false,
  glass_cockpit   BOOLEAN DEFAULT false,
  notes       TEXT
);

CREATE TABLE IF NOT EXISTS instructors (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  certificate TEXT,
  rating      TEXT DEFAULT 'CFI'
);

CREATE TABLE IF NOT EXISTS flights (
  id              SERIAL PRIMARY KEY,
  date            DATE NOT NULL,
  aircraft_id     INTEGER REFERENCES aircraft(id),
  departure_icao  TEXT REFERENCES airports(icao),
  arrival_icao    TEXT REFERENCES airports(icao),
  via             TEXT[] DEFAULT '{}',
  training_type   TEXT,
  total_duration  REAL NOT NULL,
  dual_given      REAL DEFAULT 0,
  pic             REAL DEFAULT 0,
  solo            REAL DEFAULT 0,
  cross_country   REAL DEFAULT 0,
  night           REAL DEFAULT 0,
  instrument      REAL DEFAULT 0,
  takeoffs        INTEGER DEFAULT 0,
  landings        INTEGER DEFAULT 0,
  night_takeoffs  INTEGER DEFAULT 0,
  night_landings  INTEGER DEFAULT 0,
  instructor_id   INTEGER REFERENCES instructors(id),
  remarks         TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
`

const AIRPORTS = [
  ['KSQL', 'San Carlos Airport',           'San Carlos',   37.5119, -122.2498,   5, 'small_airport'],
  ['KPAO', 'Palo Alto Airport',            'Palo Alto',    37.4611, -122.1147,   4, 'small_airport'],
  ['KRHV', 'Reid-Hillview Airport',        'San Jose',     37.3329, -121.8194, 135, 'small_airport'],
  ['KHAF', 'Half Moon Bay Airport',        'Half Moon Bay',37.5134, -122.5006,  66, 'small_airport'],
  ['KLVK', 'Livermore Municipal Airport',  'Livermore',    37.6934, -121.8197, 400, 'small_airport'],
  ['KWVI', 'Watsonville Municipal Airport','Watsonville',  36.9360, -121.7903, 163, 'small_airport'],
  ['KOAK', 'Metropolitan Oakland Intl',    'Oakland',      37.7213, -122.2208,   9, 'medium_airport'],
  ['KSJC', 'Norman Y. Mineta San Jose Intl','San Jose',    37.3626, -121.9290,  62, 'large_airport'],
  ['KMOD', 'Modesto City-County Airport',  'Modesto',      37.6258, -120.9544,  97, 'small_airport'],
  ['KSCK', 'Stockton Metropolitan Airport','Stockton',     37.8942, -121.2377,  33, 'medium_airport'],
  ['E16',  'South County Airport',         'San Martin',   37.0761, -121.5969, 281, 'small_airport'],
]

const AIRCRAFT_SEED = [
  {
    tail_number: 'N5624H',
    make: 'Cessna', model: '172S', year: 2019,
    engine_type: 'Lycoming IO-360-L2A',
    engine_hp: 180, seats: 4,
    ifr_equipped: true, glass_cockpit: false,
    notes: 'G1000 not installed. Vx=59kt, Vy=74kt, Va=105kt. IFR certified, dual VOR/GPS.',
    type_code: 'C172', category: 'Airplane', aircraft_class: 'ASEL',
    gear_type: 'fixed_tricycle', is_complex: false, is_high_performance: false, is_pressurized: false,
  },
  {
    tail_number: 'N4786H',
    make: 'Piper', model: 'PA-28-161', year: 2005,
    engine_type: 'Lycoming O-320-D3G',
    engine_hp: 160, seats: 4,
    ifr_equipped: false, glass_cockpit: false,
    notes: 'Warrior II. VSO=49kt, VS=55kt, VX=63kt, VY=79kt. Used for instrument ground reference.',
    type_code: 'PA28', category: 'Airplane', aircraft_class: 'ASEL',
    gear_type: 'fixed_tricycle', is_complex: false, is_high_performance: false, is_pressurized: false,
  },
]

const INSTRUCTORS_SEED = [
  { name: 'Michael Torres', certificate: 'CFI-3847291', rating: 'CFI, CFII' },
]

// [date, aircraft_idx, dep, arr, via[], type, total, dual, pic, solo, xc, night, inst, t/o, lnd, nt/o, nlnd, remarks]
const FLIGHTS_SEED = [
  ['2025-08-15', 0, 'KSQL','KSQL', [], 'maneuvers',    1.0, 1.0, 0,   0,   0,   0,   0,   2,  2, 0, 0, 'Intro flight — aircraft familiarization, straight and level, turns, climbs and descents. First time at the controls.'],
  ['2025-08-22', 0, 'KSQL','KSQL', [], 'maneuvers',    1.2, 1.2, 0,   0,   0,   0,   0,   2,  2, 0, 0, 'Slow flight, power-off and power-on stalls. Stall recognition and recovery. Ground reference: rectangular course.'],
  ['2025-08-29', 0, 'KSQL','KSQL', [], 'maneuvers',    1.1, 1.1, 0,   0,   0,   0,   0,   2,  2, 0, 0, 'S-turns across a road, turns around a point, steep turns (45°). Pilotage and dead reckoning intro.'],
  ['2025-09-05', 0, 'KSQL','KSQL', [], 'pattern',      1.3, 1.3, 0,   0,   0,   0,   0,   8,  8, 0, 0, 'Traffic pattern work at KSQL runway 30. Normal takeoffs and landings. Pattern altitude 800ft MSL.'],
  ['2025-09-12', 0, 'KSQL','KSQL', [], 'pattern',      1.2, 1.2, 0,   0,   0,   0,   0,  10, 10, 0, 0, 'Crosswind practice. Winds 12kt at 290°, crosswind component ~10kt. Side-load landings, crab method.'],
  ['2025-09-19', 0, 'KSQL','KHAF', [], 'maneuvers',    1.5, 1.5, 0,   0,   0.5, 0,   0,   4,  4, 0, 0, 'Short-field and soft-field takeoffs and landings at KHAF. Coastal terrain familiarization, SFO Class B avoidance.'],
  ['2025-09-26', 0, 'KSQL','KSQL', ['KPAO'], 'maneuvers', 1.3, 1.3, 0, 0, 0,   0,   0,   3,  3, 0, 0, 'Emergency procedures — simulated engine failure, forced landing selection, EFATO. Touch-and-go at KPAO.'],
  ['2025-10-03', 0, 'KSQL','KSQL', [], 'pattern',      1.0, 1.0, 0,   0,   0,   0,   0,   6,  6, 0, 0, 'Pre-solo dual. CFI evaluating pattern consistency, go-around decisions, radio calls.'],
  ['2025-10-10', 0, 'KSQL','KSQL', [], 'solo',         0.5, 0,   0.5, 0.5, 0,   0,   0,   3,  3, 0, 0, 'First solo! Three solo circuits at KSQL. ATIS, radio calls, pattern, full-stop landings. CFI on ground.'],
  ['2025-10-17', 0, 'KSQL','KSQL', [], 'solo',         0.8, 0,   0.8, 0.8, 0,   0,   0,   5,  5, 0, 0, 'Solo pattern practice. Normal, short-field, and soft-field landings. Go-around on lap 3 (wake turbulence).'],
  ['2025-10-24', 0, 'KSQL','KSQL', ['KLVK','KRHV'], 'x-country', 1.8, 1.8, 0, 0, 1.8, 0, 0, 3, 3, 0, 0, 'Dual cross-country: KSQL→KLVK→KRHV→KSQL. Pilotage, VOR tracking, ATIS and tower comms at all three.'],
  ['2025-11-07', 0, 'KSQL','KSQL', ['KWVI','E16'], 'x-country', 2.2, 2.2, 0, 0, 2.2, 0, 0, 4, 4, 0, 0, 'Dual cross-country: KSQL→KWVI→E16→KSQL. Mountain terrain, non-towered airport procedures. Distance: 78nm.'],
  ['2025-11-14', 0, 'KSQL','KSQL', ['KLVK','KRHV'], 'x-country', 2.0, 0, 2.0, 2.0, 2.0, 0, 0, 3, 3, 0, 0, 'Solo cross-country: KSQL→KLVK→KRHV→KSQL. First solo XC. Pre-flight planning, weather check, fuel planning.'],
  ['2025-11-21', 0, 'KSQL','KSQL', ['KPAO','KRHV'], 'night',    2.1, 2.1, 0, 0, 0, 2.1, 0,  6,  6, 4, 4, 'Night flight: KSQL→KPAO→KRHV→KSQL. Night lighting, illusions, airport beacon identification. 4 night T&Ls.'],
  ['2025-12-05', 1, 'KSQL','KSQL', [], 'instrument',   1.5, 1.5, 0, 0, 0, 0, 0.8, 2, 2, 0, 0, 'Instrument training in Piper PA-28 (N4786H). 0.8h under foggles: straight/level, turns, unusual attitudes, partial panel.'],
  ['2025-12-12', 0, 'KSQL','KSQL', ['KMOD','KSCK'], 'x-country', 3.2, 3.2, 0, 0, 3.2, 0, 0, 4, 4, 0, 0, 'Long dual cross-country: KSQL→KMOD→KSCK→KSQL. 192nm total. Class C airspace at KMOD. IFR-equipped aircraft.'],
  ['2026-01-09', 0, 'KSQL','KSQL', [], 'checkride_prep', 1.4, 1.4, 0, 0, 0, 0, 0, 4, 4, 0, 0, 'Checkride prep: ACS maneuvers — steep turns, slow flight, stalls (power-off/on), ground reference. All within ACS.'],
  ['2026-01-16', 0, 'KSQL','KPAO', [], 'checkride_prep', 1.2, 1.2, 0, 0, 0, 0, 0, 5, 5, 0, 0, 'Checkride prep: Pattern work at KSQL and KPAO. Short-field to 50ft obstacle, crosswind 8kt component.'],
  ['2026-02-13', 0, 'KSQL','KSQL', [], 'checkride_prep', 1.5, 1.5, 0, 0, 0, 0, 0, 4, 4, 0, 0, 'Final checkride prep: full mock oral and flight. All ACS tasks evaluated. Emergency descent, divert to KPAO.'],
  ['2026-03-15', 0, 'KSQL','KSQL', ['KWVI','KMOD'], 'x-country', 3.5, 0, 3.5, 3.5, 3.5, 0, 0, 4, 4, 0, 0, 'Required solo long XC: KSQL→KWVI→KMOD→KSQL. 214nm. Filed VFR flight plan. Fuel stop at KMOD. Solo PIC.'],
]

export async function migrate() {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(SCHEMA)

    for (const [icao, name, city, lat, lon, elev, type] of AIRPORTS) {
      await client.query(
        `INSERT INTO airports (icao,name,city,lat,lon,elevation_ft,type)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (icao) DO NOTHING`,
        [icao, name, city, lat, lon, elev, type]
      )
    }

    for (const ac of AIRCRAFT_SEED) {
      await client.query(
        `INSERT INTO aircraft (tail_number,make,model,year,engine_type,engine_hp,seats,ifr_equipped,glass_cockpit,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (tail_number) DO NOTHING`,
        [ac.tail_number,ac.make,ac.model,ac.year,ac.engine_type,ac.engine_hp,ac.seats,ac.ifr_equipped,ac.glass_cockpit,ac.notes]
      )
    }

    for (const ins of INSTRUCTORS_SEED) {
      await client.query(
        `INSERT INTO instructors (name,certificate,rating)
         SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM instructors WHERE name=$1)`,
        [ins.name, ins.certificate, ins.rating]
      )
    }

    const { rows: [ac1] } = await client.query(`SELECT id FROM aircraft WHERE tail_number='N5624H'`)
    const { rows: [ac2] } = await client.query(`SELECT id FROM aircraft WHERE tail_number='N4786H'`)
    const { rows: [ins1] } = await client.query(`SELECT id FROM instructors WHERE name='Michael Torres'`)
    const acIds = [ac1.id, ac2.id]

    const existing = await client.query(`SELECT COUNT(*) FROM flights`)
    if (parseInt(existing.rows[0].count) === 0) {
      for (const f of FLIGHTS_SEED) {
        const [date,acIdx,dep,arr,via,type,total,dual,pic,solo,xc,night,inst,to,lnd,nto,nlnd,remarks] = f
        await client.query(
          `INSERT INTO flights
           (date,aircraft_id,departure_icao,arrival_icao,via,training_type,total_duration,
            dual_given,pic,solo,cross_country,night,instrument,takeoffs,landings,
            night_takeoffs,night_landings,instructor_id,remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [date, acIds[acIdx], dep, arr, via, type, total,
           dual, pic, solo, xc, night, inst, to, lnd, nto, nlnd,
           dual > 0 ? ins1.id : null, remarks]
        )
      }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function migrateV2() {
  const client = await pool.connect()
  try {
    // Run each ALTER TABLE statement individually (can't batch IF NOT EXISTS in one transaction easily)
    const stmts = SCHEMA_V2.split(';').map(s => s.replace(/--[^\n]*/g, '').trim()).filter(s => s.length > 0)
    for (const stmt of stmts) {
      await client.query(stmt)
    }
    // Backfill ForeFlight classification fields on existing aircraft rows
    for (const ac of AIRCRAFT_SEED) {
      await client.query(
        `UPDATE aircraft SET
           type_code=$1, category=$2, aircraft_class=$3, gear_type=$4,
           is_complex=$5, is_high_performance=$6, is_pressurized=$7
         WHERE tail_number=$8 AND type_code IS NULL`,
        [ac.type_code, ac.category, ac.aircraft_class, ac.gear_type,
         ac.is_complex, ac.is_high_performance, ac.is_pressurized, ac.tail_number]
      )
    }
  } finally {
    client.release()
  }
}

// V7: add mode_s_hex to aircraft table so OpenSky lookup works for DB aircraft
export async function migrateV7() {
  const client = await pool.connect()
  try {
    await client.query(`ALTER TABLE aircraft ADD COLUMN IF NOT EXISTS mode_s_hex TEXT`)
  } finally {
    client.release()
  }
}

// V6: OpenSky response cache — avoid re-spending credits on immutable historical data
export async function migrateV6() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS opensky_departures_cache (
        departure_icao  TEXT    NOT NULL,
        date_str        TEXT    NOT NULL,
        flights_json    JSONB   NOT NULL,
        fetched_at      TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (departure_icao, date_str)
      );

      CREATE TABLE IF NOT EXISTS opensky_tracks_cache (
        icao24          TEXT    NOT NULL,
        first_seen_unix BIGINT  NOT NULL,
        callsign        TEXT,
        path_json       JSONB   NOT NULL,
        fetched_at      TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (icao24, first_seen_unix)
      );
    `)
  } finally {
    client.release()
  }
}

// V5: FAA aircraft reference table (ACFTREF.txt) — seats, engine count, speed per type
export async function migrateV5() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS faa_acftref (
        code         TEXT PRIMARY KEY,
        mfr          TEXT,
        model        TEXT,
        type_aircraft TEXT,
        type_engine  TEXT,
        no_engines   SMALLINT,
        no_seats     SMALLINT,
        speed_kt     SMALLINT
      )
    `)
  } finally {
    client.release()
  }
}

// V4: remove the 20 seed flights inserted by migrate(), keep showcase + manual entries
export async function migrateV4() {
  const client = await pool.connect()
  try {
    // foreflight_source IS NULL  → old seed flights (inserted before the form existed)
    // foreflight_source = 'manual'   → user-added via the intake form (keep)
    // foreflight_source = 'showcase' → demo flight (keep)
    // foreflight_source = filename   → ForeFlight imports (keep)
    await client.query(`DELETE FROM flights WHERE foreflight_source IS NULL`)
  } finally {
    client.release()
  }
}

// V3: showcase flight with every field set + GPS track + approaches
export async function migrateV3() {
  const client = await pool.connect()
  try {
    // Idempotent — skip if showcase already exists
    const { rows: chk } = await client.query(
      `SELECT id FROM flights WHERE foreflight_source = 'showcase' LIMIT 1`
    )
    if (chk.length) return

    const { rows: [ac]  } = await client.query(`SELECT id FROM aircraft   WHERE tail_number = 'N5624H'`)
    const { rows: [ins] } = await client.query(`SELECT id FROM instructors WHERE name = 'Michael Torres'`)
    if (!ac || !ins) return

    // Fix existing seed flights: dual was stored as dual_given for a student (should be dual_received)
    await client.query(`
      UPDATE flights
         SET dual_received = dual_given, dual_given = 0
       WHERE instructor_id IS NOT NULL
         AND foreflight_source IS NULL
         AND dual_given > 0
         AND dual_received = 0
    `)

    const { rows: [f] } = await client.query(`
      INSERT INTO flights (
        date, aircraft_id, departure_icao, arrival_icao, via, training_type,
        total_duration, dual_given, dual_received, pic, sic, solo,
        cross_country, night, actual_instrument, instrument,
        takeoffs, landings, day_takeoffs, day_landings_full_stop,
        night_takeoffs, night_landings, night_landings_full_stop,
        holds, distance_nm, hobbs_start, hobbs_end, tach_start, tach_end,
        time_out, time_in, instructor_id, instructor_comments,
        flight_review, checkride, ipc, remarks, foreflight_source
      ) VALUES (
        '2026-05-10', $1, 'KSQL', 'KWVI', ARRAY['KHAF']::text[], 'instrument',
        2.3, 0, 2.3, 0, 0, 0,
        2.3, 0, 0.4, 1.2,
        1, 1, 1, 1,
        0, 0, 0,
        1, 68.4, 1842.4, 1844.7, 2103.2, 2105.1,
        '2026-05-10T14:30:00Z', '2026-05-10T16:48:00Z', $2,
        'Strong hold entry and correction on VOR hold at KWVI — excellent tracking within ±0.2 dots. ILS glideslope interception needs refinement; came in 0.5 dots high on first attempt and executed the missed approach correctly and promptly. Maintained altitude ±60ft in actual IMC over Half Moon Bay — impressive for student level. Partial panel recovery was clean. Recommend 1–2 more instrument sessions before IR checkride prep.',
        false, false, false,
        'Coastal XC instrument training: KSQL→KHAF→KWVI. Actual IMC (marine layer) over Half Moon Bay — 0.4h in actual conditions. VOR hold at KWVI before ILS. First approach went missed (glideslope 0.5 dots high at DH); second ILS to full stop. Good SFO Class B lateral boundary awareness throughout.',
        'showcase'
      ) RETURNING id`,
      [ac.id, ins.id]
    )

    // Two ILS approaches: one missed, one full stop
    await client.query(
      `INSERT INTO approaches (flight_id, approach_type, airport_icao, runway, circle_to_land)
       VALUES ($1,'ILS','KWVI','2',false), ($1,'ILS','KWVI','2',false)`,
      [f.id]
    )

    // GPS track: KSQL → KHAF → KWVI with VOR hold + missed approach + second ILS
    // [min_offset, lat, lon, alt_ft, spd_kt, trk_deg, vs_fpm]
    const wpts = [
      [0,   37.5119,-122.2498,  5,  0, 300,   0],  // KSQL ground
      [4,   37.5195,-122.2560,500, 62, 282, 480],  // Departure climb
      [9,   37.5200,-122.3200,2200, 95, 270, 340],  // Bay crossing
      [14,  37.5160,-122.4100,3400,100, 265, 180],  // Peninsula
      [18,  37.5134,-122.5006,3500,100, 220,   0],  // KHAF overhead (IMC begins)
      [24,  37.4550,-122.4850,3500, 98, 198,   0],  // Coast south
      [32,  37.3600,-122.3700,3800, 92, 152,  55],  // Turning inland
      [42,  37.2400,-122.1900,4400, 88, 140,  50],  // Mountains
      [52,  37.1300,-121.9800,3600, 95, 138, -70],  // Descending
      [60,  37.0400,-121.8900,2700, 90, 148, -90],  // Approaching KWVI area
      [67,  36.9800,-121.8350,2500, 88, 202, -45],  // VOR hold entry
      [73,  36.9300,-121.8200,2500, 88,  96,   0],  // Hold outbound turn
      [78,  36.9300,-121.7700,2500, 88,  22,   0],  // Hold inbound turn
      [84,  36.9800,-121.7900,2500, 88, 198,   0],  // Hold complete, cleared ILS
      [90,  36.9650,-121.7900,2000, 82, 192,-200],  // ILS intercept
      [95,  36.9530,-121.7900,1300, 78, 192,-310],  // On glideslope
      [99,  36.9450,-121.7900, 820, 76, 192,-400],  // Decision height → missed
      [102, 36.9370,-121.8010,1400, 92,  22, 650],  // Missed approach climb
      [107, 36.9150,-121.8350,2000, 90, 305, 180],  // Procedure turn outbound
      [112, 36.9500,-121.8450,2100, 82,  38,   0],  // Procedure turn inbound
      [117, 36.9700,-121.8200,1800, 80, 192,-250],  // Second ILS intercept
      [122, 36.9560,-121.7960,1100, 78, 192,-340],  // Glideslope stable
      [127, 36.9440,-121.7910, 560, 74, 192,-380],  // Short final
      [131, 36.9380,-121.7904, 230, 42, 192,-500],  // Flare
      [133, 36.9360,-121.7903, 163,  0, 192,-300],  // KWVI touchdown
    ]

    const base = new Date('2026-05-10T14:30:00Z').getTime()
    for (let i = 0; i < wpts.length - 1; i++) {
      const [t0,lat0,lon0,alt0,spd0,trk0,vs0] = wpts[i]
      const [t1,lat1,lon1,alt1,spd1,trk1,vs1] = wpts[i + 1]
      const steps = t1 - t0
      for (let s = 0; s < steps; s++) {
        const fr = s / steps
        await client.query(
          `INSERT INTO track_log_points
             (flight_id, ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            f.id,
            new Date(base + (t0 + s) * 60000).toISOString(),
            parseFloat((lat0 + (lat1 - lat0) * fr).toFixed(5)),
            parseFloat((lon0 + (lon1 - lon0) * fr).toFixed(5)),
            Math.round(alt0 + (alt1 - alt0) * fr),
            Math.round(spd0 + (spd1 - spd0) * fr),
            Math.round(trk0 + (trk1 - trk0) * fr),
            Math.round(vs0  + (vs1  - vs0)  * fr),
          ]
        )
      }
    }
    const lw = wpts[wpts.length - 1]
    await client.query(
      `INSERT INTO track_log_points
         (flight_id, ts, lat, lon, altitude_ft, groundspeed_kts, track_deg, vertical_speed_fpm)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [f.id, new Date(base + lw[0] * 60000).toISOString(), lw[1], lw[2], lw[3], lw[4], lw[5], lw[6]]
    )
  } finally {
    client.release()
  }
}
