// Radio phraseology to speech: digits one at a time ("niner"), phonetic
// call-sign letters, runway sides, frequencies and altitudes as pilots say them.

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner']
const PHONETIC: Record<string, string> = {
  A: 'alpha', B: 'bravo', C: 'charlie', D: 'delta', E: 'echo', F: 'foxtrot', G: 'golf', H: 'hotel', I: 'india', J: 'juliett', K: 'kilo', L: 'lima', M: 'mike',
  N: 'november', O: 'oscar', P: 'papa', Q: 'quebec', R: 'romeo', S: 'sierra', T: 'tango', U: 'uniform', V: 'victor', W: 'whiskey', X: 'x-ray', Y: 'yankee', Z: 'zulu',
}
const SIDE: Record<string, string> = { L: 'left', R: 'right', C: 'center' }
const digits = (s: string) => s.split('').map(d => DIGIT[+d]).join(' ')

export function spoken(text: string): string {
  return text
    .replace(/\b(\d{3})\.(\d{1,3})\b/g, (_, a, b) => `${digits(a)} point ${digits(b.replace(/0+$/, '') || '0')}`)
    .replace(/\b([23]\d)\.(\d{2})\b/g, (_, a, b) => digits(a + b))
    .replace(/\b(\d{1,2}),(\d)(\d{2})\b/g, (m, th, h, rest) => rest !== '00' ? digits(m.replace(',', '')) : `${digits(th)} thousand${h !== '0' ? ` ${DIGIT[+h]} hundred` : ''}`)
    .replace(/\b(\d{1,2})([LRC])\b/g, (_, n, s) => `${digits(n)} ${SIDE[s]}`)
    .replace(/\b(\d{4})Z\b/g, (_, t) => `${digits(t)} zulu`)
    .replace(/\b(\d+)([A-Z]{1,3})\b/g, (_, n, l) => `${digits(n)} ${l.split('').map((c: string) => PHONETIC[c]).join(' ')}`)
    .replace(/\b\d+\b(?! (?:miles?|o'clock|minutes?))/g, n => digits(n))
}

export interface Tx { from: string; text: string; voice?: number; you?: boolean }

let ctx: AudioContext | null = null
function squelch() {
  try {
    ctx ??= new AudioContext()
    const len = Math.floor(ctx.sampleRate * 0.09)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) * 0.18
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start()
  } catch { /* no audio output */ }
}

export const speechAvailable = () => typeof window !== 'undefined' && 'speechSynthesis' in window

function voices() {
  const all = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
  const us = all.filter(v => v.lang === 'en-US')
  return us.length >= 2 ? us : all
}

// Speaks transmissions in order; resolves when done or stopped. `onLine` marks the line being spoken.
export function transmit(txs: Tx[], onLine: (i: number | null) => void): () => void {
  if (!speechAvailable()) return () => {}
  let stopped = false
  speechSynthesis.cancel()
  const play = (i: number) => {
    if (stopped || i >= txs.length) { onLine(null); return }
    onLine(i)
    squelch()
    const u = new SpeechSynthesisUtterance(spoken(txs[i].text))
    const vs = voices()
    if (vs.length) u.voice = vs[(txs[i].voice ?? 0) % vs.length]
    u.rate = 1.08
    u.onend = () => setTimeout(() => play(i + 1), 450)
    u.onerror = () => play(i + 1)
    setTimeout(() => !stopped && speechSynthesis.speak(u), 120)
  }
  play(0)
  return () => { stopped = true; speechSynthesis.cancel(); onLine(null) }
}
