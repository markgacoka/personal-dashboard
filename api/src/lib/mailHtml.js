// Prepares received HTML mail for display, and converts between HTML and
// plain text for outgoing mail. Pure string functions (no DOM).
//
// Display model: the browser shows the document in an <iframe sandbox> with no
// script permission, so the markup itself can't run code. This module adds a
// Content-Security-Policy that blocks remote content (tracking pixels, remote
// CSS and fonts) until the reader chooses to load it, strips elements that
// could navigate or embed other documents, and inlines cid: images.

const REMOTE_REF = /(?:\b(?:src|background|poster)\s*=\s*["']?\s*(?:https?:)?\/\/)|(?:url\(\s*["']?\s*(?:https?:)?\/\/)|(?:<link\b[^>]*\bhref\s*=\s*["']?\s*(?:https?:)?\/\/)/i

export function hasRemoteContent(html) {
  return REMOTE_REF.test(String(html || ''))
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Elements removed with their content, and void/wrapper elements removed alone.
const DROP_WITH_CONTENT = ['script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template']
const DROP_TAG_ONLY = ['base', 'form']

export function stripDangerous(html) {
  let out = String(html || '')
  for (const tag of DROP_WITH_CONTENT) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), '')
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>`, 'gi'), '')
  }
  for (const tag of DROP_TAG_ONLY) out = out.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi'), '')
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, '')
  // Inline event handlers and javascript: URLs (the sandbox blocks them too).
  out = out.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  out = out.replace(/(href|src|action|formaction)\s*=\s*(["']?)\s*javascript:[^"'>\s]*\2/gi, '$1="#"')
  return out
}

// cid: references -> data: URIs. images: Map of content-id (no brackets) -> data URI.
export function inlineCidImages(html, images) {
  if (!images?.size) return html
  return String(html).replace(/(["'(])cid:([^"')\s>]+)/gi, (m, pre, cid) => {
    const uri = images.get(decodeURIComponent(cid).replace(/^<|>$/g, ''))
    return uri ? pre + uri : m
  })
}

function csp(allowRemote) {
  const remote = allowRemote ? ' https: http:' : ''
  return [
    "default-src 'none'",
    `img-src data:${remote}`,
    `style-src 'unsafe-inline'${remote}`,
    `font-src data:${remote}`,
    `media-src data:${remote}`,
  ].join('; ')
}

// Full srcdoc document for the viewer iframe. Mail HTML is written for a light
// background, so the frame always renders on white (as Gmail and Fastmail do).
export function buildViewerDocument(bodyHtml, { allowRemote = false } = {}) {
  // Links open in new tabs with no handle back to this frame (reverse tabnabbing);
  // the first rel attribute wins if the mail already set one.
  const inner = stripDangerous(bodyHtml)
    .replace(/<!doctype[^>]*>/gi, '')
    .replace(/<\/?(html|head|body)\b[^>]*>/gi, '')
    .replace(/<a\b/gi, '<a rel="noopener noreferrer"')
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp(allowRemote)}">` +
    `<base target="_blank"><meta name="referrer" content="no-referrer">` +
    `<style>html,body{margin:0;background:#fff;color:#1f1f1f}` +
    `body{padding:16px 18px;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;overflow-wrap:anywhere}` +
    `img{max-width:100%;height:auto}table{max-width:100%}pre{white-space:pre-wrap}` +
    `blockquote{margin:0 0 0 .6em;padding-left:.8em;border-left:2px solid #d0d0d0;color:#555}</style>` +
    `</head><body>${inner}</body></html>`
}

// Remote images removed, for quoting mail into the composer: the composer is
// part of the dashboard page, where a tracking pixel would load and report
// the read.
export function stripRemoteImages(html) {
  return String(html || '')
    .replace(/<img\b[^>]*\bsrc\s*=\s*["']?\s*(?:https?:)?\/\/[^>]*>/gi, '')
    .replace(/\sbackground\s*=\s*["']?\s*(?:https?:)?\/\/[^\s"'>]*["']?/gi, '')
}

// Plain text -> HTML paragraphs with links, for quoting text-only mail.
export function textToHtml(text) {
  const escaped = escapeHtml(String(text || '').replace(/\r\n/g, '\n'))
  const linked = escaped.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, url => `<a href="${url}">${url}</a>`)
  return linked.split(/\n{2,}/).map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`).join('')
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

// HTML -> readable plain text for the text/plain alternative of outgoing mail.
export function htmlToText(html) {
  let s = String(html || '')
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/(p|div|h[1-6]|ul|ol|table|tr|blockquote)\s*>/gi, '\n\n')
    .replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (m, href, label) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return !text || text === href || href.startsWith('mailto:') ? (text || href) : `${text} (${href})`
    })
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      return ENTITIES[e.toLowerCase()] ?? m
    })
  s = s.split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n')
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

// Sanitize HTML written in the dashboard's composer before it is sent: keep
// formatting tags, drop everything else (pasted content can carry anything).
const COMPOSE_TAGS = new Set(['p', 'div', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'span', 'h1', 'h2', 'h3', 'pre', 'code', 'hr', 'img', 'table', 'thead', 'tbody', 'tr', 'td', 'th'])

export function sanitizeComposeHtml(html) {
  return stripDangerous(html)
    .replace(/<(style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?([a-z][a-z0-9]*)\b([^>]*)>/gi, (m, tag, attrs) => {
      const t = tag.toLowerCase()
      if (!COMPOSE_TAGS.has(t)) return ''
      if (m.startsWith('</')) return `</${t}>`
      const keep = []
      const href = attrs.match(/\bhref\s*=\s*"([^"]*)"|\bhref\s*=\s*'([^']*)'/i)
      if (t === 'a' && href) {
        const url = (href[1] ?? href[2]).trim()
        if (/^(https?:|mailto:)/i.test(url)) keep.push(`href="${escapeHtml(url)}"`)
      }
      const src = attrs.match(/\bsrc\s*=\s*"([^"]*)"|\bsrc\s*=\s*'([^']*)'/i)
      if (t === 'img') {
        const url = src ? (src[1] ?? src[2]).trim() : ''
        if (!/^(https:|data:image\/|cid:)/i.test(url)) return ''
        keep.push(`src="${escapeHtml(url)}"`)
      }
      return `<${t}${keep.length ? ' ' + keep.join(' ') : ''}>`
    })
}
