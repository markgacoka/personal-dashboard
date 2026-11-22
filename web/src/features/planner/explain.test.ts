import { describe, expect, test } from 'vitest'
import { derive, DEFAULT_MINIMUMS, type Airport, type Plan, type WeatherBundle } from './model'
import { profileFor } from './poh'
import { explainRow, explainWb, inputSources } from './explain'

const NOW = Date.parse('2026-11-04T20:00:00Z')
const apt = (id: string, lat: number, lon: number, elev: number, hdg: number): Airport => ({
  id, icao: `K${id}`, name: id, city: '', state: 'CA', lat, lon, elev, tpaAgl: 1000, magVar: 13, use: 'PU', towered: true, towerCall: id, towerHrs: null,
  segCircle: true, windIndicator: null, lights: null, frequencies: [], wx: null, remarks: [], airspace: null, cycle: '', approach: null, sun: null,
  runways: [{ id: 'X', len: 4000, wid: 75, surface: 'ASPH', cond: null, lights: null, ends: [{ id: 'A', trueHdg: hdg, right: false, lat: null, lon: null, elev: null, displaced: 0, vgsi: null, lda: null }] }],
})
const A = apt('RHV', 37.333, -121.82, 135, 143), B = apt('SNS', 36.663, -121.606, 85, 98)
const plan: Plan = { name: 't', route: ['KRHV', 'KSNS'], alternate: null, departLocal: '2026-11-04T21:00:00Z', rpm: 2400, tail: 'N1', loads: { front: 340, rear: 0, bag1: 0, bag2: 0 }, fuelGal: 40, stopMinutes: 0, night: false }
const winds: WeatherBundle['winds'] = [{ fcst: 'model', fetchedAt: '2026-11-04T19:50:00Z', data: [{ basedOn: '', valid: '042100', forUse: ['1800', '2400'], levels: [3000, 6000], source: 'NOAA HRRR/GFS model winds (Open-Meteo)', stations: { P: { lat: 37, lon: -121.7, winds: { 3000: { dir: 300, spd: 15, temp: 10 }, 6000: { dir: 300, spd: 20, temp: 4 } } } } }] }]
const empty = { data: [], fetchedAt: '' }
const d = derive(plan, {
  airports: [A, B], match: profileFor('172P'), planning: {}, minimums: DEFAULT_MINIMUMS, terrain: null, currency: [], airspace: null, now: NOW,
  weather: { metars: empty, tafs: empty, pireps: empty, sigmets: empty, gairmets: empty, cwas: empty, winds, nas: { data: null, fetchedAt: '' }, tfrs: empty },
})
const x = { d, plan, weather: null, pohClosest: false }

describe('explainRow', () => {
  const cruise = d.navlog.find(r => r.phase === 'cruise')!
  const cards = explainRow(x, cruise)
  test('one card per quantity, in working order', () => {
    expect(cards.map(c => c.key)).toEqual(['course', 'wind', 'tas', 'heading', 'time', 'fuel'])
  })
  test('the forecast is the primary source, with its backup named', () => {
    const w = cards.find(c => c.key === 'wind')!
    expect(w.source.tier).toBe('primary'); expect(w.source.used).toContain('1800–2400Z'); expect(w.source.backup).toMatch(/briefing/)
  })
  test('the expected ranges hold for a sane row', () => {
    for (const c of cards) expect(c.expect.ok).not.toBe(false)
  })
})

describe('explainWb and inputSources', () => {
  test('the sample empty weight is a stand-in', () => {
    expect(explainWb(x, d.wb.steps[0], 0).source.tier).toBe('standin')
    expect(inputSources(x).find(s => s.key === 'empty')?.tier).toBe('standin')
  })
  test('a total shows its sum and CG', () => {
    const i = d.wb.steps.findIndex(s => s.total)
    const e = explainWb(x, d.wb.steps[i], i)
    expect(e.steps[0].v).toMatch(/ = [\d,]+ lb$/); expect(e.expect.ok).toBe(true)
  })
  test('winds aloft come from the model', () => {
    expect(inputSources(x).find(s => s.key === 'winds')).toMatchObject({ tier: 'primary', value: 'NOAA model' })
  })
})
