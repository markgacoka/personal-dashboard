import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateRawSync } from 'zlib'
import { parseCsv } from '../lib/csv.js'
import { readZipEntry } from '../lib/zip.js'
import { buildAirports, nasrCycle, nasrUrl, cycleId } from '../services/nasr.js'

const csv = (head, ...rows) => parseCsv([head.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\r\n'))

test('NASR cycle: 28 days from a known effective date', () => {
  assert.equal(cycleId(nasrCycle(Date.UTC(2026, 9, 16))), '2026-10-01')
  assert.equal(cycleId(nasrCycle(Date.UTC(2026, 9, 29))), '2026-10-29')
  assert.equal(cycleId(nasrCycle(Date.UTC(2026, 0, 21))), '2025-12-25')
  assert.equal(nasrUrl(new Date(Date.UTC(2026, 9, 1))), 'https://nfdc.faa.gov/webContent/28DaySub/extra/01_Oct_2026_CSV.zip')
})

test('parseCsv: quotes, embedded commas, newlines and escaped quotes', () => {
  const rows = parseCsv('"A","B"\r\n"x, y","say ""hi""\nnext"\r\n"1",""\r\n')
  assert.deepEqual(rows, [{ A: 'x, y', B: 'say "hi"\nnext' }, { A: '1', B: '' }])
})

test('readZipEntry: deflated entry from an in-memory zip', () => {
  const data = Buffer.from('hello,world\n'), comp = deflateRawSync(data), name = Buffer.from('F.csv')
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26)
  const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(data.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(0, 42)
  const cdOff = 30 + name.length + comp.length
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(46 + name.length, 12); eocd.writeUInt32LE(cdOff, 16)
  const zip = Buffer.concat([local, name, comp, cd, name, eocd])
  assert.equal(readZipEntry(zip, 'F.csv').toString(), 'hello,world\n')
  assert.throws(() => readZipEntry(zip, 'G.csv'), /not found/)
})

const BASE = ['SITE_TYPE_CODE', 'ARPT_STATUS', 'ARPT_ID', 'ICAO_ID', 'ARPT_NAME', 'CITY', 'STATE_CODE', 'LAT_DECIMAL', 'LONG_DECIMAL', 'ELEV', 'TPA', 'MAG_VARN', 'MAG_HEMIS', 'FACILITY_USE_CODE', 'TWR_TYPE_CODE', 'SEG_CIRCLE_MKR_FLAG', 'WIND_INDCR_FLAG', 'LGT_SKED', 'COUNTRY_CODE']
const tables = () => ({
  APT_BASE: csv(BASE,
    ['A', 'O', 'TST', 'KTST', 'TEST MUNI', 'TESTVILLE', 'CA', '37.0', '-121.0', '200', '800', '15', 'E', 'PU', 'NON-ATCT', 'Y', 'Y-L', ''],
    ['H', 'O', 'HEL', '', 'A HELIPORT', 'X', 'CA', '37.1', '-121.1', '0', '', '15', 'E', 'PR', 'NON-ATCT', 'N', '', ''],
    ['A', 'O', 'SHT', '', 'SHORT STRIP', 'Y', 'CA', '37.05', '-121.05', '50', '', '15', 'W', 'PR', 'NON-ATCT', 'N', '', ''],
    ['A', 'O', 'CYQH', 'CYQH', 'WATSON LAKE', 'WATSON LAKE', '', '60.1', '-128.8', '2255', '', '25', 'E', 'PU', 'NON-ATCT', 'N', '', '', 'CA']),
  APT_RWY: csv(['ARPT_ID', 'RWY_ID', 'RWY_LEN', 'RWY_WIDTH', 'SURFACE_TYPE_CODE', 'COND', 'RWY_LGT_CODE'],
    ['TST', '12/30', '4000', '75', 'ASPH', 'GOOD', 'MED'], ['TST', 'H1', '40', '40', 'CONC', '', ''], ['SHT', '09/27', '1200', '50', 'TURF', '', ''], ['CYQH', '08/26', '5500', '100', 'ASPH', '', '']),
  APT_RWY_END: csv(['ARPT_ID', 'RWY_ID', 'RWY_END_ID', 'TRUE_ALIGNMENT', 'RIGHT_HAND_TRAFFIC_PAT_FLAG', 'LAT_DECIMAL', 'LONG_DECIMAL', 'RWY_END_ELEV', 'DISPLACED_THR_LEN', 'VGSI_CODE', 'LNDG_DIST_AVBL'],
    ['TST', '12/30', '12', '132', 'N', '37.003', '-121.003', '190', '', 'P2L', ''], ['TST', '12/30', '30', '312', 'Y', '36.997', '-120.997', '200', '261', 'P2L', ''],
    ['SHT', '09/27', '09', '90', 'N', '', '', '', '', '', ''], ['SHT', '09/27', '27', '270', 'N', '', '', '', '', '', ''],
    ['CYQH', '08/26', '08', '110', 'N', '', '', '', '', '', ''], ['CYQH', '08/26', '26', '290', 'N', '', '', '', '', '', '']),
  APT_RMK: csv(['ARPT_ID', 'TAB_NAME', 'REF_COL_NAME', 'ELEMENT', 'REMARK'],
    ['TST', 'AIRPORT', 'GENERAL_REMARK', '', 'RWY 30 CALM WIND RWY.'], ['TST', 'AIRPORT_CONTACT', 'NAME', '', 'JOHN DOE'], ['TST', 'RUNWAY_END', 'CLOSE_IN_OBSTN', '12', 'TREES.']),
  FRQ: csv(['FACILITY', 'FACILITY_TYPE', 'SERVICED_FACILITY', 'FREQ', 'FREQ_USE', 'TOWER_OR_COMM_CALL', 'FAC_NAME', 'TOWER_HRS', 'SECTORIZATION'],
    ['TST', 'NON-ATCT', 'TST', '123.075', 'CTAF', '', 'TEST MUNI', '', ''], ['NCT', 'TRACON', 'TST', '279.6', 'APCH/P', '', '', '', ''], ['WXA', 'ASOS_AWOS', 'WXA', '118.375', 'WXA AWOS-3', '', '', '', '']),
  AWOS: csv(['ASOS_AWOS_ID', 'ASOS_AWOS_TYPE', 'LAT_DECIMAL', 'LONG_DECIMAL', 'PHONE_NO'], ['WXA', 'AWOS-3', '37.1', '-121.0', '555-0100']),
  CLS_ARSP: csv(['ARPT_ID', 'CLASS_B_AIRSPACE', 'CLASS_C_AIRSPACE', 'CLASS_D_AIRSPACE', 'CLASS_E_AIRSPACE', 'AIRSPACE_HRS'], ['TST', '', '', '', 'Y', '']),
  ATC_BASE: csv(['FACILITY_TYPE', 'FACILITY_ID', 'TWR_CALL', 'TWR_HRS']),
})

test('buildAirports: US airplane facilities only, runway ends with traffic flags, nearest weather', () => {
  const out = buildAirports(tables(), '2026-10-01')
  assert.deepEqual(out.map(a => a.id).sort(), ['SHT', 'TST'])
  const t = out.find(a => a.id === 'TST')
  assert.equal(t.suitable, true); assert.equal(t.public, true); assert.equal(t.towered, false)
  assert.equal(t.data.tpaAgl, 800); assert.equal(t.data.magVar, 15)
  assert.deepEqual(t.data.runways.map(r => r.id), ['12/30'])
  const [e12, e30] = t.data.runways[0].ends
  assert.equal(e12.right, false); assert.equal(e30.right, true); assert.equal(e30.displaced, 261)
  assert.deepEqual(t.data.frequencies.map(f => [f.use, f.freq]), [['CTAF', '123.075']])
  assert.equal(t.data.wx.id, 'WXA'); assert.equal(t.data.wx.freq, '118.375'); assert.ok(t.data.wx.distNm > 5 && t.data.wx.distNm < 7)
  assert.deepEqual(t.data.remarks, ['RWY 30 CALM WIND RWY.', 'RWY 12: TREES.'])
  const s = out.find(a => a.id === 'SHT')
  assert.equal(s.suitable, false); assert.equal(s.data.magVar, -15)
})
