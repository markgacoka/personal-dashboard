// A checklist's text (a PDF's text layer or OCR of a photo) → sections of
// "item -- ACTION" steps. Handles POH style ("4. Mixture -- RICH."), leader dots
// ("Mixture ....... RICH"), right-aligned actions, two-column pages, page
// headers and footers, notes, sub-steps (a., b.) and wrapped lines. The same
// parser reads the editable text form (formatChecklist), so edits round-trip.
export interface ChecklistItem { item: string; action?: string; sub?: boolean }
export interface ChecklistSection { title: string; items: ChecklistItem[] }

const SEP = /\s*(?:-\s?-+|\s[–—]\s|—|\.{3,}|(?:\.\s){2,}\.?|…+|_{3,}|\s-\s)\s*/
const NUM = /^\s*(?:[0-9lIBOSo]{1,2}|[a-z])[.)]\s+/
const SUB = /^\s*[a-z][.)]\s+/
const NOTE = /^(CAUTION|WARNING|NOTE|NOTES)[:.]?$/i

const letters = (s: string) => s.replace(/[^A-Za-z]/g, '')
const upperShare = (s: string) => { const l = letters(s); return l ? l.replace(/[^A-Z]/g, '').length / l.length : 0 }
const clean = (s: string) => s.replace(/^[^A-Za-z0-9#(]+/, '').replace(/\s+/g, ' ').trim()
// OCR leftovers after a wide gap ('FULL OPEN.      -,  "\\'), trailing dots.
const tidyAction = (s: string) => s.replace(/\s{3,}[^A-Za-z0-9]*[A-Za-z]?[^A-Za-z0-9]*$/, '').replace(/(\s*\.)+\s*$/, '').replace(/^[-–—.\s]+/, '').trim()
// Circled numbers and symbols that OCR reads as "CD", "I", "®" before a heading.
const unmark = (s: string) => s.replace(/^(?:[A-Za-z0-9]{1,2}\s+|\d+)(?=[A-Z]{3,})/, '')
const PAGE_FOOT = /\s{3,}\d{1,2}-\d{1,3}\s*$|^\s*\d{1,2}-\d{1,3}\s{3,}/

// Lines that repeat on several pages (running headers, footers) and page numbers.
function dropFurniture(pages: string[][]) {
  const key = (l: string) => l.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toUpperCase()
  const count = new Map<string, number>()
  if (pages.length >= 3) for (const p of pages) for (const k of new Set(p.map(key))) if (k) count.set(k, (count.get(k) ?? 0) + 1)
  const min = Math.max(3, Math.ceil(pages.length * 0.4))
  // A running header at the top of a page ("CESSNA        SECTION 4").
  const RUNNING = /\b(SECTION|MODEL|CHAPTER|PAGE|REVISION|REV|POH|AFM)\b/
  const head = (p: string[], l: string) => p.filter(x => x.trim()).slice(0, 3).includes(l) && / {10,}/.test(l.trim()) && RUNNING.test(l) && upperShare(l) > 0.8
  return pages.map(p => p.filter(l => {
    if (head(p, l)) return false
    const k = key(l)
    if (!k) return true
    if ((count.get(k) ?? 0) >= min) return false
    return !/^(PAGE\s*)?#+(\s*(OF|-|\/)\s*#+)?$/i.test(k) && !PAGE_FOOT.test(l)
  }))
}

// Two text columns side by side → left column, then right column.
function splitColumns(lines: string[]) {
  const starts = new Map<number, number>()
  for (const l of lines) for (const m of l.matchAll(/ {4,}(?=\S)/g)) { const at = m.index! + m[0].length; if (at > 25) starts.set(at, (starts.get(at) ?? 0) + 1) }
  const nonEmpty = lines.filter(l => l.trim()).length
  let col = 0, best = 0
  for (const [at] of starts) { const n = [-2, -1, 0, 1, 2].reduce((s, d) => s + (starts.get(at + d) ?? 0), 0); if (n > best) { best = n; col = at } }
  if (best < 4 || best < nonEmpty * 0.25) return lines
  const cut = (l: string) => { for (let c = col - 2; c <= col + 2; c++) if (l.length > c && /\S/.test(l[c]) && /^\s*$/.test(l.slice(Math.max(0, c - 3), c))) return c; return -1 }
  const parts = lines.map(l => { const c = cut(l); return c < 0 ? [l, ''] : [l.slice(0, c), l.slice(c)] })
  const right = parts.map(p => p[1].trim()).filter(Boolean), left = parts.map(p => p[0].trim()).filter(Boolean)
  const avg = (xs: string[]) => xs.reduce((s, x) => s + x.length, 0) / Math.max(1, xs.length)
  // Short right-hand text ("BOTH", "RICH") is a right-aligned action, not a column.
  if (avg(right) < 14 || avg(left) < 14) return lines
  return [...parts.map(p => p[0]), ...parts.map(p => p[1])]
}

export function parseChecklist(text: string): ChecklistSection[] {
  const pages = dropFurniture(text.replace(/\r/g, '').split('\f').map(p => p.split('\n')))
  const lines = pages.flatMap(p => [...splitColumns(p), ''])
  const out: ChecklistSection[] = []
  let sec: ChecklistSection | null = null
  let last: ChecklistItem | null = null
  let note: ChecklistItem | null = null
  let ended = true
  const section = (title: string) => { sec = { title, items: [] }; out.push(sec); last = null; note = null }
  const push = (it: ChecklistItem) => { if (!sec) section('Checklist'); sec!.items.push(it); last = it }

  for (const raw of lines) {
    if (!raw.trim()) { note = null; continue }
    const indent = raw.match(/^\s*/)![0].length
    const t = raw.trim()
    if (t.startsWith('#')) { section(clean(t.replace(/^#+/, ''))); continue }
    if (NOTE.test(unmark(clean(t)))) { note = { item: `${unmark(clean(t)).replace(/[:.]$/, '').toUpperCase()}:` }; push(note); continue }
    if (note) { note.item += ` ${clean(t)}`; continue }
    const numbered = NUM.test(t) || SUB.test(raw)
    const body = numbered ? t.replace(NUM, '') : t
    const m = body.match(SEP)
    const sep = m && m.index! > 0 ? [body.slice(0, m.index), body.slice(m.index! + m[0].length)] : [body]
    const gap = !numbered && sep.length < 2 ? body.match(/^(.+?\S)\s{3,}(\S.{0,40})$/) : null
    if (numbered || sep.length >= 2 || gap) {
      const [item, rest = ''] = gap ? [gap[1], gap[2]] : sep
      const action = tidyAction(rest)
      ended = /[.)]\s*$/.test(t)
      if (letters(item).length < 2) continue
      push({ item: clean(item), ...(action ? { action } : {}), ...(SUB.test(raw) || (indent >= 4 && /^[a-z][.)]/.test(t)) ? { sub: true } : {}) })
      continue
    }
    const c = clean(t)
    if (letters(c).length < 2) continue
    const h = unmark(c)
    const header = h.length <= 60 && letters(h).length >= 4 && !/[.,;]$/.test(h) && !/^[a-z]/.test(h) && !/[a-z][A-Z]|[A-Z]{2,}[a-z]/.test(h)
      && (upperShare(h) >= 0.6 || /:$/.test(h) || (/^[A-Z]{3,}\b/.test(h) && h.split(' ').length <= 6 && indent < 6))
    // Wrapped text: indented under a step, starts lower-case, or the step hasn't ended.
    const cont = last && (indent >= 6 || /^[a-z(]/.test(c) || !ended)
    ended = /[.)]\s*$/.test(t)
    if (header && !(cont && /^[a-z(]/.test(c))) { section(h.replace(/:$/, '')); continue }
    const prev = last as ChecklistItem | null
    if (cont && prev) { if (prev.action) prev.action = tidyAction(`${prev.action} ${c}`); else prev.item = `${prev.item} ${c}`; continue }
    push({ item: c })
  }
  return out.filter(s => s.items.length).map(s => ({ ...s, items: s.items.map(i => ({ ...i, item: i.item.replace(/\s+/g, ' ').trim().slice(0, 300), ...(i.action ? { action: i.action.slice(0, 200) } : {}) })) }))
}

// The editable form: "# SECTION", "Item -- ACTION", sub-steps indented.
export function formatChecklist(sections: ChecklistSection[]) {
  return sections.map(s => {
    let k = 0
    return [`# ${s.title}`, ...s.items.map(i => { k = i.sub ? k + 1 : 0; return `${i.sub ? `  ${String.fromCharCode(96 + Math.min(k, 26))}. ` : ''}${i.item}${i.action ? ` -- ${i.action}` : ''}` })].join('\n')
  }).join('\n\n')
}

export const stepCount = (s: ChecklistSection[] | null | undefined) => (s ?? []).reduce((n, x) => n + x.items.length, 0)
