// Route text ⇄ plan.route. The text is a SkyVector/ForeFlight route string
// ("KRHV E16* VPCOY KSNS KRHV"); plan.route keeps one token per point. Airports
// are stops (you land) unless written with a trailing "*" (flown over).
export const tokenize = (text: string) =>
  text.toUpperCase().replace(/\bDCT\b/g, ' ').split(/[\s>]+/).map(t => t.trim()).filter(Boolean)

export const routeToText = (route: string[]) => route.join(' ')

// Waypoints never take a "*": only airports can be landed at.
export function textToRoute(text: string, isAirport: (token: string) => boolean | undefined) {
  const tokens = tokenize(text)
  return tokens.map((t, i) => {
    const id = t.replace(/\*$/, '')
    if (i === 0 || i === tokens.length - 1 || isAirport(id) === false) return id
    return t
  })
}
