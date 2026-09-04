import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windComponents, altimToInhg, densityAlt, flightCat, bestRunway, goNogo } from '../utils/wx.js'

// ── windComponents ────────────────────────────────────────────────────────────

test('windComponents: direct headwind (wind 360, runway 0)', () => {
  const c = windComponents(360, 10, 0)
  assert.equal(c.headwind, 10)
  assert.equal(c.crosswind, 0)
})

test('windComponents: direct headwind using 0° wind dir', () => {
  const c = windComponents(0, 10, 0)
  assert.equal(c.headwind, 10)
  assert.equal(c.crosswind, 0)
})

test('windComponents: pure crosswind from the right', () => {
  const c = windComponents(90, 10, 0)   // east wind, runway north
  assert.equal(c.crosswind, 10)
  assert.equal(c.headwind, 0)
})

test('windComponents: direct tailwind', () => {
  const c = windComponents(180, 10, 0)  // south wind, runway north
  assert.equal(c.headwind, -10)
  assert.equal(c.crosswind, 0)
})

test('windComponents: 45° gives equal components', () => {
  const c = windComponents(45, 10, 0)
  assert.equal(c.headwind, 7)
  assert.equal(c.crosswind, 7)
})

test('windComponents: landing on runway 13 with 310° wind = tailwind', () => {
  const c = windComponents(310, 10, 130)
  assert.ok(c.headwind < 0, 'expected tailwind')
  assert.ok(c.crosswind <= 1, 'expected near-zero crosswind')
})

test('windComponents: VRB returns zeros', () => {
  const c = windComponents('VRB', 15, 90)
  assert.equal(c.headwind, 0)
  assert.equal(c.crosswind, 0)
})

test('windComponents: calm (speed 0) returns zeros', () => {
  const c = windComponents(270, 0, 0)
  assert.equal(c.headwind, 0)
  assert.equal(c.crosswind, 0)
})

test('windComponents: null wind dir returns zeros', () => {
  const c = windComponents(null, 10, 90)
  assert.equal(c.headwind, 0)
  assert.equal(c.crosswind, 0)
})

// ── altimToInhg ───────────────────────────────────────────────────────────────

test('altimToInhg: standard pressure 1013.25 hPa = 29.92 inHg', () => {
  assert.ok(Math.abs(altimToInhg(1013.25) - 29.92) < 0.005)
})

test('altimToInhg: 1000 hPa ≈ 29.53 inHg', () => {
  assert.ok(Math.abs(altimToInhg(1000) - 29.53) < 0.01)
})

// ── densityAlt ────────────────────────────────────────────────────────────────

test('densityAlt: standard conditions at sea level = 0 ft', () => {
  // PA = 0 + (29.92-29.92)*1000 = 0; ISA=15; DA = 0 + 118.8*(15-15) = 0
  assert.equal(densityAlt(0, 29.92, 15), 0)
})

test('densityAlt: hot day raises density altitude above field elevation', () => {
  const daCool = densityAlt(133, 29.92, 20)
  const daHot  = densityAlt(133, 29.92, 38)
  assert.ok(daHot > daCool)
})

test('densityAlt: high elevation airport (KDEN) >> low elevation (KRHV)', () => {
  const daKrhv = densityAlt(133,  29.92, 25)
  const daKden = densityAlt(5430, 29.92, 25)
  assert.ok(daKden > daKrhv)
})

test('densityAlt: low pressure raises density altitude', () => {
  const daHigh = densityAlt(133, 30.5, 20)   // high pressure
  const daLow  = densityAlt(133, 29.0, 20)   // low pressure
  assert.ok(daLow > daHigh)
})

// ── flightCat ─────────────────────────────────────────────────────────────────

test('flightCat: unlimited ceiling and vis = VFR', () => {
  assert.equal(flightCat(null, null), 'VFR')
})

test('flightCat: 5000 ft / 10 SM = VFR', () => {
  assert.equal(flightCat(5000, 10), 'VFR')
})

test('flightCat: 2500 ft ceiling = MVFR', () => {
  assert.equal(flightCat(2500, 10), 'MVFR')
})

test('flightCat: 4 SM vis = MVFR', () => {
  assert.equal(flightCat(5000, 4), 'MVFR')
})

test('flightCat: 800 ft / 2 SM = IFR', () => {
  assert.equal(flightCat(800, 2), 'IFR')
})

test('flightCat: 300 ft / 0.5 SM = LIFR', () => {
  assert.equal(flightCat(300, 0.5), 'LIFR')
})

test('flightCat: 999 ft ceiling = IFR (boundary)', () => {
  assert.equal(flightCat(999, 10), 'IFR')
})

test('flightCat: 1000 ft ceiling = MVFR (boundary)', () => {
  assert.equal(flightCat(1000, 10), 'MVFR')
})

test('flightCat: 2999 ft ceiling = MVFR (boundary)', () => {
  assert.equal(flightCat(2999, 10), 'MVFR')
})

test('flightCat: 3000 ft ceiling = VFR (boundary)', () => {
  assert.equal(flightCat(3000, 10), 'VFR')
})

// ── bestRunway ────────────────────────────────────────────────────────────────

const KRHV_RUNWAYS = [
  { le_ident: '13L', le_hdg: 130, he_ident: '31R', he_hdg: 310 },
  { le_ident: '13R', le_hdg: 130, he_ident: '31L', he_hdg: 310 },
]

test('bestRunway: direct headwind picks that runway end', () => {
  const b = bestRunway(310, 10, KRHV_RUNWAYS)
  assert.equal(b.hdg, 310)
  assert.ok(b.headwind > 0)
  assert.ok(b.crosswind <= 1)
})

test('bestRunway: tailwind from opposite → picks headwind side', () => {
  // Wind from 130 = tailwind on 13, headwind on 31
  const b = bestRunway(310, 10, KRHV_RUNWAYS)
  assert.equal(b.hdg, 310)
})

test('bestRunway: prefers headwind over tailwind', () => {
  const runways = [{ le_ident: '09', le_hdg: 90, he_ident: '27', he_hdg: 270 }]
  // Wind from west (270°) = headwind on runway 27
  const b = bestRunway(270, 10, runways)
  assert.equal(b.hdg, 270)
  assert.ok(b.headwind > 0)
})

test('bestRunway: empty array returns null', () => {
  assert.equal(bestRunway(270, 10, []), null)
})

test('bestRunway: VRB wind still returns a runway (no wind preference)', () => {
  const b = bestRunway('VRB', 10, KRHV_RUNWAYS)
  assert.ok(b !== null)
})

// ── goNogo ────────────────────────────────────────────────────────────────────

test('goNogo: VFR no crosswind = go', () => {
  assert.equal(goNogo('VFR', 5, null), 'go')
})

test('goNogo: MVFR = caut', () => {
  assert.equal(goNogo('MVFR', 5, null), 'caut')
})

test('goNogo: high crosswind (>10 kt) = caut', () => {
  assert.equal(goNogo('VFR', 11, null), 'caut')
})

test('goNogo: boundary crosswind (10 kt) = go', () => {
  assert.equal(goNogo('VFR', 10, null), 'go')
})

test('goNogo: high gust (>20 kt) = caut', () => {
  assert.equal(goNogo('VFR', 5, 21), 'caut')
})

test('goNogo: boundary gust (20 kt) = go', () => {
  assert.equal(goNogo('VFR', 5, 20), 'go')
})

test('goNogo: IFR = nogo', () => {
  assert.equal(goNogo('IFR', 0, null), 'nogo')
})

test('goNogo: LIFR = nogo', () => {
  assert.equal(goNogo('LIFR', 0, null), 'nogo')
})

test('goNogo: IFR overrides good crosswind', () => {
  assert.equal(goNogo('IFR', 2, null), 'nogo')
})
