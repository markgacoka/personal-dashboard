// What the POH says about the airplane itself: engine, propeller, oil, fuel
// system, landing gear, brakes, electrical, airspeed markings, stall speeds,
// load factors and the published performance summary. Transcribed from each
// book's Sections 1, 2, 5, 7 and 8 (the page reference is kept on every group).

export interface StallRow { flaps: string; aft: number[]; fwd: number[] } // KIAS at 0°, 30°, 45°, 60° bank
export interface AircraftSpecs {
  variant: string
  book: string
  engine: { make: string; model: string; hp: number; rpm: number; type: string; displacement: string; ref: string }
  propeller: { make: string; model: string; blades: number; diameterIn: [number, number]; type: string; groundClearance?: string; ref: string }
  oil: { sumpQt: number; totalQt: number; minQt: number; extendedQt: number; spec: string; viscosity: string[]; pressurePsi: { min: number; green: [number, number]; max: number }; maxTempF: number; ref: string }
  fuel: {
    tanks: { key: string; label: string; total: number; each: number; usable: number; unusable: number }[]
    grades: { grade: string; color: string }[]; gradeNote?: string
    system: string; selector: string; ref: string
  }
  gear: { type: string; shock: string; nose: string; tires: { nose: string; main: string }; strut: string; ref: string }
  brakes: { type: string; parking: string; fluid: string; ref: string }
  electrical: { volts: number; alternatorAmps: number; battery: string; bus: string; warning: string; ref: string }
  pitotHeat: string
  arcs: { white: [number, number]; green: [number, number]; yellow: [number, number]; red: number; ref: string }
  vfe: { label: string; kias: number }[]
  windowOpenKias: number
  stall: { weight: number; rows: StallRow[]; altitudeLoss: string; ref: string }
  loadFactors: { normal: { weight: number; flapsUp: string; flapsDown: string }; utility: { weight: number; flapsUp: string; flapsDown: string }; ref: string }
  icing: string
  tach: { label: string; green: [number, number] }[]
  dims: { wingAreaSqFt: number; wheelBaseIn: number; turningRadius?: string }
  summary: { label: string; value: string }[]
  emptyStandard: number
}

const OIL_SPEC = 'MIL-L-6082 straight mineral oil for break-in (first 50 h), then MIL-L-22851 ashless dispersant'

export const SPECS: Record<string, AircraftSpecs> = {
  '172P': {
    variant: '172P',
    book: '1982 Cessna 172P POH',
    engine: { make: 'Avco Lycoming', model: 'O-320-D2J', hp: 160, rpm: 2700, type: 'Normally aspirated, direct drive, air cooled, horizontally opposed, carbureted, four cylinders', displacement: '319.8 cu in', ref: 'Sec. 1' },
    propeller: { make: 'McCauley', model: '1C160/DTM7557', blades: 2, diameterIn: [74, 75], type: 'Fixed pitch', ref: 'Sec. 1, 2' },
    oil: {
      sumpQt: 7, totalQt: 8, minQt: 5, extendedQt: 7, spec: OIL_SPEC,
      viscosity: ['SAE 20W-50 at all temperatures', 'SAE 40 or 50 above 16 °C (60 °F)', 'SAE 40 from −1 to 32 °C (30–90 °F)', 'SAE 30 or 40 from −18 to 21 °C (0–70 °F)', 'SAE 30 below −12 °C (10 °F)'],
      pressurePsi: { min: 25, green: [50, 90], max: 115 }, maxTempF: 245, ref: 'Sec. 1, 2, 8',
    },
    fuel: {
      tanks: [
        { key: 'standard', label: 'Standard tanks', total: 43, each: 21.5, usable: 40, unusable: 3 },
        { key: 'long', label: 'Long-range tanks', total: 54, each: 27, usable: 50, unusable: 4 },
        { key: 'integral', label: 'Integral tanks', total: 68, each: 34, usable: 62, unusable: 6 },
      ],
      grades: [{ grade: '100LL', color: 'Blue' }, { grade: '100 (formerly 100/130)', color: 'Green' }],
      system: 'Two vented wing tanks feed by gravity through a strainer to the carburetor; manual primer. No fuel pump.',
      selector: 'Four positions: BOTH, RIGHT, LEFT, OFF. Takeoff and landing on BOTH.',
      ref: 'Sec. 1, 2, 7',
    },
    gear: { type: 'Fixed tricycle', shock: 'Tubular spring-steel main struts; air/oil nose strut', nose: 'Steerable through the rudder pedals', tires: { nose: '34 psi · 5.00-5, 6-ply', main: '28 psi · 6.00-6, 4-ply' }, strut: '45 psi, MIL-H-5606 fluid', ref: 'Sec. 7, 8' },
    brakes: { type: 'Single-disc, hydraulic, on each main wheel; toe brakes on both sets of rudder pedals', parking: 'Handle under the left side of the panel: hold the toe brakes, pull aft, turn 90° down', fluid: 'MIL-H-5606', ref: 'Sec. 7, 8' },
    electrical: { volts: 28, alternatorAmps: 60, battery: '24 V (heavy-duty optional)', bus: 'Primary bus and avionics bus, joined by the avionics power switch', warning: 'Low-voltage light; over-voltage sensor shuts the alternator off', ref: 'Sec. 7' },
    pitotHeat: 'Optional (PITOT HT switch, 5 A breaker)',
    arcs: { white: [33, 85], green: [44, 127], yellow: [127, 158], red: 158, ref: 'Fig. 2-2' },
    vfe: [{ label: 'Flaps 10°', kias: 110 }, { label: 'Flaps 10–30°', kias: 85 }],
    windowOpenKias: 158,
    stall: {
      weight: 2400, altitudeLoss: 'Up to 230 ft in the recovery', ref: 'Fig. 5-3',
      rows: [
        { flaps: 'Up', aft: [44, 47, 52, 62], fwd: [44, 47, 52, 62] },
        { flaps: '10°', aft: [35, 38, 42, 49], fwd: [37, 40, 44, 52] },
        { flaps: '30°', aft: [33, 35, 39, 47], fwd: [33, 35, 39, 47] },
      ],
    },
    loadFactors: { normal: { weight: 2400, flapsUp: '+3.8 g / −1.52 g', flapsDown: '+3.0 g' }, utility: { weight: 2100, flapsUp: '+4.4 g / −1.76 g', flapsDown: '+3.0 g' }, ref: 'Sec. 2' },
    icing: 'Flight into known icing prohibited. Inadvertent icing: pitot heat on (if installed), turn back or change altitude, cabin heat and defrost full.',
    tach: [{ label: 'Sea level', green: [2100, 2450] }, { label: '5,000 ft', green: [2100, 2575] }, { label: '10,000 ft', green: [2100, 2700] }],
    dims: { wingAreaSqFt: 174, wheelBaseIn: 65 },
    summary: [
      { label: 'Maximum speed, sea level', value: '123 kt' }, { label: 'Cruise, 75 % at 8,000 ft', value: '120 kt' },
      { label: 'Range, 75 % at 8,000 ft, 40 gal', value: '440 nm · 3.8 h' }, { label: 'Range, best economy at 10,000 ft, 40 gal', value: '520 nm · 5.6 h' },
      { label: 'Climb rate, sea level', value: '700 fpm' }, { label: 'Service ceiling', value: '13,000 ft' },
      { label: 'Takeoff, ground roll / over 50 ft', value: '890 / 1,625 ft' }, { label: 'Landing, ground roll / over 50 ft', value: '540 / 1,280 ft' },
      { label: 'Wing / power loading', value: '13.8 lb/sq ft · 15.0 lb/hp' },
    ],
    emptyStandard: 1427,
  },
  '172M': {
    variant: '172M',
    book: '1976 Cessna 172M POH',
    engine: { make: 'Avco Lycoming', model: 'O-320-E2D', hp: 150, rpm: 2700, type: 'Normally aspirated, direct drive, air cooled, horizontally opposed, carbureted, four cylinders', displacement: '320 cu in', ref: 'Sec. 1' },
    propeller: { make: 'McCauley', model: '1C160/DTM7553', blades: 2, diameterIn: [74, 75], type: 'Fixed pitch', groundClearance: '11¾ in', ref: 'Sec. 1, 2' },
    oil: {
      sumpQt: 8, totalQt: 9, minQt: 6, extendedQt: 8, spec: OIL_SPEC,
      viscosity: ['SAE 50 above 16 °C (60 °F)', 'SAE 10W-30 or 30 from −18 to 21 °C (0–70 °F)', 'SAE 10W-30 or 20 below −12 °C (10 °F)'],
      pressurePsi: { min: 25, green: [60, 90], max: 100 }, maxTempF: 245, ref: 'Sec. 1, 2, 8',
    },
    fuel: {
      tanks: [
        { key: 'standard', label: 'Standard tanks', total: 42, each: 21, usable: 38, unusable: 4 },
        { key: 'long', label: 'Long-range tanks', total: 52, each: 26, usable: 48, unusable: 4 },
      ],
      grades: [{ grade: '80/87 (minimum)', color: 'Red' }, { grade: '100LL', color: 'Blue' }, { grade: '100 (formerly 100/130)', color: 'Green' }],
      gradeNote: 'The book lists 100/130 low-lead as green; today\'s 100LL is dyed blue.',
      system: 'Two vented wing tanks feed by gravity through a strainer to the carburetor; manual primer. No fuel pump.',
      selector: 'Four positions: BOTH, RIGHT, LEFT, OFF. Takeoff and landing on BOTH.',
      ref: 'Sec. 1, 2, 7',
    },
    gear: { type: 'Fixed tricycle', shock: 'Tubular spring-steel main struts; air/oil nose strut', nose: 'Steerable through the rudder pedals', tires: { nose: '31 psi · 5.00-5, 4-ply (26 psi on a 6.00-6)', main: '29 psi · 6.00-6, 4-ply' }, strut: '45 psi, MIL-H-5606 fluid', ref: 'Sec. 7, 8' },
    brakes: { type: 'Single-disc, hydraulic, on each main wheel; toe brakes on both sets of rudder pedals', parking: 'Handle under the left side of the panel: hold the toe brakes, pull aft, turn 90° down', fluid: 'MIL-H-5606', ref: 'Sec. 7, 8' },
    electrical: { volts: 14, alternatorAmps: 60, battery: '12 V, 25 Ah', bus: 'Split bus: electronics on one side, general circuits on the other', warning: 'Over-voltage light; the sensor shuts the alternator off near 16 V', ref: 'Sec. 7' },
    pitotHeat: 'Optional (PITOT HT switch, 10 A breaker)',
    arcs: { white: [41, 85], green: [47, 128], yellow: [128, 160], red: 160, ref: 'Fig. 2-2' },
    vfe: [{ label: 'Flaps 10–40°', kias: 85 }],
    windowOpenKias: 160,
    stall: {
      weight: 2300, altitudeLoss: 'About 180 ft in the recovery', ref: 'Fig. 5-3',
      rows: [
        { flaps: 'Up', aft: [42, 45, 50, 59], fwd: [47, 51, 56, 66] },
        { flaps: '10°', aft: [38, 40, 45, 54], fwd: [44, 47, 52, 62] },
        { flaps: '40°', aft: [36, 38, 43, 51], fwd: [41, 44, 49, 58] },
      ],
    },
    loadFactors: { normal: { weight: 2300, flapsUp: '+3.8 g / −1.52 g', flapsDown: '+3.0 g' }, utility: { weight: 2000, flapsUp: '+4.4 g / −1.76 g', flapsDown: '+3.0 g' }, ref: 'Sec. 2' },
    icing: 'Flight into known icing prohibited. Inadvertent icing: pitot heat on (if installed), turn back or change altitude, cabin heat and defrost full.',
    tach: [{ label: 'Sea level', green: [2200, 2500] }, { label: '5,000 ft', green: [2200, 2600] }, { label: '10,000 ft', green: [2200, 2700] }],
    dims: { wingAreaSqFt: 174, wheelBaseIn: 65, turningRadius: '27 ft 5½ in' },
    summary: [
      { label: 'Maximum speed, sea level', value: '125 kt' }, { label: 'Cruise, 75 % at 8,000 ft', value: '120 kt' },
      { label: 'Range, 75 % at 8,000 ft, 38 gal', value: '450 nm · 3.9 h' }, { label: 'Range, best economy at 10,000 ft, 38 gal', value: '480 nm · 4.8 h' },
      { label: 'Climb rate, sea level', value: '645 fpm' }, { label: 'Service ceiling', value: '13,100 ft' },
      { label: 'Takeoff, ground roll / over 50 ft', value: '865 / 1,525 ft' }, { label: 'Landing, ground roll / over 50 ft', value: '520 / 1,250 ft' },
      { label: 'Wing / power loading', value: '13.2 lb/sq ft · 15.3 lb/hp' },
    ],
    emptyStandard: 1387,
  },
}

export const variantOf = (model?: string | null) => { const m = String(model || '').toUpperCase().match(/172([A-Z])?/); return m ? `172${m[1] || ''}` : '' }
export const specsFor = (model?: string | null): AircraftSpecs | null => SPECS[variantOf(model)] ?? null
