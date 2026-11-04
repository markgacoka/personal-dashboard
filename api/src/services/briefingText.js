// The route named in a Leidos briefing email: "…Briefing Email from KRHV to KCVH…"
// (quoted-printable soft breaks removed first).
export function simpleRoute(raw) {
  const text = String(raw).replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
  const m = text.match(/Briefing Email from ([A-Z0-9]{3,4}) to ([A-Z0-9]{3,4})/i)
  return m ? [m[1].toUpperCase(), m[2].toUpperCase()] : []
}
