import type { Pt, RunwayDef } from './geo'

// Real airport data (AirNav / Chart Supplement, checked 2026-10-16). Runway
// positions relative to each other are schematic, headings and lengths are real.
export interface Airport {
  icao: string
  name: string
  city: string
  elev: number
  tpa: number
  tpaNote: string
  towered: boolean
  freqs: { label: string; mhz: string; note?: string }[]
  wx: { kind: 'ASOS' | 'AWOS-3' | 'ATIS'; mhz: string; phone?: string }
  runways: RunwayDef[]
  circle?: Pt
  remarks: string[]
  water?: Pt[]
  waterLabel?: string
  ridges?: { path: Pt[]; label: string }[]
  classD?: number
}

export const AIRPORTS: Record<string, Airport> = {
  KWVI: {
    icao: 'KWVI', name: 'Watsonville Municipal', city: 'Watsonville, CA', elev: 163, tpa: 1165,
    tpaNote: 'Not published; standard 1,000 ft AGL (AC 90-66)', towered: false,
    freqs: [{ label: 'CTAF/UNICOM', mhz: '122.8' }, { label: 'ASOS', mhz: '132.275', note: '831-724-8794' }, { label: 'NorCal APP', mhz: '127.15' }],
    wx: { kind: 'ASOS', mhz: '132.275', phone: '831-724-8794' },
    runways: [
      { ends: ['2', '20'], hdg: 18, lengthFt: 4502, widthFt: 149, center: [0.05, 0.02], traffic: ['L', 'L'], displacedFt: [0, 589] },
      { ends: ['9', '27'], hdg: 86, lengthFt: 3998, widthFt: 98, center: [-0.12, -0.18], traffic: ['L', 'L'] },
    ],
    circle: [0.32, 0.12],
    remarks: [
      'SEAGULLS ON & INVOF ARPT.',
      'ALL DEPS PROHIBITED ON RWY 27 DUE TO RWY VIS BLOCKED BY HNGRS.',
      '130 FT TREES 700 FT RIGHT OF RWY 9 THLD, 85 FT TREES 600 FT LEFT OF RWY 9 THLD.',
      'ARPT HAS NOISE ABATEMENT PROCS; SEE ARPT WEBSITE.',
      'RWY 20 PREF CALM WIND RWY; STRAIGHT-IN APCH NOT RCMDD.',
      'HELICOPTER ACTVTY ON AND INVOF ARPT.',
      'COASTAL FOG DURING SUMMER MONTHS.',
      'PRCHT OPS ON ARPT DLY 0900-2000; LNDG AREA 1000 FT WEST OF RWY 20.',
      'RWY 20 PAPI UNUSBL BYD 4.0 NM DUE TO TERRAIN.',
    ],
    waterLabel: 'Monterey Bay',
    water: [[-12, 6], [-6.2, 3.5], [-5.6, 0], [-5.4, -3], [-5.9, -6], [-12, -8]],
  },
  KRHV: {
    icao: 'KRHV', name: 'Reid-Hillview of Santa Clara County', city: 'San Jose, CA', elev: 135, tpa: 1135,
    tpaNote: '1,000 ft AGL; tower may assign another altitude', towered: true,
    freqs: [
      { label: 'ATIS', mhz: '125.2' }, { label: 'Tower 13L/31R', mhz: '119.8' }, { label: 'Tower 13R/31L', mhz: '126.1' },
      { label: 'Ground', mhz: '121.65' }, { label: 'CTAF (tower closed)', mhz: '119.8' }, { label: 'UNICOM', mhz: '122.95' }, { label: 'NorCal APP', mhz: '120.1' },
    ],
    wx: { kind: 'ATIS', mhz: '125.2' },
    runways: [
      { ends: ['13L', '31R'], hdg: 127, lengthFt: 3100, widthFt: 75, center: [0.07, 0.05], traffic: ['L', 'R'], displacedFt: [499, 410] },
      { ends: ['13R', '31L'], hdg: 127, lengthFt: 3099, widthFt: 75, center: [-0.07, -0.05], traffic: ['R', 'L'], displacedFt: [499, 409] },
    ],
    circle: [-0.3, 0.2],
    remarks: [
      'TWR 0700-2200. CTAF 119.8 WHEN TWR CLSD.',
      'RY 31R CALM WIND RY WHEN ATCT CLSD.',
      'TOUCH-AND-GO NOT PERMITTED 2100-0700.',
      'BIRDS ON AND INVOF ARPT.',
      'SIMULATED EMERGENCIES NOT PERMITTED IN THE AIRPORT TRAFFIC AREA.',
      'BE ALERT ALL PILOTS - DO NOT CONFUSE ILLUMINATION FROM STREET LGTS NE OF AND PARALLEL TO THE RWYS WITH RWY LGTS.',
      'OPERATE TRANSPONDERS WITH ALTITUDE REPORTING MODE AND ADS-B (IF EQUIPPED) ENABLED ON ALL AIRPORT SURFACES.',
      'DEPS AVOID TURNS BLW 500 FT AFTER LEAVING THE PATTERN EXCEPT RWY 31R.',
    ],
    ridges: [{ path: [[3.2, 5.5], [4, 2], [4.6, -1.5], [5.5, -5]], label: 'Diablo Range foothills' }],
    classD: 4,
  },
  KHAF: {
    icao: 'KHAF', name: 'Half Moon Bay', city: 'Half Moon Bay, CA', elev: 66, tpa: 1000,
    tpaNote: '1,000 ft MSL (published)', towered: false,
    freqs: [{ label: 'CTAF/UNICOM', mhz: '122.8' }, { label: 'AWOS-3', mhz: '127.275', note: '650-728-5649' }, { label: 'NorCal APP', mhz: '135.1' }],
    wx: { kind: 'AWOS-3', mhz: '127.275', phone: '650-728-5649' },
    runways: [{ ends: ['12', '30'], hdg: 122, lengthFt: 5000, widthFt: 150, center: [0, 0], traffic: ['L', 'R'], displacedFt: [752, 762] }],
    circle: [0.35, 0.3],
    remarks: [
      'AVOID FLYING DIRECTLY OVER THE PILLAR POINT AIR FORCE STATION.',
      'ARPT NOISE SENSITIVE AREAS NW THRU NE.',
      'UNEXPECTED TURBULENT CONDS MAY BE ENCTRD WHILE ON FNA TO RWY 12.',
      'RWY 12: 70 FT TREES 1390 FT FROM RWY, 270 FT R OF CNTRLN.',
    ],
    waterLabel: 'Pacific Ocean',
    water: [[-14, 9], [-2.2, 2.2], [-0.75, 0.5], [-0.35, -0.5], [-0.6, -1.3], [-0.2, -1.6], [0.5, -2.2], [1.6, -4.2], [3, -8], [-14, -10]],
    ridges: [{ path: [[1.5, 6], [3.2, 3], [4.6, 0], [6, -3.5]], label: 'Coast Range ridge ~1,900–2,400 ft' }],
  },
  KTCY: {
    icao: 'KTCY', name: 'Tracy Municipal', city: 'Tracy, CA', elev: 194, tpa: 1000,
    tpaNote: '1,000 ft MSL (published)', towered: false,
    freqs: [{ label: 'CTAF/UNICOM', mhz: '123.075' }, { label: 'AWOS-3', mhz: '118.375', note: '209-831-4335' }, { label: 'NorCal APP', mhz: '123.85' }],
    wx: { kind: 'AWOS-3', mhz: '118.375', phone: '209-831-4335' },
    runways: [
      { ends: ['12', '30'], hdg: 117, lengthFt: 4001, widthFt: 75, center: [0, 0.05], traffic: ['L', 'L'], displacedFt: [0, 261] },
      { ends: ['8', '26'], hdg: 75, lengthFt: 3438, widthFt: 75, center: [-0.05, -0.2], traffic: ['L', 'L'] },
    ],
    circle: [0.3, -0.2],
    remarks: [
      'BALLOON AND PARAPLANE ACTIVITY ON THE AIRPORT.',
      'AEROBATIC AREA ADJ/WI 1 SMR FROM 500 AGL - 3000 MSL SR-SS.',
      'TWO 150 FT PWR PLANT STACKS APPROX 3 NM NW OF ARPT. WATCH FOR PSBL TURB.',
      'PAPI RWY 30 IS OPRD AT NGT BY CTAF FROM SS TO SR AND IS ON DRG DALGT HRS.',
    ],
    ridges: [{ path: [[-11, 6], [-9.5, 2], [-8.8, -2], [-9.5, -6]], label: 'Altamont Pass hills · wind turbines' }],
  },
}
