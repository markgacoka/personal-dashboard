// Minimal CSV line parser: handles quoted fields containing commas. Doesn't
// handle escaped quotes ("") — none of the sources this app reads use them.
export function parseCsvLine(line, { trim = false } = {}) {
  const fields = []
  let cur = '', inQ = false
  for (const ch of line) {
    if (ch === '"') inQ = !inQ
    else if (ch === ',' && !inQ) { fields.push(trim ? cur.trim() : cur); cur = '' }
    else cur += ch
  }
  fields.push(trim ? cur.trim() : cur)
  return fields
}

// Rows of an OurAirports CSV whose airport_ident equals `icao`, as objects keyed
// by header. Scans for the ICAO substring before parsing, so the 10 MB runway
// file only gets fully parsed on matching lines.
export function filterAirportCsv(text, icao) {
  const lines = text.split('\n')
  if (!lines.length) return []
  const headers = parseCsvLine(lines[0])
  const identIdx = headers.indexOf('airport_ident')
  if (identIdx < 0) return []
  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.includes(icao)) continue
    const vals = parseCsvLine(line)
    if (vals[identIdx] !== icao) continue
    rows.push(Object.fromEntries(headers.map((h, j) => [h, vals[j] ?? ''])))
  }
  return rows
}

// Full CSV parser: quoted fields may contain commas, newlines and "" escapes.
// Returns objects keyed by the header row, limited to `columns` when given.
// Fields are sliced out of the text and each row is converted as soon as it
// ends, so only the kept fields stay in memory.
export function parseCsv(text, columns) {
  const out = []
  let idx = null
  let row = []
  const n = text.length
  let i = 0
  while (i < n) {
    let field
    if (text[i] === '"') {
      let j = i + 1, esc = false
      for (;;) {
        const q = text.indexOf('"', j)
        if (q < 0) { j = n; break }
        if (text[q + 1] === '"') { esc = true; j = q + 2; continue }
        j = q; break
      }
      field = text.slice(i + 1, j)
      if (esc) field = field.replace(/""/g, '"')
      i = j + 1
    } else {
      let j = i
      while (j < n && text[j] !== ',' && text[j] !== '\n' && text[j] !== '\r') j++
      field = text.slice(i, j)
      i = j
    }
    row.push(field)
    if (text[i] === ',') { i++; if (i === n) row.push(''); continue }
    if (text[i] === '\r') i++
    if (text[i] === '\n') i++
    if (row.length > 1 || row[0] !== '') {
      if (!idx) {
        idx = row.map((h, j) => [h.replace(/^\uFEFF/, ''), j]).filter(([k]) => !columns || columns.includes(k))
      } else {
        const o = {}
        for (const [k, j] of idx) o[k] = row[j] ?? ''
        out.push(o)
      }
    }
    row = []
  }
  return out
}
