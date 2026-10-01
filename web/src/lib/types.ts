// Response shapes of the existing API. Numeric Postgres columns arrive as
// strings; read them through num().

type Numeric = number | string | null

// ── Garmin ───────────────────────────────────────────────────────────────────
export interface Athlete { fullName?: string; displayName?: string; profileImageUrlSmall?: string; profileImageUrlMedium?: string }

export interface Activity {
  activityId: number
  activityName?: string
  description?: string
  startTimeLocal: string
  activityType?: { typeKey?: string }
  distance?: number
  duration?: number
  movingDuration?: number
  averageSpeed?: number
  maxSpeed?: number
  averageHR?: number
  maxHR?: number
  calories?: number
  elevationGain?: number
  steps?: number
  activityTrainingLoad?: number
  aerobicTrainingEffect?: number
  anaerobicTrainingEffect?: number
  aerobicTrainingEffectMessage?: string
  anaerobicTrainingEffectMessage?: string
  trainingEffectLabel?: string
  differenceBodyBattery?: number
  avgPower?: number
  normPower?: number
  maxPower?: number
  averageRunningCadenceInStepsPerMinute?: number
  avgStrideLength?: number
  avgGroundContactTime?: number
  avgVerticalOscillation?: number
  vO2MaxValue?: number
  hasPolyline?: boolean
  [k: `hrTimeInZone_${number}`]: number | undefined
  [k: `powerTimeInZone_${number}`]: number | undefined
}

export interface ActivitySplit {
  splitType: string
  noOfSplits?: number
  distance?: number
  duration?: number
  movingDuration?: number
  averageSpeed?: number
  averageMovingSpeed?: number
  averageHR?: number
  maxHR?: number
  averagePower?: number
  normalizedPower?: number
  averageRunCadence?: number
  calories?: number
}

export interface ActivityDetail {
  summaryDTO?: {
    minHR?: number; averagePower?: number; normalizedPower?: number; maxPower?: number
    averageSpeed?: number; maxSpeed?: number; averageRunCadence?: number; strideLength?: number
    groundContactTime?: number; verticalOscillation?: number; activityTrainingLoad?: number
    calories?: number; differenceBodyBattery?: number; totalWork?: number; steps?: number
  }
  splitSummaries?: ActivitySplit[]
  metadataDTO?: { lapCount?: number }
}

export interface ActivityGpx { count: number; points: [number, number, number | null][] }

export interface SleepDTO {
  sleepTimeSeconds?: number
  deepSleepSeconds?: number
  lightSleepSeconds?: number
  remSleepSeconds?: number
  awakeSleepSeconds?: number
  awakeCount?: number
  sleepStartTimestampLocal?: number
  sleepEndTimestampLocal?: number
  sleepScores?: { overall?: { value?: number; qualifierKey?: string } }
  averageSpO2Value?: number
  averageRespirationValue?: number
  avgSleepStress?: number
  avgHeartRate?: number
}

export interface DailyStats {
  date?: string
  steps?: unknown
  heart_rate?: { restingHeartRate?: number; lastSevenDaysAvgRestingHeartRate?: number } | null
  sleep?: { dailySleepDTO?: SleepDTO; wellnessSpO2SleepSummaryDTO?: { averageSPO2?: number } } | null
  vo2max?: number | null
  hrv?: { hrvSummary?: { status?: string; lastNightAvg?: number; weeklyAvg?: number } } | null
  daily_summary?: { bodyBatteryMostRecentValue?: number; totalSteps?: number; restingHeartRate?: number } | null
}

export interface SleepLatest {
  date: string
  dailySleepDTO?: SleepDTO
  sleepLevels?: { startGMT: string; endGMT: string; activityLevel: number }[]
  hrvData?: { value: number | null; startGMT: string }[]
}

export interface SleepTrendRow {
  date: string
  duration_sec?: number | null
  deep_sec?: number | null
  light_sec?: number | null
  rem_sec?: number | null
  awake_sec?: number | null
  score?: number | null
  score_qualifier?: string | null
  avg_hr?: Numeric
  avg_hrv?: Numeric
}

// ── Flying ───────────────────────────────────────────────────────────────────
export interface Airport { icao: string; name?: string; city?: string; state?: string; lat?: number; lon?: number; elevation_ft?: number }

export interface AircraftRef {
  id: number; tail_number: string; make?: string; model?: string; year?: number | null
  engine_type?: string | null; engine_hp?: number | null; seats?: number | null; mode_s_hex?: string | null
}

export interface Approach { approach_type: string; airport_icao: string; runway?: string | null; circle_to_land?: boolean }

export interface Flight {
  id: number
  date: string
  via: string[] | null
  training_type: string | null
  total_duration: Numeric
  dual_given: Numeric
  dual_received: Numeric
  pic: Numeric
  sic: Numeric
  solo: Numeric
  cross_country: Numeric
  night: Numeric
  actual_instrument: Numeric
  simulated_instrument: Numeric
  takeoffs: number | null
  landings: number | null
  day_takeoffs: number | null
  day_landings_full_stop: number | null
  night_takeoffs: number | null
  night_landings: number | null
  night_landings_full_stop: number | null
  holds: number | null
  distance_nm: Numeric
  hobbs_start: Numeric
  hobbs_end: Numeric
  tach_start: Numeric
  tach_end: Numeric
  time_out: string | null
  time_in: string | null
  flight_review: boolean | null
  checkride: boolean | null
  ipc: boolean | null
  source: string | null
  remarks: string | null
  instructor_comments: string | null
  instructor_id: number | null
  instructor_name: string | null
  has_track: boolean
  track_source: string | null
  departure: Airport
  arrival: Airport
  via_airports: Airport[]
  aircraft: AircraftRef
  approaches: Approach[]
}

export interface LogbookStats {
  total_flights: number
  total_hours: Numeric
  dual_given: Numeric
  dual_received: Numeric
  pic: Numeric
  solo: Numeric
  cross_country: Numeric
  night: Numeric
  actual_instrument: Numeric
  simulated_instrument: Numeric
  total_takeoffs: number
  total_landings: number
  night_landings: number
  total_holds: number
  total_approaches: number
  airports_visited: number
}

export interface Instructor { id: number; name: string; certificate?: string | null; rating?: string | null }

export interface TrackPoint { ts: string; lat: number; lon: number; altitude_ft: number | null; groundspeed_kts: number | null; track_deg: number | null; vertical_speed_fpm: number | null; source?: string }

export interface TrackStats {
  max_altitude_ft?: number; max_groundspeed_kts?: number; avg_groundspeed_kts?: number
  max_climb_fpm?: number; max_descent_fpm?: number; distance_nm?: number; track_points?: number; duration_min?: number
}

export interface NiceAirSchedule {
  type?: string; date_str: string; tail: string; pilot?: string; cfi?: string
  start_local?: string; end_local?: string; received?: string; subject?: string
}

export interface AircraftRegistry {
  tail_number?: string; make?: string; model?: string; year?: number; serial?: string
  engine_type?: string; engine_hp?: number; category?: string; aircraft_class?: string
  gear_type?: string; seats?: number; is_complex?: boolean; status?: string; mode_s_hex?: string
  owner?: string; photo_url?: string
  performance?: {
    mtow_lbs?: number; cruise_ktas?: number; service_ceiling_ft?: number; range_nm?: number
    fuel_gal?: number; fuel_burn_gph?: number; vne_kts?: number; vno_kts?: number; vx_kts?: number
    vy_kts?: number; vs0_kts?: number; vs1_kts?: number; va_kts?: number
  }
}

export interface Metar {
  rawOb?: string; raw?: string; fltcat?: string
  wdir?: number | 'VRB' | null; wspd?: number | null; wgst?: number | null
  visib?: number | string | null; ceil?: number | null
  temp?: number | null; dewp?: number | null; altim?: number | null; obsTime?: string | number
}

export interface AirportInfo { name?: string; city?: string; state?: string; elev?: number | null }

export interface Runway { le_ident: string; le_hdg: number; he_ident: string; he_hdg: number; length_ft?: number; surface?: string }
export interface AirportDetail { runways: Runway[]; frequencies: { type: string; freq_mhz: string }[] }

export interface TafForecast { type?: string; from?: string; to?: string; wdir?: number | string | null; wspd?: number | null; wgst?: number | null; visib?: string | number | null; clouds?: string; wx?: string; fltcat?: string }
export interface Taf { fcsts?: TafForecast[]; raw?: string }

export interface Notam { id?: string; type?: string; text?: string; endDate?: string }
export interface NotamResponse { count: number; notams: Notam[]; unavailable?: boolean }

// ── Money ────────────────────────────────────────────────────────────────────
export interface FinAccount { account_id: string; name: string; type: string; subtype: string | null; institution: string | null; balance: Numeric; available?: Numeric }
export interface NetWorth {
  total: number; prev: number; delta: number
  byType: { liquid: number; invested: number; retirement: number }
  accounts: FinAccount[]
  history: { date: string; total: Numeric }[]
}
export interface Holding {
  account_id: string; security_id?: string; name: string | null; ticker: string | null; type?: string | null
  quantity: Numeric; price: Numeric; value: Numeric; cost_basis: Numeric
  institution: string | null; account_name: string | null
}
export interface PlaidItem { id: number; item_id: string; institution: string | null; created_at: string }

// ── Chess ────────────────────────────────────────────────────────────────────
export interface ChessMonth { month?: string; count: number; win: number; loss: number; draw: number; ratingStart: number | null; ratingEnd: number | null }
export interface ChessGame { ts: number; rating: number; result: 'W' | 'L' | 'D'; color: 'w' | 'b'; opponent: string; oppRating: number; url: string }
export interface ChessTimeClass {
  current: number | null; best: number | null
  record: { win: number; loss: number; draw: number }
  thisMonth: ChessMonth; lastMonth: ChessMonth; recent: ChessGame[]
}
export interface ChessStats {
  username: string; league?: string; lastOnline?: number; joined?: number; avatar?: string
  rapid: ChessTimeClass; blitz: ChessTimeClass
  tactics: { highest: number | null }; puzzleRush: { best: number | null }
}
