// Route text ⇄ plan.route. The text is a SkyVector/ForeFlight route string
// ("KRHV VPCOY SJC090020 3720N12150W KHAF"); plan.route keeps one token per
// point with "*" on airports that are flown over (middle airports from typed
// text are flown over unless they were already marked as stops).
export const tokenize = (text: string) =>
  text.toUpperCase().replace(/\bDCT\b/g, ' ').split(/[\s>]+/).map(t => t.trim()).filter(Boolean)

export const routeToText = (route: string[]) => route.map(t => t.replace(/\*$/, '')).join(' ')

export function textToRoute(text: string, prev: string[], isAirport: (token: string) => boolean | undefined) {
  const tokens = tokenize(text)
  const stops = new Set(prev.slice(1, -1).filter(t => !t.endsWith('*')))
  return tokens.map((t, i) => {
    if (i === 0 || i === tokens.length - 1) return t
    if (isAirport(t) === false) return t
    return stops.has(t) ? t : `${t}*`
  })
}
