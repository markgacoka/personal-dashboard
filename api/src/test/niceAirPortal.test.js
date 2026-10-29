// NICE AIR portal sync: export parsing, statement classification, and linking
// to logbook entries. Pure logic only; fixtures mirror the portal's formats.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseSheetXml, parseMeterRows, parseStatement, classifyCharge, linkToFlights, hobbsUpdate, isDue, METER_HEADER, STATEMENT_HEADER } from '../services/niceAirPortal.js'

const cell = v => typeof v === 'number' ? `<x:c t="n"><x:v>${v.toFixed(2)}</x:v></x:c>` : `<x:c t="str"><x:v>${v}</x:v></x:c>`
const sheet = rows => `<?xml version="1.0" encoding="utf-8"?><x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>${
  rows.map(r => `<x:row>${r.map(cell).join('')}</x:row>`).join('')}</x:sheetData></x:worksheet>`

describe('export parsing', () => {
  test('cells are unescaped twice and empty cells kept', () => {
    const rows = parseSheetXml(sheet([['Comment', 'CFI'], ['227AN 1.10 Hrs@178.00/Hr Hobbs=4579.6-&amp;gt;4580.7', '']]))
    assert.deepEqual(rows[1], ['227AN 1.10 Hrs@178.00/Hr Hobbs=4579.6->4580.7', ''])
  })

  test('My Flights rows: dates, tail, meter, CFI without the id', () => {
    const [dual, solo] = parseMeterRows(parseSheetXml(sheet([
      METER_HEADER,
      ['02/20/2026', '739HE', 162, 8996.5, 8997.5, 1, 'Yoon, Hyugjun (16536)'],
      ['02/20/2026', '739HE', 129.6, 8997.5, 8998.3, 0.8, ''],
    ])))
    assert.deepEqual(dual, { date_str: '2026-02-20', tail: '739HE', charge: 162, meter_start: 8996.5, meter_end: 8997.5, hours: 1, cfi: 'Yoon, Hyugjun' })
    assert.equal(solo.cfi, null)
  })

  test('a changed export layout is refused, not misread', () => {
    assert.throws(() => parseMeterRows([['Date', 'Tail', 'Charge'], ['10/22/2026', '227AN', '1']]), /Unexpected export columns/)
  })
})

describe('statement lines', () => {
  const line = (comment, { date = '10/22/2026', type = 'DEBIT', amount = '10.00' } = {}) =>
    classifyCharge({ Date: date, 'Activity Type': type, Amount: amount, Tax: '0.00', Comment: comment, 'Account Balance': '-10.00' })

  test('every format seen on the account is classified', () => {
    const kinds = {
      '227AN 1.10 Hrs@178.00/Hr Hobbs=4579.6->4580.7': 'aircraft',
      '739HE 1.50 Hrs@130.00/Hr Hobbs=8413.2->8414.7, addl. Fuelcharge $19.20': 'aircraft',
      'Corrected Rental 227AN..rmod.. on 8/29/2025  Hobbs=3169.5->3170.9': 'aircraft',
      'Instr(1.10hrs @ 65.00) CFI:Li-Cfi, Ye Flight Instruction > ': 'instruction',
      'Instr(2.80hrs @ 65.00) CFI:Kim-Cfi, Manjae Flight Instruction > XC training, 3 points KRHV-KMAE-KLSN': 'instruction',
      'Instr(1.50hrs @ 65) Yoon-Cfi, Hyug Jun -Flight-web': 'instruction',
      'Instr(0.20hrs @ 65.00) CFI:Li-Cfi, Ye Pre/Post Ground > ': 'ground',
      'Instr(1.00hrs @ 65) Yoon-Cfi, Hyug Jun -Pre/Post Ground-web': 'ground',
      'Instr(2.00hrs @ 65.00) CFI:Yoon-Cfi, Hyugjun Ground Instruction > airspace': 'ground',
      'Misc.-Non-Taxable Headset Rental on 10/22': 'misc',
      'Misc.-Non-Taxable 2ea Headset rental': 'misc',
    }
    for (const [comment, kind] of Object.entries(kinds)) assert.equal(line(comment).kind, kind, comment)
    assert.equal(line('Creditcard Payment (#masked or ref:****5375 card:MC)', { type: 'PAYMENT' }).kind, 'payment')
    assert.equal(line('Instr(1.10hrs @ 65.00) CFI:Li-Cfi, Ye Flight Instruction > ').hours, 1.1)
  })

  test('a misc item posted later belongs to the day it names', () => {
    assert.equal(line('Misc.-Non-Taxable Headset Rental on 10/22', { date: '10/23/2026' }).applies_on, '2026-10-22')
    assert.equal(line('Misc.-Non-Taxable Headset Rental on 12/31', { date: '01/02/2027' }).applies_on, '2026-12-31')
    assert.equal(line('Misc.-Non-Taxable Headset rental', { date: '10/23/2026' }).applies_on, '2026-10-23')
  })

  test('the statement export parses to dated lines', () => {
    const rows = parseStatement(parseSheetXml(sheet([STATEMENT_HEADER, ['10/22/2026', 'DEBIT', 195.8, 0, '227AN 1.10 Hrs@178.00/Hr Hobbs=4579.6-&amp;gt;4580.7', -195.8]])))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].posted_on, '2026-10-22')
    assert.equal(rows[0].balance, -195.8)
  })
})

describe('linking to the logbook', () => {
  const meter = [
    { key: 'm1', date_str: '2026-02-20', tail: '739HE', charge: 162, meter_start: 8996.5, meter_end: 8997.5, hours: 1.0, cfi: 'Yoon, Hyugjun' },
    { key: 'm2', date_str: '2026-02-20', tail: '739HE', charge: 129.6, meter_start: 8997.5, meter_end: 8998.3, hours: 0.8, cfi: null },
    { key: 'm3', date_str: '2026-10-22', tail: '227AN', charge: 195.8, meter_start: 4579.6, meter_end: 4580.7, hours: 1.1, cfi: 'Li, Ye' },
    { key: 'm4', date_str: '2025-07-01', tail: '999ZZ', charge: 100, meter_start: 1, meter_end: 2, hours: 1, cfi: null },
  ]
  const flights = [
    { id: 42, date: '2026-02-20', tail: 'N739HE', total_duration: '1.0', hobbs_start: null, hobbs_end: null },
    { id: 65, date: '2026-02-20', tail: 'N739HE', total_duration: '0.8', hobbs_start: null, hobbs_end: null },
    { id: 159, date: '2026-10-22', tail: 'N227AN', total_duration: '0.8', dual_received: '0.8', pic: '0', night: '0', hobbs_start: 4579.5, hobbs_end: 4580.6 },
  ]
  const charges = [
    { key: 'c1', applies_on: '2026-02-20', kind: 'instruction', hours: 1.0 },
    { key: 'c2', applies_on: '2026-02-20', kind: 'ground', hours: 0.5 },
    { key: 'c3', applies_on: '2026-10-22', kind: 'misc', hours: null },
    { key: 'c4', applies_on: '2026-04-17', kind: 'ground', hours: 2 },
    { key: 'c5', applies_on: '2026-10-22', kind: 'aircraft', hours: null },
    { key: 'c6', applies_on: '2026-10-22', kind: 'payment', hours: null },
    { key: 'c7', applies_on: '2026-02-21', kind: 'misc', hours: null },
    { key: 'c8', applies_on: '2026-02-23', kind: 'misc', hours: null },
  ]
  const links = linkToFlights({ meter, charges, flights })

  test('two flights in one aircraft on one day pair by duration', () => {
    assert.equal(links.meter.get('m1'), 42)
    assert.equal(links.meter.get('m2'), 65)
    assert.equal(links.meter.get('m3'), 159)
    assert.equal(links.meter.has('m4'), false, 'no logbook entry for it')
  })

  test('instruction and ground go to the dual flight; misc to the flight that day', () => {
    assert.equal(links.charges.get('c1'), 42)
    assert.equal(links.charges.get('c2'), 42)
    assert.equal(links.charges.get('c3'), 159)
  })

  test('a misc item entered the morning after goes to the previous day’s flight, not further back', () => {
    assert.equal(links.charges.get('c7'), 42)
    assert.equal(links.charges.has('c8'), false)
  })

  test('a ground lesson with no flight that day, statement aircraft lines and payments stay unlinked', () => {
    for (const k of ['c4', 'c5', 'c6']) assert.equal(links.charges.has(k), false, k)
  })

  test('the meter sets Hobbs readings, and the total where the logged time disagrees', () => {
    assert.deepEqual(links.hobbs.map(h => h.flight_id).sort((a, b) => a - b), [42, 65, 159])
    assert.deepEqual(links.hobbs.find(h => h.flight_id === 65), { flight_id: 65, hobbs_start: 8997.5, hobbs_end: 8998.3 })
    assert.deepEqual(links.hobbs.find(h => h.flight_id === 159),
      { flight_id: 159, hobbs_start: 4579.6, hobbs_end: 4580.7, total_duration: 1.1, dual_received: 1.1 })
  })
})

describe('Hobbs as the logged time', () => {
  const m = { meter_start: 100, meter_end: 101.5, hours: 1.5 }
  test('a flight that already agrees is left alone', () => {
    assert.equal(hobbsUpdate({ id: 1, hobbs_start: 100, hobbs_end: 101.5, total_duration: '1.5', dual_received: '1.5' }, m), null)
  })
  test('columns that were the whole flight follow the total; partial ones are capped by it', () => {
    const f = { id: 1, hobbs_start: 100, hobbs_end: 101.5, total_duration: '2.0', dual_received: '2.0', pic: '0', cross_country: '2.0', night: '1.8', instrument: '0.3' }
    assert.deepEqual(hobbsUpdate(f, m), { flight_id: 1, total_duration: 1.5, dual_received: 1.5, cross_country: 1.5, night: 1.5 })
  })
})

describe('sync schedule', () => {
  const now = Date.parse('2026-10-23T12:00:00Z')
  const ago = h => new Date(now - h * 3600_000).toISOString()
  test('routine refresh every 12 h', () => {
    assert.equal(isDue({ lastAttempt: ago(13), lastSuccess: ago(13), awaiting: 0, now }), true)
    assert.equal(isDue({ lastAttempt: ago(2), lastSuccess: ago(2), awaiting: 0, now }), false)
    assert.equal(isDue({ lastAttempt: null, lastSuccess: null, awaiting: 0, now }), true)
  })
  test('hourly while a recent flight has no charge, and failures back off an hour', () => {
    assert.equal(isDue({ lastAttempt: ago(1.1), lastSuccess: ago(1.1), awaiting: 1, now }), true)
    assert.equal(isDue({ lastAttempt: ago(0.3), lastSuccess: ago(0.3), awaiting: 1, now }), false)
    assert.equal(isDue({ lastAttempt: ago(0.3), lastSuccess: ago(30), awaiting: 0, now }), false)
  })
})
