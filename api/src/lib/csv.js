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
