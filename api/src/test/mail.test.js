// Mail: unit tests for the pure modules (search parsing, Sieve compilation,
// HTML safety, reply construction) and the frontend mail helpers.
// Run: npm test (no network, no mail server needed).

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import { parseSearch, toJmapFilter, NO_MATCH } from '../lib/mailSearch.js'
import { compileSieve, sieveString, OTHER_KEYWORD } from '../lib/sieve.js'
import {
  buildViewerDocument, hasRemoteContent, stripDangerous, inlineCidImages, htmlToText,
  textToHtml, sanitizeComposeHtml, stripRemoteImages,
} from '../lib/mailHtml.js'
import {
  parseAddressList, prefixSubject, replyRecipients, receivedAt, quoteForReply, threadingHeaders,
} from '../lib/mailCompose.js'
import { dkimRecordsFromZone } from '../services/mailAdmin.js'

describe('mail search — parseSearch / toJmapFilter', () => {
  test('plain words become one text condition each', () => {
    assert.deepEqual(toJmapFilter(parseSearch('flight plan')), { operator: 'AND', conditions: [{ text: 'flight' }, { text: 'plan' }] })
  })
  test('quoted phrase stays together', () => {
    assert.deepEqual(toJmapFilter(parseSearch('"flight plan"')), { text: 'flight plan' })
  })
  test('operators map to JMAP conditions', () => {
    const f = toJmapFilter(parseSearch('from:ana to:bob subject:"q3 plan" has:attachment is:unread is:starred'))
    assert.deepEqual(f.conditions, [
      { from: 'ana' }, { to: 'bob' }, { subject: 'q3 plan' }, { hasAttachment: true },
      { notKeyword: '$seen' }, { hasKeyword: '$flagged' },
    ])
  })
  test('negation wraps in NOT', () => {
    assert.deepEqual(toJmapFilter(parseSearch('-newsletter')), { operator: 'NOT', conditions: [{ text: 'newsletter' }] })
  })
  test('dates become UTC day starts; invalid dates are ignored', () => {
    assert.deepEqual(toJmapFilter(parseSearch('after:2026-08-01 before:2026-09-01')).conditions,
      [{ after: '2026-08-01T00:00:00Z' }, { before: '2026-09-01T00:00:00Z' }])
    assert.equal(toJmapFilter(parseSearch('before:yesterday')), null)
  })
  test('labels and folders resolve through the caller; unknown ones match nothing', () => {
    const resolve = { label: n => n === 'travel' ? 'lbl_abc' : null, folder: n => n === 'archive' ? 'mbx1' : null }
    assert.deepEqual(toJmapFilter(parseSearch('label:travel in:archive'), resolve).conditions, [{ hasKeyword: 'lbl_abc' }, { inMailbox: 'mbx1' }])
    assert.deepEqual(toJmapFilter(parseSearch('label:nope'), resolve), NO_MATCH)
    assert.deepEqual(toJmapFilter(parseSearch('in:nowhere'), resolve), NO_MATCH)
  })
  test('unknown operator is treated as text', () => {
    assert.deepEqual(toJmapFilter(parseSearch('re:budget')), { text: 're:budget' })
  })
  test('empty query gives no filter', () => {
    assert.equal(toJmapFilter(parseSearch('   ')), null)
  })
})

describe('mail filters — compileSieve', () => {
  test('strings are escaped for Sieve', () => {
    assert.equal(sieveString('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"')
    assert.equal(sieveString('a\r\nb'), '"a b"')
  })
  test('filters are skipped for mail classified as spam', () => {
    const s = compileSieve({})
    assert.match(s, /^require \[.*"spamtest".*\];/m)
    assert.match(s, /if spamtest :value "lt" :comparator "i;ascii-numeric" "6" \{/)
  })
  test('split inbox flags bulk mail, except important senders', () => {
    const s = compileSieve({ split: { important: ['Boss@Work.test'], other: ['promo@x.test'] } })
    assert.match(s, /if not address :is "from" \["boss@work\.test"\]/)
    assert.match(s, /address :is "from" \["promo@x\.test"\]/)
    assert.match(s, /exists "list-unsubscribe"/)
    assert.ok(s.includes(`addflag "${OTHER_KEYWORD}"`))
  })
  test('split inbox can be turned off', () => {
    assert.ok(!compileSieve({ split: { enabled: false } }).includes('list-unsubscribe'))
  })
  test('a filter compiles conditions and actions; moves are applied once at the end', () => {
    const s = compileSieve({ archiveId: 'arch', rules: [
      { name: 'Receipts', match: 'any', conditions: [{ field: 'subject', value: 'Receipt' }, { field: 'from', op: 'is', value: 'shop@x.test' }],
        actions: { archive: true, labelKeyword: 'lbl_1', markRead: true, star: true } },
    ] })
    assert.match(s, /if anyof\(header :contains "subject" "Receipt", address :is "from" "shop@x\.test"\) \{/)
    assert.match(s, /addflag "lbl_1";/)
    assert.match(s, /addflag "\\\\Seen";/)
    assert.match(s, /addflag "\\\\Flagged";/)
    assert.match(s, /set "dest" "arch";/)
    assert.match(s, /fileinto :mailboxid "\$\{dest\}" "INBOX";/)
  })
  test('disabled, empty or action-less filters are left out', () => {
    const s = compileSieve({ rules: [
      { name: 'off', enabled: false, conditions: [{ field: 'from', value: 'a' }], actions: { star: true } },
      { name: 'no conditions', conditions: [], actions: { star: true } },
      { name: 'no actions', conditions: [{ field: 'from', value: 'a' }], actions: {} },
    ] })
    assert.ok(!s.includes('# Filter'))
  })
  test('filter names cannot break out of their comment', () => {
    const s = compileSieve({ rules: [{ name: 'x\nkeep;', conditions: [{ field: 'from', value: 'a' }], actions: { star: true } }] })
    assert.ok(s.includes('# Filter: x keep;'))
    assert.ok(!/^keep;$/m.test(s))
  })
})

describe('mail HTML — viewer safety', () => {
  test('scripts, frames, handlers and javascript: URLs are removed', () => {
    const out = stripDangerous('<p onclick="x()">hi</p><script>alert(1)</script><iframe src="//e"></iframe><a href="javascript:alert(1)">l</a><form action="/x"><input></form>')
    assert.ok(!/script|iframe|onclick|javascript:|<form/i.test(out))
    assert.match(out, /<p>hi<\/p>/)
  })
  test('meta refresh is removed', () => {
    assert.ok(!/refresh/i.test(stripDangerous('<meta http-equiv="refresh" content="0;url=https://e">')))
  })
  test('remote content is detected', () => {
    assert.ok(hasRemoteContent('<img src="https://t.example/p.gif">'))
    assert.ok(hasRemoteContent('<td background="http://x/y.png">'))
    assert.ok(hasRemoteContent('<div style="background:url(https://x/y.png)">'))
    assert.ok(!hasRemoteContent('<img src="data:image/png;base64,AAA">'))
  })
  test('viewer blocks remote images unless allowed', () => {
    assert.match(buildViewerDocument('<p>x</p>'), /img-src data:;/)
    assert.match(buildViewerDocument('<p>x</p>', { allowRemote: true }), /img-src data: https: http:;/)
    assert.match(buildViewerDocument('<p>x</p>'), /<base target="_blank">/)
  })
  test('viewer links carry noopener (no reverse tabnabbing)', () => {
    assert.match(buildViewerDocument('<a href="https://x.test" rel="opener">x</a>'), /<a rel="noopener noreferrer" href="https:\/\/x\.test" rel="opener">/)
  })
  test('cid images are inlined', () => {
    const out = inlineCidImages('<img src="cid:logo@x">', new Map([['logo@x', 'data:image/png;base64,AAA']]))
    assert.equal(out, '<img src="data:image/png;base64,AAA">')
  })
  test('quoted mail loses remote images (no tracking pixels in the composer)', () => {
    assert.equal(stripRemoteImages('<p>a</p><img src="https://t.example/p.gif" width="1"><img src="data:image/png;base64,A">'),
      '<p>a</p><img src="data:image/png;base64,A">')
  })
})

describe('mail HTML — composing', () => {
  test('composer HTML keeps formatting and safe links only', () => {
    const out = sanitizeComposeHtml('<p style="color:red">Hi <b>there</b> <a href="https://x.test" onclick="y">x</a> <a href="javascript:z">z</a></p><img src=x onerror=alert(1)><font>f</font>')
    assert.equal(out, '<p>Hi <b>there</b> <a href="https://x.test">x</a> <a>z</a></p>f')
  })
  test('html to text keeps structure and link targets', () => {
    assert.equal(htmlToText('<p>Hello <b>you</b></p><p>See <a href="https://x.test">site</a></p><ul><li>one</li><li>two</li></ul>'),
      'Hello you\n\nSee site (https://x.test)\n\n- one\n- two')
    assert.equal(htmlToText('a&amp;b &lt;c&gt; &#39;d&#39;'), "a&b <c> 'd'")
  })
  test('text to html escapes and links', () => {
    assert.equal(textToHtml('a <b>\nsee https://x.test.\n\nnext'), '<p>a &lt;b&gt;<br>see <a href="https://x.test">https://x.test</a>.</p><p>next</p>')
  })
})

describe('mail compose — addresses and replies', () => {
  test('address lists parse names, quotes and separators', () => {
    assert.deepEqual(parseAddressList('Ana Lee <ana@x.test>, bob@y.test; "Doe, J" <j@z.test>'), [
      { name: 'Ana Lee', email: 'ana@x.test' }, { name: null, email: 'bob@y.test' }, { name: 'Doe, J', email: 'j@z.test' },
    ])
  })
  test('an invalid address is a 400 naming it', () => {
    assert.throws(() => parseAddressList('ana@x.test, nope'), e => e.statusCode === 400 && /nope/.test(e.message))
  })
  test('subjects get one Re:/Fwd: prefix', () => {
    assert.equal(prefixSubject('Plan', 'Re'), 'Re: Plan')
    assert.equal(prefixSubject('RE: Plan', 'Re'), 'RE: Plan')
    assert.equal(prefixSubject('Fw: Plan', 'Fwd'), 'Fw: Plan')
  })
  const msg = { from: [{ name: 'Ana', email: 'ana@x.test' }], to: [{ email: 'hello@gacoka.com' }, { email: 'bob@y.test' }], cc: [{ email: 'cat@z.test' }], replyTo: [] }
  test('reply goes to the sender; reply all adds everyone else but me', () => {
    assert.deepEqual(replyRecipients(msg, ['hello@gacoka.com']), { to: [{ name: 'Ana', email: 'ana@x.test' }], cc: [] })
    const all = replyRecipients(msg, ['hello@gacoka.com'], { all: true })
    assert.deepEqual(all.cc.map(a => a.email), ['bob@y.test', 'cat@z.test'])
  })
  test('Reply-To wins over From', () => {
    assert.deepEqual(replyRecipients({ ...msg, replyTo: [{ email: 'list@x.test' }] }, ['hello@gacoka.com']).to, [{ email: 'list@x.test' }])
  })
  test('replying to my own message goes to its recipients', () => {
    const mine = { from: [{ email: 'hello@gacoka.com' }], to: [{ email: 'bob@y.test' }] }
    assert.deepEqual(replyRecipients(mine, ['hello@gacoka.com']).to, [{ email: 'bob@y.test' }])
  })
  test('the reply comes from the address the mail was sent to (alias or catch-all)', () => {
    assert.equal(receivedAt({ to: [{ email: 'Flights@gacoka.com' }] }, ['hello@gacoka.com', 'flights@gacoka.com'], 'gacoka.com'), 'flights@gacoka.com')
    assert.equal(receivedAt({ to: [{ email: 'shop1@gacoka.com' }] }, ['hello@gacoka.com'], 'gacoka.com'), 'shop1@gacoka.com')
    assert.equal(receivedAt({ to: [{ email: 'x@other.test' }] }, ['hello@gacoka.com'], 'gacoka.com'), null)
  })
  test('threading headers chain message ids', () => {
    assert.deepEqual(threadingHeaders({ messageId: ['c@x'], references: ['a@x', 'b@x'] }), { inReplyTo: ['c@x'], references: ['a@x', 'b@x', 'c@x'] })
  })
  test('quote escapes the sender and wraps the body', () => {
    const q = quoteForReply({ from: [{ name: '<Ana>', email: 'a@x.test' }], receivedAt: '2026-09-28T20:00:00Z', text: 'hi' })
    assert.match(q, /&lt;Ana&gt; &lt;a@x\.test&gt; wrote:/)
    assert.match(q, /<blockquote><p>hi<\/p><\/blockquote>/)
  })
})

describe('mail admin — DKIM records from the server zone file', () => {
  test('single-line and multi-line TXT records are joined', () => {
    const zone = `a._domainkey.gacoka.com. IN TXT "v=DKIM1; k=ed25519; p=AAA"
b._domainkey.gacoka.com. IN TXT (
    "v=DKIM1; k=rsa; p=BBB"
    "CCC"
)
gacoka.com. IN MX 10 mail.gacoka.com.`
    assert.deepEqual(dkimRecordsFromZone(zone), [
      { name: 'a._domainkey.gacoka.com', value: 'v=DKIM1; k=ed25519; p=AAA' },
      { name: 'b._domainkey.gacoka.com', value: 'v=DKIM1; k=rsa; p=BBBCCC' },
    ])
  })
})

import { matchRelayEmail, replaceMessageId, parseRelayTime } from '../lib/mailRelay.js'

describe('mail relay — Message-ID reconciliation', () => {
  const sendAt = Date.parse('2026-09-29T01:19:21Z')
  const sent = { from: 'hello@gacoka.com', subject: 'Hello from my new address', rcpts: ['markgacoka@gmail.com'], sendAt }
  const rec = (over = {}) => ({
    id: 'r1', from: 'hello@gacoka.com', to: ['Mark <markgacoka@gmail.com>'], cc: null, bcc: null,
    subject: 'Hello from my new address', created_at: '2026-09-29 01:19:22.581000+00',
    message_id: '<0100-abc@email.amazonses.com>', ...over,
  })
  test('relay timestamps parse as UTC', () => {
    assert.equal(parseRelayTime('2026-09-29 01:19:22.581000+00'), Date.parse('2026-09-29T01:19:22.581Z'))
    assert.equal(parseRelayTime('garbage'), null)
  })
  test('matches on sender, subject, recipients and time', () => {
    assert.equal(matchRelayEmail(sent, [rec()])?.id, 'r1')
  })
  test('rejects a different subject, sender, recipient, or a time far away', () => {
    assert.equal(matchRelayEmail(sent, [rec({ subject: 'Other' })]), null)
    assert.equal(matchRelayEmail(sent, [rec({ from: 'flights@gacoka.com' })]), null)
    assert.equal(matchRelayEmail(sent, [rec({ to: ['someone@else.test'] })]), null)
    assert.equal(matchRelayEmail(sent, [rec({ created_at: '2026-09-29 03:00:00.000000+00' })]), null)
  })
  test('picks the closest unused record when the same message is sent twice', () => {
    const a = rec({ id: 'a', created_at: '2026-09-29 01:19:22.000000+00' })
    const b = rec({ id: 'b', created_at: '2026-09-29 01:25:00.000000+00' })
    assert.equal(matchRelayEmail(sent, [b, a])?.id, 'a')
    assert.equal(matchRelayEmail(sent, [b, a], new Set(['a']))?.id, 'b')
  })
  test('rewrites the Message-ID header only in the header block, folded or not', () => {
    const raw = 'From: a@b\r\nMessage-ID:\r\n <old@mail.gacoka.com>\r\nSubject: x\r\n\r\nbody Message-ID: <keep@x>\r\n'
    const out = replaceMessageId(raw, '<new@ses>').toString('latin1')
    assert.equal(out, 'From: a@b\r\nMessage-ID: <new@ses>\r\nSubject: x\r\n\r\nbody Message-ID: <keep@x>\r\n')
  })
  test('adds a Message-ID header when missing', () => {
    assert.match(replaceMessageId('Subject: x\n\nbody', 'new@ses').toString(), /^Message-ID: <new@ses>\nSubject: x\n\nbody$/)
  })
})
