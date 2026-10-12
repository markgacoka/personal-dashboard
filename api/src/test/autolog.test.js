// NICE AIR auto-logging and the free track sources: pure logic only.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { parseScheduleBody } from '../services/gmail.js'
import { currentBookings, analyzeTrack, matchInstructor, planEntry } from '../services/autolog.js'
import { mergeTracks, coverage, searchWindow, flightSearchWindow } from '../services/flightTrack.js'
import { findTarMember, normalizeAdsbLol, utcDatesBetween } from '../services/adsblol.js'

describe('NICE AIR booking emails', () => {
  test('the calendar attachment no longer overwrites the end time', () => {
    const body = [
      'Your Flight Schedule has been made by Mbui, Gacoka',
      'Pilot: Mbui, Gacoka', 'CFI: Kim-Cfi, Manjae', 'Resource: 210AN',
      'Start: 10/11/2026 3:00 PM', 'End: 10/11/2026 6:00 PM', '',
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20261011T220000Z', 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n')
    const f = parseScheduleBody(Buffer.from(body))
    assert.equal(f.start, '10/11/2026 3:00 PM')
    assert.equal(f.end, '10/11/2026 6:00 PM')
    assert.equal(f.resource, '210AN')
  })

  test('the latest email decides a booking; cancelled ones drop out', () => {
    const row = (type, received, start = 100) => ({ type, date_str: '2026-10-11', tail: '210AN', start_unix: start, end_unix: start + 10800, received_at: received })
    assert.equal(currentBookings([row('made', '1'), row('cancelled', '2')]).length, 0)
    const [b] = currentBookings([row('made', '1'), row('cancelled', '2'), row('made', '3', 200)])
    assert.equal(b.start_unix, 200)
    assert.equal(b.key, '2026-10-11/210AN/200')
    assert.equal(currentBookings([{ ...row('made', '1'), end_unix: null }]).length, 0, 'needs an end time')
  })

  test('CFI names in "Last-Cfi, First" form match instructors', () => {
    const ins = [{ id: 1, name: 'Michael Torres' }, { id: 4, name: 'Manjae Kim' }]
    assert.equal(matchInstructor('Kim-Cfi, Manjae', ins)?.id, 4)
    assert.equal(matchInstructor('Someone, Else', ins), null)
  })
})

// A synthetic cross-country: ground at A, cruise, a stop at B, back to A.
const A = { icao: 'KAAA', name: 'Alpha', lat: 37.33, lon: -121.82, elevation_ft: 135 }
const B = { icao: 'KBBB', name: 'Bravo', lat: 36.99, lon: -120.11, elevation_ft: 254 }
const at = (min, p, alt, gs, ground = false) => ({ ts: new Date(Date.UTC(2026, 9, 11, 22, 0) + min * 60_000).toISOString(), lat: p.lat, lon: p.lon, altitude_ft: alt, groundspeed_kts: gs, on_ground: ground })
const mid = (f) => ({ lat: A.lat + (B.lat - A.lat) * f, lon: A.lon + (B.lon - A.lon) * f })
const xc = [
  at(0, A, null, 8, true), at(5, A, 300, 60), ...[0.2, 0.5, 0.8].map((f, i) => at(15 + i * 10, mid(f), 4500, 105)),
  at(50, B, 400, 60), at(52, B, null, 10, true), at(70, B, 450, 65),
  ...[0.8, 0.5, 0.2].map((f, i) => at(80 + i * 10, mid(f), 5500, 110)), at(115, A, 400, 65), at(118, A, null, 9, true),
]

describe('track analysis', () => {
  test('a complete cross-country: route, landings, time', () => {
    const a = analyzeTrack(xc, [A, B])
    assert.equal(a.complete, true)
    assert.equal(a.departure, 'KAAA')
    assert.equal(a.arrival, 'KAAA')
    assert.deepEqual(a.via, ['KBBB'])
    assert.equal(a.landings, 2)
    const e = planEntry({ booking: { date_str: '2026-10-11', start_unix: Date.UTC(2026, 9, 11, 22) / 1000, end_unix: Date.UTC(2026, 9, 12, 1) / 1000, cfi: 'Kim-Cfi, Manjae' }, analysis: a, counts: { adsblol: 10 }, aircraftId: 1, instructor: { id: 4 } })
    assert.equal(e.training_type, 'x-country')
    assert.equal(e.total_duration, 2) // first to last movement: 118 min
    assert.equal(e.dual_received, 2)
    assert.equal(e.cross_country, 2)
    assert.deepEqual(e.via, ['KBBB'])
  })

  test('a track that drops out mid-flight falls back to the booked window', () => {
    const a = analyzeTrack(xc.slice(0, 5), [A, B])
    assert.equal(a.complete, false)
    const e = planEntry({ booking: { date_str: '2026-10-11', start_unix: 0, end_unix: 3 * 3600, cfi: null }, analysis: a, counts: { opensky: 5 }, aircraftId: 1 })
    assert.equal(e.total_duration, 3)
    assert.equal(e.arrival_icao, 'KAAA') // assumed back where it started
    assert.match(e.remarks, /has gaps/)
  })
})

describe('track sources', () => {
  test('merging prefers adsb.lol points and keeps time order', () => {
    const os = [{ ts: '2026-10-11T22:00:00Z', lat: 1, lon: 1, source: 'opensky' }, { ts: '2026-10-11T22:00:30Z', lat: 2, lon: 2, source: 'opensky' }]
    const ad = [{ ts: '2026-10-11T22:00:01Z', lat: 9, lon: 9, source: 'adsblol' }, { ts: '2026-10-11T22:01:00Z', lat: 3, lon: 3, source: 'adsblol' }]
    const m = mergeTracks(os, ad)
    assert.deepEqual(m.map(p => p.lat), [9, 2, 3])
    assert.deepEqual(coverage(m), { points: 3, seconds: 59 })
  })

  test('adsb.lol rows normalise, with "ground" as on_ground', () => {
    const pts = normalizeAdsbLol({ timestamp: Date.UTC(2026, 9, 11, 22) / 1000, trace: [[0, 37.3, -121.8, 'ground', 5, null, 0, null], [60, 37.31, -121.79, 2975, 78.8, 144.3, 0, 640]] })
    assert.equal(pts[0].on_ground, true)
    assert.equal(pts[1].altitude_ft, 2975)
    assert.equal(pts[1].vertical_speed_fpm, 640)
    assert.equal(pts[1].ts, '2026-10-11T22:01:00.000Z')
  })

  test('search windows and the UTC days they touch', () => {
    const w = searchWindow({ timeOut: '2026-10-11T22:00:00Z', timeIn: '2026-10-12T01:00:00Z' })
    assert.equal(new Date(w.fromMs).toISOString(), '2026-10-11T21:15:00.000Z')
    assert.equal(new Date(w.toMs).toISOString(), '2026-10-12T02:00:00.000Z')
    assert.deepEqual(utcDatesBetween(w.fromMs, w.toMs), ['2026-10-11', '2026-10-12'])
  })

  test('a flight logged with one leg’s times still searches its whole booking', () => {
    const f = { date: '2026-10-11', time_out: '2026-10-11T22:53:25Z', time_in: '2026-10-11T23:44:43Z', total_duration: '2.8', tail_number: 'N210AN' }
    const booking = { date_str: '2026-10-11', tail: '210AN', start_unix: Date.UTC(2026, 9, 11, 22) / 1000, end_unix: Date.UTC(2026, 9, 12, 1) / 1000 }
    const w = flightSearchWindow(f, [booking])
    assert.equal(new Date(w.fromMs).toISOString(), '2026-10-11T21:15:00.000Z')
    // block-out + 2.8 h = 01:41Z, plus an hour.
    assert.equal(new Date(w.toMs).toISOString(), '2026-10-12T02:41:25.000Z')
  })

  test('the streaming tar reader finds one member and stops', async () => {
    const entry = (name, body) => {
      const h = Buffer.alloc(512)
      h.write(name, 0)
      h.write(body.length.toString(8).padStart(11, '0') + '\0', 124)
      h.write('0', 156)
      return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)])
    }
    const tar = Buffer.concat([entry('traces/00/a.json', Buffer.from('x'.repeat(700))), entry('traces/8f/trace_full_a1b98f.json', Buffer.from('{"ok":1}')), Buffer.alloc(1024)])
    // Deliver in awkward chunk sizes to exercise header/body splits.
    const chunks = []
    for (let i = 0; i < tar.length; i += 97) chunks.push(tar.subarray(i, i + 97))
    const found = await findTarMember(Readable.from(chunks), 'traces/8f/trace_full_a1b98f.json')
    assert.equal(found.toString(), '{"ok":1}')
    assert.equal(await findTarMember(Readable.from([tar]), 'missing.json'), null)
  })
})

import { stitch, dropOutliers, fillDerived, summarize } from '../services/stitch.js'
import { parseTrackFile } from '../lib/trackFiles.js'

describe('stitching sources into one track', () => {
  test('impossible jumps are dropped', () => {
    const p = (s, lat, alt) => ({ ts: new Date(Date.UTC(2026, 9, 11, 22, 0, s)).toISOString(), lat, lon: -121, altitude_ft: alt })
    const out = dropOutliers([p(0, 37, 3000), p(10, 37.005, 3020), p(20, 38, 3040), p(30, 37.01, 9000), p(40, 37.015, 3060)])
    assert.deepEqual(out.map(x => x.lat), [37, 37.005, 37.015])
  })

  test('missing speed, track and vertical rate come from neighbours', () => {
    const [a, b] = fillDerived([
      { ts: '2026-10-11T22:00:00Z', lat: 37, lon: -121, altitude_ft: 3000 },
      { ts: '2026-10-11T22:01:00Z', lat: 37 + 100 / 60 / 60, lon: -121, altitude_ft: 3500 },
    ])
    assert.equal(a.groundspeed_kts, 100) // 100/60 nm in a minute
    assert.equal(a.track_deg, 0)
    assert.equal(b.vertical_speed_fpm, 500)
  })

  test('the better source wins where sources overlap; others fill the gaps', () => {
    const at = (s, src, lat) => ({ ts: new Date(Date.UTC(2026, 9, 11, 22, 0, s)).toISOString(), lat, lon: -121, source: src })
    const out = stitch({ opensky: [at(0, 'opensky', 37), at(30, 'opensky', 37.01), at(60, 'opensky', 37.02)], airplaneslive: [at(1, 'airplaneslive', 37.0001)], upload: [at(59, 'upload', 37.0199)] })
    assert.deepEqual(out.map(p => p.source), ['airplaneslive', 'opensky', 'upload'])
  })

  test('the summary names stops and gaps', () => {
    const s = summarize(xc, [A, B])
    assert.equal(s.complete, true)
    assert.deepEqual(s.events.map(e => [e.icao, e.kind]), [['KAAA', 'departure'], ['KBBB', 'full stop'], ['KAAA', 'landing']])
    assert.ok(s.gaps.length >= 1, 'the synthetic track has 10-minute spacing')
  })
})

describe('owner track files', () => {
  test('GPX', () => {
    const { format, points } = parseTrackFile('<?xml version="1.0"?><gpx version="1.1"><trk><trkseg><trkpt lat="37.33" lon="-121.82"><ele>100</ele><time>2026-10-11T22:53:00Z</time></trkpt><trkpt lat="37.34" lon="-121.81"><ele>400</ele><time>2026-10-11T22:54:00Z</time></trkpt></trkseg></trk></gpx>')
    assert.equal(format, 'GPX')
    assert.equal(points.length, 2)
    assert.equal(points[1].altitude_ft, 1312)
  })
  test('KML gx:Track', () => {
    const { format, points } = parseTrackFile('<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><gx:Track><when>2026-10-11T22:53:00Z</when><when>2026-10-11T22:54:00Z</when><gx:coord>-121.82 37.33 30</gx:coord><gx:coord>-121.81 37.34 120</gx:coord></gx:Track></kml>')
    assert.equal(format, 'KML')
    assert.deepEqual(points.map(p => p.lat), [37.33, 37.34])
  })
  test('ForeFlight CSV with epoch timestamps', () => {
    const { format, points } = parseTrackFile('Timestamp,Latitude,Longitude,Altitude,Speed,Course\n1791759180,37.33,-121.82,150,0,310\n1791759240,37.34,-121.81,600,70,312\n')
    assert.equal(format, 'CSV')
    assert.equal(points[0].ts, '2026-10-11T22:53:00.000Z')
    assert.equal(points[1].groundspeed_kts, 70)
  })
})
