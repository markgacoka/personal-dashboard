// Aircraft photos: public-source helpers, and the owner's upload round trip.
import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { airportDataFullSize, normTail, findPhoto, forgetPhoto } from '../services/aircraftPhoto.js'

describe('photo helpers', () => {
  test('airport-data thumbnails map to the full-size original', () => {
    assert.equal(airportDataFullSize('https://airport-data.com/images/aircraft/thumbnails/001/841/001841543.jpg'), 'https://image.airport-data.com/aircraft/001841543.jpg')
    assert.equal(airportDataFullSize('https://t.plnspttrs.net/39138/1993502_62ce356ae1_280.jpg'), 'https://t.plnspttrs.net/39138/1993502_62ce356ae1_280.jpg')
    assert.equal(airportDataFullSize(null), null)
  })
  test('tails normalise to N-numbers', () => {
    for (const t of ['227AN', 'n227an', 'N227AN', 'N-227AN']) assert.equal(normTail(t), 'N227AN')
  })
})

// Uses a tail no real aircraft has; the last test removes its row.
describe('owner photo upload (DB integration)', { skip: !process.env.DATABASE_URL ? 'DATABASE_URL not set' : false }, () => {
  const TAIL = 'N0TEST'
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  let app, pool

  test('setup', async () => {
    const { default: Fastify } = await import('fastify')
    const { default: aircraftRoutes } = await import('../routes/aircraft.js')
    ;({ pool } = await import('../db/client.js'))
    await (await import('../db/migrate.js')).runMigrations()
    app = Fastify({ logger: false })
    await app.register(aircraftRoutes)
    await app.ready()
  })

  test('only JPEG, PNG or WebP bodies are accepted', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/aircraft/${TAIL}/photo`, headers: { 'content-type': 'application/json' }, payload: '{}' })
    assert.equal(res.statusCode, 415)
  })

  test('a linked photo is used, with its credit', async () => {
    await pool.query(`INSERT INTO aircraft_photos (tail_number, url, credit, link, source) VALUES ($1, 'https://cdn.example/x.jpg', 'A. Spotter', 'https://example/photo/1', 'JetPhotos')
      ON CONFLICT (tail_number) DO UPDATE SET url = EXCLUDED.url, credit = EXCLUDED.credit, link = EXCLUDED.link, source = EXCLUDED.source, data = NULL, content_type = NULL`, [TAIL])
    forgetPhoto(TAIL)
    assert.deepEqual(await findPhoto(TAIL), { url: 'https://cdn.example/x.jpg', credit: 'A. Spotter', link: 'https://example/photo/1', source: 'JetPhotos' })
    assert.equal((await app.inject({ method: 'GET', url: `/api/aircraft/${TAIL}/photo` })).statusCode, 404, 'nothing stored to serve')
  })

  test('an upload is served back and becomes the photo', async () => {
    const put = await app.inject({ method: 'PUT', url: '/api/aircraft/0test/photo', headers: { 'content-type': 'image/png' }, payload: PNG })
    assert.equal(put.statusCode, 200)
    const photo = put.json()
    assert.equal(photo.source, 'upload')
    assert.match(photo.url, /^\/api\/aircraft\/N0TEST\/photo\?v=\d+$/)
    const get = await app.inject({ method: 'GET', url: photo.url })
    assert.equal(get.statusCode, 200)
    assert.equal(get.headers['content-type'], 'image/png')
    assert.deepEqual(get.rawPayload, PNG)
  })

  test('removing it leaves no photo', async () => {
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/aircraft/${TAIL}/photo` })).statusCode, 204)
    assert.equal((await app.inject({ method: 'GET', url: `/api/aircraft/${TAIL}/photo` })).statusCode, 404)
    const { rows } = await pool.query('SELECT 1 FROM aircraft_photos WHERE tail_number = $1', [TAIL])
    assert.equal(rows.length, 0)
    await app.close()
  })
})
