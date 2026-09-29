'use strict';

// ─── mail composer ────────────────────────────────────────────────────────────
// One docked composer at a time (full screen on phones). Drafts autosave to
// the server; Send holds the message on the server for the undo window (or
// until the scheduled time), so Undo and "Cancel send" work even after a reload.

const COMPOSE = { el: null, state: null };
const MAIL_SIG_CLASS = 'mail-sig';
const MAIL_FOLLOWUP_CHOICES = [[0, "Don't remind me"], [1, 'Remind me in 1 day if no reply'], [3, 'Remind me in 3 days if no reply'], [7, 'Remind me in 1 week if no reply']];

// Allowlist sanitizer for pasted HTML (the server sanitizes again on save).
const MAIL_PASTE_TAGS = new Set(['P', 'DIV', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'PRE', 'CODE', 'SPAN', 'TABLE', 'TBODY', 'TR', 'TD', 'TH']);
function mailCleanHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = node => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 8) { child.remove(); continue; }
      if (child.nodeType !== 1) continue;
      if (!MAIL_PASTE_TAGS.has(child.tagName)) {
        if (['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) { child.remove(); continue; }
        walk(child);
        child.replaceWith(...child.childNodes);
        continue;
      }
      const href = child.tagName === 'A' ? child.getAttribute('href') : null;
      for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
      if (href && /^(https?:|mailto:)/i.test(href)) child.setAttribute('href', href);
      walk(child);
    }
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

function mailAddressOptions(selected) {
  const addrs = MAIL.boot?.addresses?.addresses?.map(a => a.email) || [MAIL.boot?.address].filter(Boolean);
  const list = addrs.includes(selected) || !selected ? addrs : [...addrs, selected];
  return list.map(e => `<option value="${esc(e)}"${e === selected ? ' selected' : ''}>${esc(e)}${addrs.includes(e) ? '' : ' (becomes an alias)'}</option>`).join('');
}

function mailSignatureFor(email) {
  return MAIL.boot?.identities?.find(i => i.email === email)?.htmlSignature || '';
}

async function openComposer({ mode = 'new', emailId, threadId, to } = {}) {
  if (COMPOSE.el) await closeComposer({ save: true, quiet: true });
  if (!MAIL.boot) { try { await loadMailBoot(); } catch (err) { mailToast(err.message, { error: true }); return; } }
  let ctx;
  try {
    ctx = await mailApi(`/compose?mode=${encodeURIComponent(mode)}${emailId ? '&emailId=' + encodeURIComponent(emailId) : ''}`);
  } catch (err) { mailToast(err.message, { error: true }); return; }
  if (to) ctx.to = [...ctx.to, ...to];
  const sig = mode === 'draft' ? '' : mailSignatureFor(ctx.from);
  const bodyHtml = mode === 'draft' ? ctx.html
    : `<p><br></p>${sig ? `<div class="${MAIL_SIG_CLASS}">${sig}</div>` : ''}${ctx.html || ''}`;
  COMPOSE.state = {
    mode, threadId: threadId || ctx.threadId || null, draftId: ctx.draftId || null,
    inReplyTo: ctx.inReplyTo, references: ctx.references,
    attachments: ctx.attachments || [], uploading: 0,
    dirty: false, saving: Promise.resolve(), saveTimer: null, lastSaved: null, sending: false,
  };
  renderComposer(ctx, bodyHtml);
}

function renderComposer(ctx, bodyHtml) {
  const title = { new: 'New message', reply: 'Reply', replyAll: 'Reply all', forward: 'Forward', draft: 'Draft' }[COMPOSE.state.mode] || 'New message';
  const el = document.createElement('section');
  el.className = 'mail-composer';
  el.setAttribute('aria-label', title);
  el.innerHTML = `
    <header class="mc-hd">
      <span class="mc-title">${esc(title)}</span>
      <span class="mc-status" id="mc-status" aria-live="polite"></span>
      <button class="mc-icon" id="mc-min" title="Minimize" aria-label="Minimize"><i class="ph-bold ph-minus"></i></button>
      <button class="mc-icon" id="mc-close" title="Save draft and close" aria-label="Save draft and close"><i class="ph-bold ph-x"></i></button>
    </header>
    <div class="mc-body">
      <div class="mc-row"><label class="mc-lbl" for="mc-from">From</label><select class="mc-from" id="mc-from">${mailAddressOptions(ctx.from)}</select></div>
      <div class="mc-row"><span class="mc-lbl">To</span><div class="mc-rcpt" data-field="to"></div>
        <span class="mc-cc-links"><button class="btn-link" data-show="cc">Cc</button><button class="btn-link" data-show="bcc">Bcc</button></span></div>
      <div class="mc-row" data-row="cc" hidden><span class="mc-lbl">Cc</span><div class="mc-rcpt" data-field="cc"></div></div>
      <div class="mc-row" data-row="bcc" hidden><span class="mc-lbl">Bcc</span><div class="mc-rcpt" data-field="bcc"></div></div>
      <div class="mc-row"><input class="mc-subject" id="mc-subject" placeholder="Subject" aria-label="Subject" maxlength="500" value="${esc(ctx.subject)}"></div>
      <div class="mc-toolbar" role="toolbar" aria-label="Formatting">
        <button class="mc-tool" data-cmd="bold" title="Bold" aria-label="Bold"><i class="ph-bold ph-text-b"></i></button>
        <button class="mc-tool" data-cmd="italic" title="Italic" aria-label="Italic"><i class="ph-bold ph-text-italic"></i></button>
        <button class="mc-tool" data-cmd="underline" title="Underline" aria-label="Underline"><i class="ph-bold ph-text-underline"></i></button>
        <button class="mc-tool" data-cmd="link" title="Link" aria-label="Insert link"><i class="ph-bold ph-link"></i></button>
        <span class="mc-tool-sep"></span>
        <button class="mc-tool" data-cmd="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list"><i class="ph-bold ph-list-bullets"></i></button>
        <button class="mc-tool" data-cmd="insertOrderedList" title="Numbered list" aria-label="Numbered list"><i class="ph-bold ph-list-numbers"></i></button>
        <button class="mc-tool" data-cmd="quote" title="Quote" aria-label="Quote"><i class="ph-bold ph-quotes"></i></button>
        <button class="mc-tool" data-cmd="removeFormat" title="Clear formatting" aria-label="Clear formatting"><i class="ph-bold ph-text-t-slash"></i></button>
        <span class="mc-tool-sep"></span>
        <button class="mc-tool" id="mc-template" title="Insert template" aria-label="Insert template"><i class="ph-bold ph-note"></i></button>
        <button class="mc-tool" id="mc-attach" title="Attach files" aria-label="Attach files"><i class="ph-bold ph-paperclip"></i></button>
        <input type="file" id="mc-file" multiple hidden>
      </div>
      <div class="mc-editor" id="mc-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message">${bodyHtml}</div>
      <div class="mc-atts" id="mc-atts"></div>
      <div class="mc-error" id="mc-error" role="alert" hidden></div>
    </div>
    <footer class="mc-ft">
      <div class="mc-send">
        <button class="btn-primary" id="mc-send"><i class="ph-bold ph-paper-plane-tilt"></i>Send</button>
        <button class="btn-primary mc-send-more" id="mc-send-later" title="Send later" aria-label="Send later"><i class="ph-bold ph-caret-down"></i></button>
      </div>
      <select class="mc-followup" id="mc-followup" aria-label="Follow-up reminder">${MAIL_FOLLOWUP_CHOICES.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>
      <span class="mc-spacer"></span>
      <button class="mc-icon" id="mc-discard" title="Discard draft" aria-label="Discard draft"><i class="ph-bold ph-trash"></i></button>
    </footer>`;
  document.body.appendChild(el);
  COMPOSE.el = el;

  for (const field of ['to', 'cc', 'bcc']) mountRecipientField(el.querySelector(`[data-field="${field}"]`), ctx[field] || []);
  if ((ctx.cc || []).length) el.querySelector('[data-row="cc"]').hidden = false;
  if ((ctx.bcc || []).length) el.querySelector('[data-row="bcc"]').hidden = false;
  renderComposerAtts();

  const editor = el.querySelector('#mc-editor');
  el.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => {
    const row = el.querySelector(`[data-row="${b.dataset.show}"]`);
    row.hidden = false; b.hidden = true; row.querySelector('input').focus();
  }));
  el.querySelector('#mc-close').addEventListener('click', () => closeComposer({ save: true }));
  el.querySelector('#mc-min').addEventListener('click', () => {
    el.classList.toggle('min');
    el.querySelector('#mc-min i').className = 'ph-bold ' + (el.classList.contains('min') ? 'ph-arrows-out-simple' : 'ph-minus');
  });
  el.querySelector('.mc-hd').addEventListener('click', e => { if (el.classList.contains('min') && !e.target.closest('button')) el.querySelector('#mc-min').click(); });
  el.querySelector('#mc-discard').addEventListener('click', discardComposer);
  el.querySelector('#mc-send').addEventListener('click', () => sendComposer());
  el.querySelector('#mc-send-later').addEventListener('click', e => sendLaterMenu(e.currentTarget));
  el.querySelector('#mc-from').addEventListener('change', e => { swapSignature(e.target.value); markComposerDirty(); });
  el.querySelector('#mc-subject').addEventListener('input', markComposerDirty);
  editor.addEventListener('input', markComposerDirty);
  editor.addEventListener('paste', e => {
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    e.preventDefault();
    if (html) document.execCommand('insertHTML', false, mailCleanHtml(html));
    else document.execCommand('insertText', false, text);
  });
  el.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('mousedown', e => e.preventDefault()));
  el.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', () => {
    const cmd = b.dataset.cmd;
    editor.focus();
    if (cmd === 'link') return mailLinkPrompt(b);
    if (cmd === 'quote') document.execCommand('formatBlock', false, 'blockquote');
    else document.execCommand(cmd, false, null);
    markComposerDirty();
  }));
  el.querySelector('#mc-template').addEventListener('click', e => templateMenu(e.currentTarget));
  el.querySelector('#mc-attach').addEventListener('click', () => el.querySelector('#mc-file').click());
  el.querySelector('#mc-file').addEventListener('change', e => { uploadComposerFiles([...e.target.files]); e.target.value = ''; });
  el.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); el.classList.add('drop'); } });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop'); });
  el.addEventListener('drop', e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); el.classList.remove('drop'); uploadComposerFiles([...e.dataTransfer.files]); } });

  // Focus where the writer starts: recipients for a new message, the body for replies.
  const toInput = el.querySelector('[data-field="to"] input');
  if (COMPOSE.state.mode === 'new' || COMPOSE.state.mode === 'forward' || !toInput.closest('.mc-rcpt').querySelector('.mc-token')) toInput.focus();
  else { editor.focus(); const r = document.createRange(); r.setStart(editor, 0); r.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(r); }
}

function swapSignature(email) {
  const editor = COMPOSE.el.querySelector('#mc-editor');
  const sig = mailSignatureFor(email);
  const current = editor.querySelector('.' + MAIL_SIG_CLASS);
  if (current && sig) current.innerHTML = sig;
  else if (current) current.remove();
  else if (sig) {
    const div = document.createElement('div');
    div.className = MAIL_SIG_CLASS;
    div.innerHTML = sig;
    const quote = editor.querySelector(':scope > blockquote, :scope > p + blockquote');
    editor.insertBefore(div, quote ? quote.previousElementSibling || quote : null);
  }
}

// ─── recipients ───────────────────────────────────────────────────────────────
function mountRecipientField(box, initial) {
  box.innerHTML = `<input class="mc-rcpt-input" autocomplete="off" aria-label="${esc(box.dataset.field)} recipients" aria-autocomplete="list">`;
  const input = box.querySelector('input');
  const add = addr => {
    const chip = document.createElement('span');
    const valid = !!addr.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.email);
    chip.className = 'mc-token' + (valid ? '' : ' invalid');
    chip.dataset.email = addr.email || addr.raw;
    if (addr.name) chip.dataset.name = addr.name;
    chip.title = valid ? addr.email : 'Not a valid address';
    chip.innerHTML = `<span>${esc(addr.name || addr.email || addr.raw)}</span><button type="button" aria-label="Remove ${esc(addr.email || addr.raw)}"><i class="ph-bold ph-x"></i></button>`;
    chip.querySelector('button').addEventListener('click', () => { chip.remove(); markComposerDirty(); input.focus(); });
    box.insertBefore(chip, input);
  };
  initial.forEach(a => add(a));
  const commit = () => {
    const parts = input.value.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    if (!parts.length) return false;
    for (const p of parts) add(parseMailToken(p) || { raw: p });
    input.value = '';
    closeSuggest();
    markComposerDirty();
    return true;
  };
  box.addEventListener('click', e => { if (e.target === box) input.focus(); });
  input.addEventListener('keydown', e => {
    const sug = document.getElementById('mc-suggest');
    if (sug && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const items = [...sug.querySelectorAll('button')];
      const i = items.findIndex(b => b.classList.contains('active'));
      items.forEach(b => b.classList.remove('active'));
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.classList.add('active');
      return;
    }
    if (e.key === 'Enter' && sug?.querySelector('.active')) { e.preventDefault(); sug.querySelector('.active').click(); return; }
    if (e.key === 'Escape' && sug) { closeSuggest(); return; }
    if ((e.key === 'Enter' || e.key === ',' || e.key === ';' || (e.key === 'Tab' && input.value.trim())) && commit()) e.preventDefault();
    if (e.key === 'Backspace' && !input.value) { const last = input.previousElementSibling; if (last?.classList.contains('mc-token')) { last.remove(); markComposerDirty(); } }
  });
  input.addEventListener('paste', () => setTimeout(() => { if (/[,;\n]/.test(input.value)) commit(); }));
  input.addEventListener('blur', () => setTimeout(() => { if (!document.getElementById('mc-suggest')?.matches(':hover')) commit(); }, 150));
  let timer = null, seq = 0;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 1) return closeSuggest();
    timer = setTimeout(async () => {
      const mine = ++seq;
      const results = await mailApi('/contacts?q=' + encodeURIComponent(q)).catch(() => []);
      if (mine !== seq || input.value.trim() !== q) return;
      showSuggest(input, results, r => { add({ name: r.name, email: r.email }); input.value = ''; closeSuggest(); markComposerDirty(); input.focus(); });
    }, 150);
  });
}

function closeSuggest() { document.getElementById('mc-suggest')?.remove(); }
function showSuggest(input, results, pick) {
  closeSuggest();
  if (!results.length) return;
  const box = document.createElement('div');
  box.id = 'mc-suggest';
  box.className = 'mail-menu mc-suggest';
  box.setAttribute('role', 'listbox');
  box.innerHTML = results.map((r, i) => `<button role="option" class="mail-menu-item${i === 0 ? ' active' : ''}" data-i="${i}"><span>${esc(r.name || r.email)}</span>${r.name ? `<span class="mail-menu-hint">${esc(r.email)}</span>` : ''}</button>`).join('');
  document.body.appendChild(box);
  const rect = input.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(rect.left, innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = (rect.bottom + 4 + box.offsetHeight > innerHeight ? rect.top - box.offsetHeight - 4 : rect.bottom + 4) + 'px';
  box.addEventListener('mousedown', e => e.preventDefault());
  box.addEventListener('click', e => { const b = e.target.closest('[data-i]'); if (b) pick(results[+b.dataset.i]); });
}

function readRecipients(field) {
  return [...COMPOSE.el.querySelectorAll(`[data-field="${field}"] .mc-token`)].map(t => ({ name: t.dataset.name || null, email: t.dataset.email, invalid: t.classList.contains('invalid') }));
}

// ─── link prompt (inline popover, no browser dialog) ──────────────────────────
function mailLinkPrompt(anchor) {
  const sel = getSelection();
  const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
  closeMailMenu();
  const pop = document.createElement('form');
  pop.id = 'mail-menu';
  pop.className = 'mail-menu mc-link-pop';
  pop.innerHTML = `<input class="form-input" type="url" placeholder="https://" aria-label="Link address" required><button class="btn-ghost btn-sm" type="submit">Add link</button>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = (r.bottom + 4) + 'px';
  const input = pop.querySelector('input');
  input.focus();
  input.addEventListener('keydown', e => { if (e.key === 'Escape') closeMailMenu(); });
  pop.addEventListener('submit', e => {
    e.preventDefault();
    let url = input.value.trim();
    if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url;
    closeMailMenu();
    const editor = COMPOSE.el.querySelector('#mc-editor');
    editor.focus();
    if (range) { sel.removeAllRanges(); sel.addRange(range); }
    if (range && !range.collapsed) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`);
    markComposerDirty();
  });
  setTimeout(() => {
    const off = e => { if (!pop.contains(e.target)) { closeMailMenu(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
}

async function templateMenu(anchor) {
  let list = [];
  try { list = await mailApi('/templates'); } catch (err) { mailToast(err.message, { error: true }); return; }
  mailMenu(anchor, [
    ...list.map(t => ({ label: t.name, icon: 'ph-note', run: () => {
      const editor = COMPOSE.el.querySelector('#mc-editor');
      editor.focus();
      document.execCommand('insertHTML', false, t.html);
      const subject = COMPOSE.el.querySelector('#mc-subject');
      if (!subject.value && t.subject) subject.value = t.subject;
      markComposerDirty();
    } })),
    ...(list.length ? [{ sep: true }] : []),
    { label: 'Manage templates…', icon: 'ph-gear-six', run: () => navigate('mail-settings') },
  ]);
}

// ─── attachments ──────────────────────────────────────────────────────────────
function renderComposerAtts() {
  const box = COMPOSE.el.querySelector('#mc-atts');
  const s = COMPOSE.state;
  box.innerHTML = s.attachments.map((a, i) => `<span class="mc-att${a.pending ? ' pending' : ''}${a.error ? ' invalid' : ''}" title="${esc(a.error || a.name)}">
      <i class="ph-bold ${a.pending ? 'ph-circle-notch mc-spin' : a.error ? 'ph-warning' : 'ph-paperclip'}"></i>
      <span class="mc-att-name">${esc(a.name)}</span><span class="mc-att-size">${esc(a.error ? 'Failed' : fmtBytes(a.size))}</span>
      <button type="button" data-rm="${i}" aria-label="Remove ${esc(a.name)}"><i class="ph-bold ph-x"></i></button></span>`).join('');
  box.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { s.attachments.splice(+b.dataset.rm, 1); renderComposerAtts(); markComposerDirty(); }));
}

async function uploadComposerFiles(files) {
  const s = COMPOSE.state;
  const limit = MAIL.boot.limits.attachmentsBytes;
  for (const file of files) {
    const used = s.attachments.filter(a => !a.error).reduce((n, a) => n + (a.size || 0), 0);
    if (used + file.size > limit) { composerError(`${file.name} would take attachments over the ${fmtBytes(limit)} limit.`); continue; }
    const entry = { name: file.name, size: file.size, type: file.type || 'application/octet-stream', pending: true };
    s.attachments.push(entry);
    s.uploading++;
    renderComposerAtts();
    try {
      const r = await fetch('/api/mail/upload', {
        method: 'POST', credentials: 'same-origin', body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Type': entry.type },
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || `Upload failed (${r.status})`);
      Object.assign(entry, { blobId: data.blobId, size: data.size, pending: false });
    } catch (err) {
      Object.assign(entry, { pending: false, error: err.message });
    }
    s.uploading--;
    if (COMPOSE.state === s) { renderComposerAtts(); markComposerDirty(); }
  }
}

function composerError(text) {
  const el = COMPOSE.el?.querySelector('#mc-error');
  if (!el) return;
  el.textContent = text || '';
  el.hidden = !text;
}

// ─── drafts ───────────────────────────────────────────────────────────────────
function composerPayload() {
  const el = COMPOSE.el, s = COMPOSE.state;
  const editor = el.querySelector('#mc-editor');
  const strip = list => list.filter(a => !a.invalid).map(({ name, email }) => ({ name, email }));
  return {
    draftId: s.draftId,
    from: el.querySelector('#mc-from').value,
    to: strip(readRecipients('to')), cc: strip(readRecipients('cc')), bcc: strip(readRecipients('bcc')),
    subject: el.querySelector('#mc-subject').value,
    html: editor.innerHTML,
    attachments: s.attachments.filter(a => a.blobId && !a.error).map(({ blobId, name, type, size }) => ({ blobId, name, type, size })),
    inReplyTo: s.inReplyTo, references: s.references,
  };
}

function composerHasContent() {
  const el = COMPOSE.el;
  const editor = el.querySelector('#mc-editor').cloneNode(true);
  editor.querySelector('.' + MAIL_SIG_CLASS)?.remove();
  editor.querySelectorAll('blockquote').forEach(q => q.remove());
  return !!(editor.textContent.trim() || el.querySelector('#mc-subject').value.trim() || readRecipients('to').length || COMPOSE.state.attachments.length);
}

function markComposerDirty() {
  const s = COMPOSE.state;
  if (!s) return;
  s.dirty = true;
  composerError('');
  clearTimeout(s.saveTimer);
  s.saveTimer = setTimeout(() => saveComposerDraft(), 2500);
}

// Saves are chained so two never race (each replaces the previous draft).
function saveComposerDraft() {
  const s = COMPOSE.state;
  if (!s || !s.dirty || s.sending) return s?.saving || Promise.resolve();
  clearTimeout(s.saveTimer);
  if (!composerHasContent()) return s.saving;
  s.dirty = false;
  const payload = composerPayload();
  const status = COMPOSE.el.querySelector('#mc-status');
  status.textContent = 'Saving…';
  s.saving = s.saving.then(async () => {
    try {
      const { draftId } = await mailApi('/drafts', { method: 'POST', body: { ...payload, draftId: s.draftId } });
      s.draftId = draftId;
      s.lastSaved = new Date();
      if (COMPOSE.state === s) status.textContent = 'Saved ' + s.lastSaved.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    } catch (err) {
      s.dirty = true;
      if (COMPOSE.state === s) status.textContent = 'Not saved';
      composerError('Draft not saved: ' + err.message);
    }
  });
  return s.saving;
}

async function closeComposer({ save = true, quiet = false } = {}) {
  const s = COMPOSE.state, el = COMPOSE.el;
  if (!el) return;
  closeSuggest(); closeMailMenu();
  if (save && s.dirty && composerHasContent()) {
    await saveComposerDraft();
    if (!quiet) mailToast('Draft saved', { actionLabel: 'Open', onAction: () => openComposer({ mode: 'draft', emailId: s.draftId, threadId: s.threadId }) });
  } else {
    await s.saving;
  }
  el.remove();
  COMPOSE.el = COMPOSE.state = null;
  refreshMailCounts();
  if (_currentView === 'mail' && MAIL.folder === 'drafts') loadMailThreads();
}

async function discardComposer() {
  const s = COMPOSE.state;
  clearTimeout(s.saveTimer);
  s.dirty = false;
  await s.saving;
  if (s.draftId) await mailApi('/drafts/' + encodeURIComponent(s.draftId), { method: 'DELETE' }).catch(() => {});
  await closeComposer({ save: false });
  mailToast('Draft discarded');
}

// ─── send ─────────────────────────────────────────────────────────────────────
function sendLaterMenu(anchor) {
  mailMenu(anchor, [
    ...mailSchedulePresets().map(p => ({
      label: p.label, icon: 'ph-clock',
      hint: p.at.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }),
      run: () => sendComposer(p.at),
    })),
    { sep: true },
    { label: 'Pick date and time…', icon: 'ph-calendar-dots', run: () => customSchedulePrompt(anchor) },
  ]);
}

function customSchedulePrompt(anchor) {
  closeMailMenu();
  const pad = n => String(n).padStart(2, '0');
  const local = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const min = new Date(Date.now() + 5 * 60000), max = new Date(Date.now() + MAIL.boot.limits.scheduleDays * 86400000 - 60000);
  const def = new Date(Date.now() + 86400000); def.setHours(8, 0, 0, 0);
  const pop = document.createElement('form');
  pop.id = 'mail-menu';
  pop.className = 'mail-menu mc-link-pop';
  pop.innerHTML = `<input class="form-input" type="datetime-local" min="${local(min)}" max="${local(max)}" value="${local(def)}" aria-label="Send at" required><button class="btn-primary btn-sm" type="submit">Schedule</button>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
  pop.style.top = Math.max(8, r.top - pop.offsetHeight - 6) + 'px';
  pop.querySelector('input').focus();
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') closeMailMenu(); });
  pop.addEventListener('submit', e => {
    e.preventDefault();
    const at = new Date(pop.querySelector('input').value);
    closeMailMenu();
    sendComposer(at);
  });
}

async function sendComposer(sendAt) {
  const s = COMPOSE.state, el = COMPOSE.el;
  if (!s || s.sending) return;
  // Commit anything still typed into a recipient box.
  el.querySelectorAll('.mc-rcpt-input').forEach(i => i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' })));
  const invalid = ['to', 'cc', 'bcc'].flatMap(readRecipients).filter(a => a.invalid);
  if (invalid.length) return composerError(`Fix or remove ${invalid.map(a => a.email).join(', ')} before sending.`);
  const payload = composerPayload();
  if (!payload.to.length && !payload.cc.length && !payload.bcc.length) return composerError('Add at least one recipient.');
  if (s.uploading) return composerError('Wait for attachments to finish uploading.');
  if (s.attachments.some(a => a.error)) return composerError('Remove the attachments that failed to upload.');
  if (!payload.subject.trim() && !el.dataset.noSubjectOk) {
    el.dataset.noSubjectOk = '1';
    return composerError('This message has no subject. Press Send again to send it anyway.');
  }
  if (sendAt && !(sendAt > new Date())) return composerError('Pick a time in the future.');

  s.sending = true;
  clearTimeout(s.saveTimer);
  await s.saving;
  el.querySelectorAll('button, input, select').forEach(b => { b.disabled = true; });
  el.querySelector('#mc-send').innerHTML = '<span class="spinner"></span>Sending';
  try {
    const res = await mailApi('/send', { method: 'POST', body: {
      ...payload, draftId: s.draftId,
      sendAt: sendAt ? sendAt.toISOString() : undefined,
      followUpDays: Number(el.querySelector('#mc-followup').value) || undefined,
    } });
    el.remove();
    COMPOSE.el = COMPOSE.state = null;
    afterSend(res, sendAt, s);
  } catch (err) {
    s.sending = false;
    el.querySelectorAll('button, input, select').forEach(b => { b.disabled = false; });
    el.querySelector('#mc-send').innerHTML = '<i class="ph-bold ph-paper-plane-tilt"></i>Send';
    composerError(err.message);
  }
}

function afterSend(res, sendAt, s) {
  const undo = async () => {
    try {
      const { draftId } = await mailApi(`/submissions/${encodeURIComponent(res.submissionId)}/cancel`, { method: 'POST' });
      await openComposer({ mode: 'draft', emailId: draftId, threadId: s.threadId });
      mailToast(sendAt ? 'Unscheduled. Your message is back in the composer.' : 'Sending undone');
    } catch (err) { mailToast(err.message, { error: true }); }
    refreshMailCounts();
  };
  if (sendAt) {
    mailToast('Scheduled for ' + fmtMailDateLong(sendAt.toISOString()), { actionLabel: 'Undo', onAction: undo, duration: 8000 });
  } else if (res.undoSeconds > 0) {
    let left = res.undoSeconds;
    const t = mailToast(`Sending in ${left}s`, { actionLabel: 'Undo', onAction: undo, duration: res.undoSeconds * 1000 + 300 });
    const tick = setInterval(() => {
      left--;
      if (left <= 0) { clearInterval(tick); mailToast('Message sent'); return; }
      t.set(`Sending in ${left}s`);
    }, 1000);
    document.getElementById('mail-toast').querySelector('.mail-toast-action')?.addEventListener('click', () => clearInterval(tick));
  } else {
    mailToast('Message sent');
  }
  refreshMailCounts();
  if (mailThreadShown() && s.threadId === MAIL.thread.threadId) showMailThread(MAIL.thread.threadId, { keepScroll: true });
  if (_currentView === 'mail') loadMailThreads();
}

// Unsaved composer content survives a closing tab only as a saved draft.
window.addEventListener('beforeunload', e => {
  if (COMPOSE.state?.dirty && composerHasContent()) { saveComposerDraft(); e.preventDefault(); }
});
