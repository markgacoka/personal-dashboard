// POH spec sheets read from the book's text, checked against values typed by
// hand from the 1976 172M and 1982 172P books and the 1995 PA-28-161 book.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { specsFromText } from '../services/pohSpecs.js'

const read = name => specsFromText(gunzipSync(readFileSync(new URL(`./fixtures/${name}`, import.meta.url))).toString().split('\f'))

describe('1976 Cessna 172M POH', () => {
  const s = read('poh172m-specs.txt.gz')
  test('engine and propeller', () => {
    assert.deepEqual([s.engine.model, s.engine.hp, s.engine.rpm, s.engine.displacement], ['O-320-E2D', 150, 2700, '320 cu in'])
    assert.deepEqual([s.propeller.make, s.propeller.model, s.propeller.blades, s.propeller.diameterIn], ['McCauley', '1C160/DTM7553', 2, [74, 75]])
  })
  test('oil', () => {
    assert.deepEqual([s.oil.sumpQt, s.oil.totalQt, s.oil.minQt, s.oil.extendedQt, s.oil.maxTempF], [8, 9, 6, 8, 245])
    assert.deepEqual(s.oil.pressurePsi, { min: 25, green: [60, 90], max: 100 })
  })
  test('fuel', () => {
    assert.deepEqual(s.fuel.tanks.map(t => [t.key, t.total, t.usable, t.unusable]), [['standard', 42, 38, 4], ['long', 52, 48, 4]])
    assert.deepEqual(s.fuel.grades[0], { grade: '80/87 (minimum)', color: 'Red' })
    assert.equal(s.fuel.selector, 'BOTH, RIGHT, LEFT, OFF.')
  })
  test('gear, tires, brakes, electrical', () => {
    assert.equal(s.gear.type, 'Fixed tricycle')
    assert.deepEqual(s.gear.tires, { nose: '31 psi · 5.00-5, 4-ply', main: '29 psi · 6.00-6, 4-ply' })
    assert.match(s.brakes.type, /^Single-disc, hydraulic/)
    assert.match(s.brakes.parking, /left side of the panel/)
    assert.deepEqual([s.electrical.volts, s.electrical.alternatorAmps, s.electrical.battery], [14, 60, '12 V, 25 Ah'])
    assert.match(s.pitotHeat, /^Optional/)
  })
  test('airspeeds', () => {
    assert.deepEqual(s.arcs, { white: [41, 85], green: [47, 128], yellow: [128, 160], red: 160 , unit: 'kt' })
    assert.deepEqual([s.limits.vne, s.limits.vno, s.limits.va], [160, 128, [[2300, 97], [1950, 89], [1600, 80]]])
    assert.deepEqual([s.speeds.vx, s.speeds.vy, s.speeds.glide, s.speeds.crosswind, s.speeds.shortApproach], [64, 78, 65, 15, 60])
  })
  test('stall speeds, load factors, summary', () => {
    assert.equal(s.stall.weight, 2300)
    assert.deepEqual(s.stall.rows.map(r => [r.flaps, r.aft[0], r.fwd[0]]), [['Up', 42, 47], ['10°', 38, 44], ['40°', 36, 41]])
    assert.deepEqual(s.loadFactors.normal, { weight: 2300, flapsUp: '+3.8 g / −1.52 g', flapsDown: '+3.0 g' })
    assert.equal(s.icing, 'Flight into known icing prohibited')
    assert.deepEqual(s.summary.find(x => /Service ceiling/.test(x.label)), { label: 'Service ceiling', value: '13,100 ft' })
    assert.equal(s.emptyStandard, 1387)
  })
})

describe('1982 Cessna 172P POH', () => {
  const s = read('poh172p-specs.txt.gz')
  test('engine, oil, fuel', () => {
    assert.deepEqual([s.engine.model, s.engine.hp], ['O-320-D2J', 160])
    assert.deepEqual([s.oil.sumpQt, s.oil.minQt, s.oil.extendedQt], [7, 5, 7])
    assert.deepEqual(s.oil.pressurePsi, { min: 25, green: [50, 90], max: 115 })
    assert.deepEqual(s.fuel.tanks.map(t => [t.key, t.total, t.usable]), [['standard', 43, 40], ['long', 54, 50], ['integral', 68, 62]])
    assert.deepEqual(s.fuel.grades, [{ grade: '100LL', color: 'Blue' }, { grade: '100 (formerly 100/130)', color: 'Green' }])
  })
  test('tires, electrical, airspeeds', () => {
    assert.deepEqual(s.gear.tires, { nose: '34 psi · 5.00-5, 6-ply', main: '28 psi · 6.00-6, 4-ply' })
    assert.deepEqual([s.electrical.volts, s.electrical.alternatorAmps, s.electrical.battery], [28, 60, '24 V'])
    assert.deepEqual(s.arcs, { white: [33, 85], green: [44, 127], yellow: [127, 158], red: 158 , unit: 'kt' })
    assert.deepEqual(s.limits.vfe, [{ label: 'Flaps 10°', kias: 110 }, { label: 'Flaps 10°–30°', kias: 85 }])
    assert.deepEqual([s.speeds.vx, s.speeds.vy, s.speeds.shortApproach], [60, 76, 61])
  })
  test('stall speeds read through OCR misreads ("4B" for 48)', () => {
    assert.deepEqual(s.stall.rows.map(r => [r.flaps, ...r.aft]), [['Up', 44, 47, 52, 62], ['10°', 35, 38, 42, 49], ['30°', 33, 35, 39, 47]])
  })
})

describe('1995 Piper PA-28-161 POH (OCR of a scan)', () => {
  const s = read('pa28-161-specs.txt.gz')
  test('Piper\'s lettered lists', () => {
    assert.deepEqual([s.engine.make, s.engine.model, s.engine.hp, s.engine.rpm], ['Lycoming', 'O-320-D3G', 160, 2700])
    assert.deepEqual([s.propeller.make, s.propeller.model, s.propeller.diameterIn, s.propeller.type], ['Sensenich', '74DM6-0-60', [72, 74], 'Fixed pitch'])
    assert.deepEqual(s.fuel.tanks.map(t => [t.total, t.usable]), [[50, 48]])
    assert.deepEqual([s.oil.sumpQt, s.oil.minQt], [8, 2])
  })
  test('gear, brakes, electrical and airspeeds', () => {
    assert.deepEqual(s.gear.tires, { nose: '30 psi · 5.00x5, 4-ply', main: '24 psi · 6.00x6, 4-ply' })
    assert.match(s.brakes.parking, /Hand brake lever/)
    assert.deepEqual([s.electrical.volts, s.electrical.alternatorAmps], [28, 60])
    assert.deepEqual(s.arcs, { white: [44, 103], green: [50, 126], yellow: [126, 160], red: 160 , unit: 'kt' })
    assert.deepEqual([s.speeds.vx, s.speeds.vy, s.speeds.crosswind], [63, 79, 17])
  })
  test('what the scan lost is left out, not guessed', () => {
    assert.equal(s.stall, null)
    assert.equal(s.icing, null)
  })
})

describe('2005 Cessna 172S information manual', () => {
  const s = read('c172s-specs.txt.gz')
  test('fuel-injected engine, one tank system, U.S. quarts', () => {
    assert.deepEqual([s.engine.model, s.engine.hp, s.engine.displacement], ['IO-360-L2A', 180, '360 cu in'])
    assert.deepEqual(s.fuel.tanks.map(t => [t.total, t.usable]), [[56, 53]])
    assert.deepEqual([s.oil.sumpQt, s.oil.totalQt, s.oil.minQt, s.oil.extendedQt], [8, 9, 5, 8])
  })
  test('airspeed limitations with a two-line window-open row', () => {
    assert.deepEqual(s.limits, { vne: 163, vno: 129, va: [[2550, 105], [2200, 98], [1900, 90]], vfe: [{ label: 'Flaps 10°', kias: 110 }, { label: 'Flaps 10°–full', kias: 85 }], windowOpen: 163 })
    assert.deepEqual([s.speeds.vx, s.speeds.vy], [62, 74])
    assert.deepEqual(s.arcs, { white: [40, 85], green: [48, 129], yellow: [129, 163], red: 163 , unit: 'kt' })
  })
})

describe('1979 Cessna 152 POH', () => {
  const s = read('c152-specs.txt.gz')
  test('engine, tanks, limits', () => {
    assert.deepEqual([s.engine.model, s.engine.hp, s.engine.rpm], ['O-235-L2C', 110, 2550])
    assert.deepEqual(s.fuel.tanks.map(t => [t.key, t.total, t.usable]), [['standard', 26, 24.5], ['long', 39, 37.5]])
    assert.deepEqual([s.limits.vne, s.limits.vno, s.limits.va[0]], [149, 111, [1670, 104]])
    assert.deepEqual([s.speeds.vx, s.speeds.vy, s.speeds.crosswind], [55, 67, 12])
  })
  test('one set of load factors (the 152 is utility category only)', () => {
    assert.equal(s.loadFactors.single, true)
    assert.equal(s.loadFactors.normal.flapsUp, '+4.4 g / −1.76 g')
  })
})

describe('1978 Cessna 172N POH (rough OCR text layer)', () => {
  const s = read('c172n-specs.txt.gz')
  test('reads through glued words and letter-for-digit swaps', () => {
    assert.deepEqual([s.engine.model, s.engine.hp, s.engine.rpm], ['O-320-H2AD', 160, 2700]) // "HZAD", "27O0RPM"
    assert.deepEqual(s.arcs, { white: [41, 85], green: [47, 128], yellow: [128, 160], red: 160 , unit: 'kt' })
    assert.deepEqual([s.limits.vne, s.limits.vno, s.limits.windowOpen], [160, 128, 160]) // "KlAS", "MaximumStructural"
    assert.deepEqual(s.fuel.tanks.map(t => [t.total, t.usable]), [[43, 40], [54, 50]])
  })
  test('what the OCR lost stays out', () => {
    assert.equal(s.stall, null)
    assert.equal(s.speeds.vx, null)
  })
})

test('an MPH book\'s airspeed markings are converted to knots', () => {
  const s = specsFromText(['AIRSPEED INDICATOR MARKINGS\nMARKING   MPH VALUE OR RANGE\nWhite Arc   55 - 100\nGreen Arc   62 - 140\nYellow Arc  140 - 174\nRed Line    174\n'])
  assert.deepEqual(s.arcs, { white: [48, 87], green: [54, 122], yellow: [122, 151], red: 151, unit: 'mph' })
})
