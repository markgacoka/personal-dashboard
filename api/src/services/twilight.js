// NOAA solar calculator — civil twilight (sun center at -6° elevation = zenith 96°)
// Reference: https://gml.noaa.gov/grad/solcalc/calcdetails.html
//
// Returns { dawn: Date, dusk: Date } in UTC for the given date (YYYY-MM-DD) and
// geographic coordinates (lat/lon in decimal degrees, positive N/E).
// Dawn = beginning of morning civil twilight; dusk = end of evening civil twilight.
// Returns null for polar conditions where civil twilight doesn't occur.

export function civilTwilightUTC(dateStr, lat, lon) {
  const base = new Date(dateStr + 'T00:00:00Z')
  // Julian date for solar noon on this date
  const jd = base.getTime() / 86400000 + 2440587.5 + 0.5
  const T  = (jd - 2451545.0) / 36525   // Julian centuries from J2000

  // Geometric mean longitude of sun (deg)
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360
  // Geometric mean anomaly (deg)
  const M    = 357.52911 + T * (35999.05029 - 0.0001537 * T)
  const Mrad = M * Math.PI / 180
  // Equation of center
  const C = Math.sin(Mrad)   * (1.914602 - T * (0.004817 + 0.000014 * T))
          + Math.sin(2*Mrad) * (0.019993 - 0.000101 * T)
          + Math.sin(3*Mrad) * 0.000289
  // Apparent longitude (correct for nutation/aberration)
  const omega  = 125.04 - 1934.136 * T
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega * Math.PI / 180)) * Math.PI / 180
  // Obliquity of ecliptic + nutation correction
  const eps0 = 23 + (26 + (21.448 - T * (46.8150 + T * (0.00059 - T * 0.001813))) / 60) / 60
  const eps  = (eps0 + 0.00256 * Math.cos(omega * Math.PI / 180)) * Math.PI / 180
  // Solar declination
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda))

  // Equation of time (minutes)
  const y   = Math.tan(eps / 2) ** 2
  const ecc = 0.016708634
  const L0r = L0 * Math.PI / 180
  const eot = 4 * (180 / Math.PI) * (
    y * Math.sin(2 * L0r)
    - 2 * ecc * Math.sin(Mrad)
    + 4 * ecc * y * Math.sin(Mrad) * Math.cos(2 * L0r)
    - 0.5 * y ** 2 * Math.sin(4 * L0r)
    - 1.25 * ecc ** 2 * Math.sin(2 * Mrad)
  )

  // Hour angle for civil twilight (zenith = 96°)
  const latRad = lat * Math.PI / 180
  const cosHA  = (Math.cos(96 * Math.PI / 180) - Math.sin(latRad) * Math.sin(decl))
               / (Math.cos(latRad) * Math.cos(decl))
  if (Math.abs(cosHA) > 1) return null  // polar — no civil twilight

  const HA = Math.acos(cosHA) * 180 / Math.PI  // degrees

  // Solar noon in minutes from UTC midnight (lon positive = east, negative = west)
  const solarNoonMin = 720 - 4 * lon - eot

  return {
    dawn: new Date(base.getTime() + (solarNoonMin - HA * 4) * 60000),
    dusk: new Date(base.getTime() + (solarNoonMin + HA * 4) * 60000),
  }
}
