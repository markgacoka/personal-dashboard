// OCR'd POH tables: the cleanup that keeps columns in place, and rows read in order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cruiseTable, distanceTables, ocrClean } from '../services/pohTables.js'

// Tesseract (300 dpi, layout mode) on a scanned Cessna 172N landing chart: rules read as | } { ], margin specks.
const LANDING = [
  'LBs | sorr| ALT             TOTAL              TOTAL              TOTAL              TOTAL              TOTAL',
  '2300                           S.L.          495            1205             510           1235             530            1265            545            1295            565             1330',
  '1000 } 510      1235       530      1265       550      1300       565       1330       585       1365',
  '2000 | 530      1265       550      1300       570      1335       590       1370      610       1405',
  'om                              3000 | 550       1300       570      1335       590      1370       610       1405       630       1440          a',
  '                              4000 | 570       1335       590      1370       615      1410       635       1445       655       1480        as',
  '~                              5000 | 590       1370       615      1415       635      1450       655       1485       680       1525           zy',
].join('\n')

// The same book's cruise table: "|2500]" rules, "---"/"cee" empty cells, "24004", a flow read as "79".
const CRUISE = [
  '2000 |2500] ---    cee    cae     75    116     8.4    71    115    79',
  '2400} 72     111      8.0 | 67     111      7.5      63     110     7.1',
  '2300] 64      106      7.1       60 | 105       6.7      56      105 | 6.3',
  '2200] 56      101       6.3      53      100      6.1      50       99      5.8',
  '2100, 50       95      5.8      47       94      5.6      45       93      5.4',
  '4000 |2550] ---    ite    ---     75    118    8.4    71    118    7.9',
  '2500] 76     116      8.5      71      115      8.0     67     115     7.5',
  '24004 68      111       7.6       64      110       7.1       60      109      6.7',
  '2300] 60     105      6.8      57      105      6.4     54     104     6.1',
].join('\n')

test('cleanup keeps every column where it was', () => {
  for (const l of CRUISE.split('\n')) assert.equal(ocrClean(l).length, l.length)
  assert.match(ocrClean('24004 68      111       7.6       64      110'), /^2400  68/)
  assert.doesNotMatch(ocrClean(LANDING), /[|{}[\]]/)
  // Specks outside the numbers stay (they are ignored later), empty cells inside become dashes.
  assert.match(ocrClean('2000 |2500] ---    cee    cae     75    116     8.4'), /2500\s+---\s+---\s+---\s+75/)
})

test('a scanned landing chart is read in full', () => {
  const [t] = distanceTables([ocrClean(LANDING)], { speeds: 1 })
  assert.equal(t.weight, 2300)
  assert.deepEqual(t.pa, [0, 1000, 2000, 3000, 4000, 5000])
  assert.deepEqual(t.rows[0][0], [495, 1205])
  assert.deepEqual(t.rows[5][4], [680, 1525])
})

test('a scanned cruise table is read, including a flow that lost its decimal point', () => {
  const t = cruiseTable([ocrClean(CRUISE)])
  assert.ok(t && t.rows.length >= 7)
  assert.deepEqual(t.rows[0], { pa: 2000, rpm: 2500, cols: [null, [75, 116, 8.4], [71, 115, 7.9]] })
  assert.ok(t.rows.some(r => r.pa === 4000 && r.rpm === 2400 && r.cols[1][1] === 110))
})
