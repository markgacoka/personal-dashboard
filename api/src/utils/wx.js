/**
 * Pure aviation/weather utility functions — no I/O, no side effects.
 * Tested in src/test/wx.test.js.
 */

/**
 * Headwind and crosswind components for a given runway heading.
 * @param {number|'VRB'|null} windDir - degrees magnetic, or 'VRB'
 * @param {number} windSpeed - knots
 * @param {number} runwayHdg - landing heading, degrees magnetic
 * @returns {{ headwind: number, crosswind: number }}
 *   headwind > 0 = headwind; headwind < 0 = tailwind; crosswind always ≥ 0
 */
export function windComponents(windDir, windSpeed, runwayHdg) {
  if (!windSpeed || windDir === 'VRB' || windDir == null) {
    return { headwind: 0, crosswind: 0 }
  }
  const angle = ((windDir - runwayHdg) % 360 + 360) % 360
  const rad = angle * Math.PI / 180
  return {
    headwind:  Math.round(windSpeed * Math.cos(rad)),
    crosswind: Math.round(Math.abs(windSpeed * Math.sin(rad))),
  }
}

/**
 * Convert altimeter setting from hPa to inHg.
 * AWC API returns altim in hPa; pilots read inHg.
 */
export function altimToInhg(hPa) {
  return hPa / 33.8639
}

/**
 * Density altitude in feet MSL.
 * @param {number} fieldElevFt - field elevation ft MSL
 * @param {number} altimInhg - altimeter setting inHg
 * @param {number} oatC - outside air temp °C
 */
export function densityAlt(fieldElevFt, altimInhg, oatC) {
  const pa  = fieldElevFt + (29.92 - altimInhg) * 1000
  const isa = 15 - 2 * (pa / 1000)
  return Math.round(pa + 118.8 * (oatC - isa))
}

/**
 * FAA flight category from ceiling and visibility.
 * @param {number|null} ceilingFt - ft AGL; null = unlimited
 * @param {number|null} visSm    - statute miles; null = unlimited
 * @returns {'VFR'|'MVFR'|'IFR'|'LIFR'}
 */
export function flightCat(ceilingFt, visSm) {
  const c = ceilingFt ?? Infinity
  const v = visSm    ?? Infinity
  if (c < 500  || v < 1) return 'LIFR'
  if (c < 1000 || v < 3) return 'IFR'
  if (c < 3000 || v < 5) return 'MVFR'
  return 'VFR'
}

/**
 * Best landing direction across all runways for the current wind.
 * Maximises headwind; tie-breaks on minimum crosswind.
 * @param {number|'VRB'|null} windDir
 * @param {number} windSpeed
 * @param {Array<{le_hdg:number, he_hdg:number, le_ident:string, he_ident:string}>} runways
 * @returns {{ hdg:number, ident:string, headwind:number, crosswind:number }|null}
 */
export function bestRunway(windDir, windSpeed, runways) {
  if (!runways?.length) return null
  let best = null
  for (const rwy of runways) {
    for (const [hdg, ident] of [[rwy.le_hdg, rwy.le_ident], [rwy.he_hdg, rwy.he_ident]]) {
      if (!hdg) continue
      const { headwind, crosswind } = windComponents(windDir, windSpeed, hdg)
      if (!best || headwind > best.headwind || (headwind === best.headwind && crosswind < best.crosswind)) {
        best = { hdg, ident, headwind, crosswind }
      }
    }
  }
  return best
}

/**
 * Go/No-Go decision for VFR flight.
 * @param {string} cat - 'VFR'|'MVFR'|'IFR'|'LIFR'
 * @param {number} xwind - crosswind component kt
 * @param {number|null} gust - gust kt, or null
 * @returns {'go'|'caut'|'nogo'}
 */
export function goNogo(cat, xwind, gust) {
  if (cat === 'LIFR' || cat === 'IFR') return 'nogo'
  if (cat === 'MVFR' || xwind > 10 || (gust && gust > 20)) return 'caut'
  return 'go'
}
