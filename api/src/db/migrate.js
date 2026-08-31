import { pool } from './client.js'

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
  },
  {
    tail_number: 'N4786H',
    make: 'Piper', model: 'PA-28-161', year: 2005,
    engine_type: 'Lycoming O-320-D3G',
    engine_hp: 160, seats: 4,
    ifr_equipped: false, glass_cockpit: false,
    notes: 'Warrior II. VSO=49kt, VS=55kt, VX=63kt, VY=79kt. Used for instrument ground reference.',
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
