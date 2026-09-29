'use strict';

// ─── mail settings ────────────────────────────────────────────────────────────
// Tabbed: General (addresses, signatures, sending, mail apps), Filters,
// Labels, Templates, Setup (DNS and sending allowance). The tab lives in the
// URL (#mail-settings/<tab>). Data loads once per visit; tabs render from it.

const MAIL_FILTER_FIELDS = [['from', 'From'], ['to', 'To or Cc'], ['subject', 'Subject'], ['words', 'Has the words']];
const MS_TABS = [
  { id: 'general', label: 'General', icon: 'ph-user-circle' },
  { id: 'filters', label: 'Filters', icon: 'ph-funnel' },
  { id: 'labels', label: 'Labels', icon: 'ph-tag' },
  { id: 'templates', label: 'Templates', icon: 'ph-note' },
  { id: 'setup', label: 'Setup & delivery', icon: 'ph-shield-check' },
];
const MS = { tab: 'general', filters: [], templates: [], health: null };

async function renderMailSettings(tab) {
  const el = document.getElementById('mail-settings');
  MS.tab = MS_TABS.some(t => t.id === tab) ? tab : 'general';
  el.innerHTML = `<div class="skel" style="height:40px"></div><div class="skel" style="height:260px;margin-top:20px"></div>`;
  try {
    await loadMailBoot(true);
    if (!MAIL.boot.configured) { el.innerHTML = `<div class="mail-empty"><i class="ph-bold ph-envelope-simple"></i><div class="mail-empty-title">Mail isn't set up on this server yet</div><p>See docs/mail.md in the repository.</p></div>`; return; }
    [MS.filters, MS.templates] = await Promise.all([mailApi('/filters'), mailApi('/templates')]);
    el.innerHTML = `<nav class="mst-tabs" role="tablist" aria-label="Mail settings" id="mst-tabs"></nav><div class="mst-panel" id="mst-panel" role="tabpanel"></div>`;
    renderMsTabs();
    renderMsPanel();
    msLoadHealth(); // fills the Setup tab's badge in the background
  } catch (err) {
    el.innerHTML = mailErrorHTML(err.message);
  }
}

function renderMsTabs() {
  const counts = { filters: MS.filters.length, labels: MAIL.boot.labels.length, templates: MS.templates.length };
  const failing = MS.health ? MS.health.checks.filter(c => !c.ok && c.id !== 'ptr').length : 0;
  const nav = document.getElementById('mst-tabs');
  nav.innerHTML = MS_TABS.map(t => `<button class="mst-tab${MS.tab === t.id ? ' active' : ''}" role="tab" aria-selected="${MS.tab === t.id}" data-tab="${t.id}">
      <i class="ph-bold ${t.icon}"></i><span>${t.label}</span>
      ${counts[t.id] ? `<span class="mst-count">${counts[t.id]}</span>` : ''}
      ${t.id === 'setup' && MS.health ? (failing ? `<span class="mst-count warn" title="${failing} to fix">${failing}</span>` : '<i class="ph-bold ph-check-circle mst-ok" aria-label="All checks pass"></i>') : ''}
    </button>`).join('');
  nav.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    MS.tab = b.dataset.tab;
    history.replaceState(null, '', '#mail-settings/' + MS.tab);
    renderMsTabs();
    renderMsPanel();
  }));
  nav.onkeydown = e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = MS_TABS.findIndex(t => t.id === MS.tab);
    const next = MS_TABS[(i + (e.key === 'ArrowRight' ? 1 : -1) + MS_TABS.length) % MS_TABS.length];
    nav.querySelector(`[data-tab="${next.id}"]`).click();
    nav.querySelector(`[data-tab="${next.id}"]`).focus();
  };
}

function renderMsPanel() {
  const p = document.getElementById('mst-panel');
  p.innerHTML = '';
  ({ general: msGeneral, filters: msFilters, labels: msLabels, templates: msTemplates, setup: msSetup })[MS.tab](p);
}

// ─── shared pieces ────────────────────────────────────────────────────────────
function msCard(title, desc, action, body, cls = '') {
  return `<section class="ms-card ${cls}"><header class="ms-card-hd"><div><h2 class="ms-card-title">${esc(title)}</h2>${desc ? `<p class="ms-card-desc">${desc}</p>` : ''}</div>${action || ''}</header>${body}</section>`;
}

function msSwitch(id, checked, label) {
  return `<label class="mst-switch"><input type="checkbox" role="switch" id="${id}" ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span class="mst-switch-track" aria-hidden="true"></span></label>`;
}

function msMoreBtn(key) {
  return `<button class="row-btn" data-more="${esc(key)}" aria-label="More actions"><i class="ph-bold ph-dots-three"></i></button>`;
}

function msEmpty(icon, title, text) {
  return `<div class="mst-empty"><i class="ph-bold ${icon}"></i><div class="mail-empty-title">${esc(title)}</div><p>${esc(text)}</p></div>`;
}

async function msRun(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (err) { mailToast(err.message, { error: true }); btn.disabled = false; }
}

async function msCopy(btn, text) {
  try {
    await navigator.clipboard.writeText(text);
    const old = btn.innerHTML;
    btn.innerHTML = '<i class="ph-bold ph-check"></i>';
    setTimeout(() => { btn.innerHTML = old; }, 1200);
  } catch { mailToast('Copy failed: select the text instead', { error: true }); }
}

// A small rich-text box (bold, italic, link) for signatures and templates.
function msEditorHTML(id, html, label) {
  return `<div class="ms-editor-wrap">
    <div class="mc-toolbar ms-toolbar" data-for="${id}">
      <button type="button" class="mc-tool" data-mcmd="bold" aria-label="Bold"><i class="ph-bold ph-text-b"></i></button>
      <button type="button" class="mc-tool" data-mcmd="italic" aria-label="Italic"><i class="ph-bold ph-text-italic"></i></button>
      <button type="button" class="mc-tool" data-mcmd="link" aria-label="Insert link"><i class="ph-bold ph-link"></i></button>
      <button type="button" class="mc-tool" data-mcmd="removeFormat" aria-label="Clear formatting"><i class="ph-bold ph-text-t-slash"></i></button>
    </div>
    <div class="mc-editor ms-editor" id="${id}" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${esc(label)}">${html || ''}</div>
  </div>`;
}

function wireMsEditors(root) {
  root.querySelectorAll('[data-mcmd]').forEach(b => {
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      const editor = document.getElementById(b.closest('[data-for]').dataset.for);
      editor.focus();
      if (b.dataset.mcmd === 'link') return msLinkPrompt(b, editor);
      document.execCommand(b.dataset.mcmd, false, null);
    });
  });
  root.querySelectorAll('.ms-editor').forEach(ed => ed.addEventListener('paste', e => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html');
    if (html) document.execCommand('insertHTML', false, mailCleanHtml(html));
    else document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
  }));
}

function msLinkPrompt(anchor, editor) {
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
  pop.querySelector('input').focus();
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') closeMailMenu(); });
  pop.addEventListener('submit', e => {
    e.preventDefault();
    let url = pop.querySelector('input').value.trim();
    if (!/^(https?:|mailto:)/i.test(url)) url = 'https://' + url;
    closeMailMenu();
    editor.focus();
    if (range) { sel.removeAllRanges(); sel.addRange(range); }
    if (range && !range.collapsed) document.execCommand('createLink', false, url);
    else document.execCommand('insertHTML', false, `<a href="${esc(url)}">${esc(url)}</a>`);
  });
}

// ─── General: addresses, signatures, sending, mail apps ───────────────────────
function msGeneral(p) {
  const a = MAIL.boot.addresses;
  const s = MAIL.boot.settings;
  const host = 'mail.' + (a?.domain || 'gacoka.com');
  const addresses = !a ? '<p class="ms-empty">Address details are unavailable right now.</p>' : `
    <div class="ms-rows" id="ms-address-rows">
      ${a.addresses.map(x => {
        const named = x.identity?.name && x.identity.name !== x.email;
        return `<div class="ms-row" data-row="${esc(x.email)}">
          <span class="mail-avatar${x.primary ? ' mine' : ''}" aria-hidden="true">${esc(mailInitials({ name: named ? x.identity.name : null, email: x.email }))}</span>
          <div class="ms-row-main">
            <div class="ms-row-title">${esc(named ? x.identity.name : x.email)}${x.primary ? ' <span class="cur-badge cur-badge-success">Primary</span>' : ''}</div>
            <div class="ms-row-meta">${esc(x.email)}${named ? '' : ' · <span class="ms-hint">no display name</span>'} · ${x.identity?.htmlSignature ? 'signature set' : 'no signature'}</div>
          </div>
          <div class="ms-row-actions"><button class="btn-ghost btn-sm" data-edit="${esc(x.email)}">Edit</button>${x.primary || !a.manageable ? '' : msMoreBtn(x.email)}</div>
        </div>`;
      }).join('')}
    </div>
    ${a.manageable ? `<form class="ms-add" id="ms-add-alias">
      <span class="ms-alias-input"><input class="form-input" name="alias" placeholder="New address, e.g. travel" maxlength="64" autocomplete="off" aria-label="New address"><span class="ms-domain">@${esc(a.domain)}</span></span>
      <button class="btn-ghost btn-sm" type="submit"><i class="ph-bold ph-plus"></i>Add address</button>
    </form>` : ''}`;

  p.innerHTML = `<div class="mst-cols">
    <div class="ms-col">
      ${msCard('Addresses and signatures', 'Where you receive mail and how you sign it. Replies go out from the address a message was sent to.', null, addresses)}
    </div>
    <div class="ms-col">
      ${msCard('Sending and inbox', null, null, `
        <div class="ms-rows">
          <div class="ms-row">
            <div class="ms-row-main"><div class="ms-row-title">Undo send</div><div class="ms-row-meta">How long a sent message waits, so you can take it back</div></div>
            <select class="form-select ms-inline-select" id="ms-undo" aria-label="Undo send window">${MAIL.boot.undoChoices.map(n => `<option value="${n}"${n === s.undoSeconds ? ' selected' : ''}>${n ? `${n} seconds` : 'Off'}</option>`).join('')}</select>
          </div>
          <div class="ms-row">
            <div class="ms-row-main"><div class="ms-row-title">Split inbox</div><div class="ms-row-meta">Newsletters and notifications go under Other; people you've written to stay in Important</div></div>
            ${msSwitch('ms-split', s.splitInbox, 'Split inbox')}
          </div>
          ${a?.manageable ? `<div class="ms-row">
            <div class="ms-row-main"><div class="ms-row-title">Catch-all</div><div class="ms-row-meta">Receive mail for any address at ${esc(a.domain)}, like shop-name@${esc(a.domain)}</div></div>
            ${msSwitch('ms-catchall', a.catchAll, 'Catch-all')}
          </div>` : ''}
        </div>`)}
      ${msCard('Mail apps', 'Use this mailbox in iPhone Mail, Outlook or Thunderbird.', null, `
        <dl class="ms-dl">
          <dt>Incoming (IMAP)</dt><dd>${esc(host)} · 993 · SSL/TLS</dd>
          <dt>Outgoing (SMTP)</dt><dd>${esc(host)} · 465 · SSL/TLS</dd>
          <dt>Username</dt><dd>${esc(MAIL.boot.address)}</dd>
          <dt>Password</dt><dd>The mailbox password on the server (MAIL_PASSWORD), not your dashboard password</dd>
        </dl>`)}
    </div>
  </div>`;

  p.querySelectorAll('#ms-address-rows [data-edit]').forEach(b => b.addEventListener('click', () => msAddressEditor(b.dataset.edit)));
  p.querySelectorAll('#ms-address-rows [data-more]').forEach(b => b.addEventListener('click', () => mailMenu(b, [
    { label: 'Remove address', icon: 'ph-trash', run: () => mailConfirmButton(b, `Stop receiving mail at ${b.dataset.more}?`, async () => {
      await mailApi('/addresses/' + encodeURIComponent(b.dataset.more), { method: 'DELETE' });
      await loadMailBoot(true); renderMsPanel();
      mailToast(`${b.dataset.more} removed`);
    }) },
  ])));
  document.getElementById('ms-add-alias')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.alias;
    if (!input.value.trim()) return input.focus();
    msRun(e.target.querySelector('button'), async () => {
      await mailApi('/addresses', { method: 'POST', body: { name: input.value.trim() } });
      await loadMailBoot(true); renderMsPanel();
      mailToast('Address added');
    });
  });
  document.getElementById('ms-undo').addEventListener('change', async e => {
    try { await mailApi('/settings', { method: 'PUT', body: { undoSeconds: Number(e.target.value) } }); await loadMailBoot(true); mailToast('Undo window saved'); }
    catch (err) { mailToast(err.message, { error: true }); }
  });
  const toggle = (id, fn, on, off) => document.getElementById(id)?.addEventListener('change', async e => {
    e.target.disabled = true;
    try { await fn(e.target.checked); await loadMailBoot(true); mailToast(e.target.checked ? on : off); }
    catch (err) { e.target.checked = !e.target.checked; mailToast(err.message, { error: true }); }
    e.target.disabled = false;
  });
  toggle('ms-split', v => mailApi('/settings', { method: 'PUT', body: { splitInbox: v } }), 'Split inbox is on', 'Split inbox is off');
  toggle('ms-catchall', v => mailApi('/catch-all', { method: 'PUT', body: { enabled: v } }), 'Catch-all is on', 'Catch-all is off');
}

function msAddressEditor(email) {
  const row = document.querySelector(`#ms-address-rows [data-row="${CSS.escape(email)}"]`);
  if (row.nextElementSibling?.classList.contains('ms-edit')) return row.nextElementSibling.querySelector('input').focus();
  const ident = MAIL.boot.identities.find(i => i.email === email);
  const form = document.createElement('form');
  form.className = 'ms-edit';
  form.innerHTML = `
    <label class="form-field"><span class="form-label">Display name</span>
      <input class="form-input" name="name" value="${esc(ident?.name && ident.name !== email ? ident.name : '')}" placeholder="Mark Gacoka" maxlength="100">
      <span class="form-hint">Shown as the sender, e.g. "Mark Gacoka &lt;${esc(email)}&gt;"</span></label>
    <div class="form-field"><span class="form-label">Signature</span>${msEditorHTML('ms-sig-editor', ident?.htmlSignature, 'Signature for ' + email)}</div>
    <div class="ms-actions"><button class="btn-primary btn-sm" type="submit">Save</button><button class="btn-ghost btn-sm" type="button" data-cancel>Cancel</button></div>`;
  row.after(form);
  wireMsEditors(form);
  form.name.focus();
  form.querySelector('[data-cancel]').addEventListener('click', () => form.remove());
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!ident) { mailToast('This address has no sending identity yet. Send one message from it first.', { error: true }); return; }
    msRun(form.querySelector('[type=submit]'), async () => {
      await mailApi('/identities/' + encodeURIComponent(ident.id), { method: 'PATCH', body: { name: form.name.value, htmlSignature: document.getElementById('ms-sig-editor').innerHTML } });
      await loadMailBoot(true); renderMsPanel();
      mailToast('Saved');
    });
  });
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function msFilterChips(f) {
  const field = Object.fromEntries(MAIL_FILTER_FIELDS);
  const conds = f.conditions.map(c => `<span class="mst-chip">${esc(field[c.field])} ${c.op === 'is' ? 'is' : 'contains'} <b>${esc(c.value)}</b></span>`)
    .join(`<span class="mst-join">${f.match === 'any' ? 'or' : 'and'}</span>`);
  const a = f.actions, acts = [];
  const label = mailLabel(a.labelId);
  if (label) acts.push(`<span class="mst-chip"><span class="mail-dot" style="--chip:${MAIL_LABEL_COLORS[label.color]}"></span>Label <b>${esc(label.name)}</b></span>`);
  if (a.archive) acts.push('<span class="mst-chip"><i class="ph-bold ph-archive"></i>Skip the inbox</span>');
  if (a.folderId) acts.push(`<span class="mst-chip"><i class="ph-bold ph-folder-simple"></i>Move to <b>${esc(MAIL.boot.folders.find(x => x.id === a.folderId)?.name || 'folder')}</b></span>`);
  if (a.markRead) acts.push('<span class="mst-chip"><i class="ph-bold ph-envelope-open"></i>Mark read</span>');
  if (a.star) acts.push('<span class="mst-chip"><i class="ph-bold ph-star"></i>Star</span>');
  if (a.importance) acts.push(`<span class="mst-chip">${a.importance === 'important' ? 'Important' : 'Other'}</span>`);
  return `<div class="mst-rule"><span class="mst-kw">If</span>${conds}</div><div class="mst-rule"><span class="mst-kw">Then</span>${acts.join('') || '<span class="ms-hint">no action</span>'}</div>`;
}

function msFilterBody(f, overrides = {}) {
  return {
    name: f.name, match: f.match, enabled: f.enabled, conditions: f.conditions,
    actions: { labelId: f.actions.labelId, archive: !!f.actions.archive, folderId: f.actions.folderId || null, importance: f.actions.importance || null, markRead: !!f.actions.markRead, star: !!f.actions.star },
    ...overrides,
  };
}

async function msReloadFilters() {
  MS.filters = await mailApi('/filters');
  renderMsTabs();
  if (MS.tab === 'filters') renderMsPanel();
}

function msFilters(p) {
  const filters = MS.filters;
  const add = '<button class="btn-primary btn-sm" id="ms-new-filter"><i class="ph-bold ph-plus"></i>New filter</button>';
  p.innerHTML = msCard('Filters', 'Sort mail as it arrives, top to bottom. They run on the mail server, so they also apply to mail read on your phone. Spam is never filtered out of Junk.', add,
    filters.length ? `<div class="ms-rows" id="ms-filter-rows">${filters.map(f => `
      <div class="ms-row mst-filter${f.enabled ? '' : ' off'}" data-row="${esc(String(f.id))}">
        <div class="ms-row-main">
          <div class="ms-row-title">${esc(f.name)}${f.enabled ? '' : ' <span class="cur-badge cur-badge-neutral">Paused</span>'}</div>
          ${msFilterChips(f)}
        </div>
        <div class="ms-row-actions">${msSwitch('ms-fon-' + f.id, f.enabled, 'Filter on')}<button class="btn-ghost btn-sm" data-edit="${esc(String(f.id))}">Edit</button>${msMoreBtn(String(f.id))}</div>
      </div>`).join('')}</div>`
      : `<div id="ms-filter-rows">${msEmpty('ph-funnel', 'No filters yet', 'Filters label, move, star or mark mail as read the moment it arrives. For example: receipts skip the inbox and get a Receipts label.')}</div>`);
  document.getElementById('ms-new-filter').addEventListener('click', () => msFilterEditor(null));
  p.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => msFilterEditor(filters.find(f => String(f.id) === b.dataset.edit))));
  filters.forEach((f, i) => {
    document.getElementById('ms-fon-' + f.id).addEventListener('change', async e => {
      e.target.disabled = true;
      try { await mailApi('/filters/' + f.id, { method: 'PUT', body: msFilterBody(f, { enabled: e.target.checked }) }); await msReloadFilters(); }
      catch (err) { e.target.checked = !e.target.checked; e.target.disabled = false; mailToast(err.message, { error: true }); }
    });
    const b = p.querySelector(`[data-more="${CSS.escape(String(f.id))}"]`);
    b.addEventListener('click', () => mailMenu(b, [
      { label: 'Apply to existing mail', icon: 'ph-play', run: async () => {
        try {
          const { matched } = await mailApi(`/filters/${f.id}/run`, { method: 'POST' });
          mailToast(matched ? `Applied to ${matched} message${matched === 1 ? '' : 's'}` : 'No existing mail matches this filter');
          refreshMailCounts();
        } catch (err) { mailToast(err.message, { error: true }); }
      } },
      { label: 'Move up', icon: 'ph-arrow-up', disabled: i === 0, run: async () => { await mailApi(`/filters/${f.id}/move`, { method: 'POST', body: { direction: 'up' } }); msReloadFilters(); } },
      { label: 'Move down', icon: 'ph-arrow-down', disabled: i === filters.length - 1, run: async () => { await mailApi(`/filters/${f.id}/move`, { method: 'POST', body: { direction: 'down' } }); msReloadFilters(); } },
      { sep: true },
      { label: 'Delete filter', icon: 'ph-trash', run: () => mailConfirmButton(b, 'Delete this filter?', async () => { await mailApi('/filters/' + f.id, { method: 'DELETE' }); msReloadFilters(); }) },
    ]));
  });
}

function msFilterEditor(f) {
  const panel = document.getElementById('mst-panel');
  panel.querySelector('.ms-edit')?.remove();
  const a = f?.actions || {};
  const folders = MAIL.boot.folders.filter(x => !x.role);
  const dest = a.archive ? 'archive' : a.folderId || '';
  const condRow = c => `<div class="ms-cond">
      <select class="form-select" name="field" aria-label="Field">${MAIL_FILTER_FIELDS.map(([v, l]) => `<option value="${v}"${c.field === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="form-select" name="op" aria-label="Match">${[['contains', 'contains'], ['is', 'is exactly']].map(([v, l]) => `<option value="${v}"${(c.op || 'contains') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input class="form-input" name="value" value="${esc(c.value || '')}" placeholder="airline.com" aria-label="Value">
      <button type="button" class="row-btn danger" data-rm-cond aria-label="Remove condition"><i class="ph-bold ph-x"></i></button>
    </div>`;
  const form = document.createElement('form');
  form.className = 'ms-edit mst-editor';
  form.innerHTML = `
    <div class="mst-editor-hd"><span class="ms-card-title">${f ? 'Edit filter' : 'New filter'}</span>
      <label class="form-field mst-name"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(f?.name || '')}" placeholder="Airline mail" maxlength="80"></label></div>
    <div class="mst-editor-cols">
      <div class="form-field"><span class="form-label">If a message matches
        <select class="form-select ms-match" name="match" aria-label="Match all or any"><option value="all"${f?.match !== 'any' ? ' selected' : ''}>all</option><option value="any"${f?.match === 'any' ? ' selected' : ''}>any</option></select> of these</span>
        <div class="ms-conds">${(f?.conditions?.length ? f.conditions : [{ field: 'from' }]).map(condRow).join('')}</div>
        <button type="button" class="btn-link" data-add-cond><i class="ph-bold ph-plus"></i>Add condition</button>
      </div>
      <div class="form-field"><span class="form-label">Then</span>
        <div class="mst-then">
          <label class="form-field"><span class="ms-sub">Label</span><select class="form-select" name="labelId"><option value="">None</option>${MAIL.boot.labels.map(l => `<option value="${l.id}"${String(a.labelId) === String(l.id) ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
          <label class="form-field"><span class="ms-sub">Move to</span><select class="form-select" name="dest"><option value="">Leave in Inbox</option><option value="archive"${dest === 'archive' ? ' selected' : ''}>Archive (skip the inbox)</option>${folders.map(x => `<option value="${esc(x.id)}"${dest === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label class="form-field"><span class="ms-sub">Inbox section</span><select class="form-select" name="importance"><option value="">Decide automatically</option><option value="important"${a.importance === 'important' ? ' selected' : ''}>Important</option><option value="other"${a.importance === 'other' ? ' selected' : ''}>Other</option></select></label>
          <div class="ms-checks-row">
            <label class="ms-check"><input type="checkbox" name="markRead"${a.markRead ? ' checked' : ''}> Mark as read</label>
            <label class="ms-check"><input type="checkbox" name="star"${a.star ? ' checked' : ''}> Star it</label>
          </div>
        </div>
      </div>
    </div>
    <div class="form-error" role="alert"></div>
    <div class="ms-actions"><button class="btn-primary btn-sm" type="submit">${f ? 'Save filter' : 'Create filter'}</button><button type="button" class="btn-ghost btn-sm" data-cancel>Cancel</button></div>`;
  const row = f && panel.querySelector(`[data-row="${CSS.escape(String(f.id))}"]`);
  if (row) row.after(form); else document.getElementById('ms-filter-rows').prepend(form);
  const conds = form.querySelector('.ms-conds');
  const wireRm = () => conds.querySelectorAll('[data-rm-cond]').forEach(b => { b.onclick = () => { if (conds.children.length > 1) b.closest('.ms-cond').remove(); }; });
  wireRm();
  form.querySelector('[data-add-cond]').addEventListener('click', () => { conds.insertAdjacentHTML('beforeend', condRow({ field: 'subject' })); wireRm(); conds.lastElementChild.querySelector('input').focus(); });
  form.querySelector('[data-cancel]').addEventListener('click', () => { form.remove(); if (!MS.filters.length) renderMsPanel(); });
  form.name.focus();
  form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.style.display = 'none';
    const body = {
      name: form.name.value, match: form.match.value, enabled: f ? f.enabled : true,
      conditions: [...conds.children].map(r => ({ field: r.querySelector('[name=field]').value, op: r.querySelector('[name=op]').value, value: r.querySelector('[name=value]').value })),
      actions: {
        labelId: form.labelId.value || null,
        archive: form.dest.value === 'archive',
        folderId: form.dest.value && form.dest.value !== 'archive' ? form.dest.value : null,
        importance: form.importance.value || null,
        markRead: form.markRead.checked, star: form.star.checked,
      },
    };
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await mailApi(f ? '/filters/' + f.id : '/filters', { method: f ? 'PUT' : 'POST', body });
      await msReloadFilters();
      mailToast(f ? 'Filter saved' : 'Filter created. It applies to new mail; use "Apply to existing mail" in its menu for the rest.');
    } catch (ex) {
      err.textContent = ex.message; err.style.display = 'block'; btn.disabled = false;
    }
  });
}

// ─── Labels ───────────────────────────────────────────────────────────────────
function msColorSelect(value, attrs) {
  return `<select class="form-select ms-color" ${attrs}>${MAIL.boot.labelColors.map(c => `<option value="${c}"${c === value ? ' selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select>`;
}

function msLabels(p) {
  const labels = MAIL.boot.labels;
  const usedBy = id => MS.filters.filter(f => String(f.actions.labelId) === String(id)).length;
  p.innerHTML = msCard('Labels', 'Tag conversations without moving them. A conversation can have several labels; filters can add them automatically.',
    '<button class="btn-primary btn-sm" id="ms-new-label"><i class="ph-bold ph-plus"></i>New label</button>',
    labels.length ? `<div class="ms-rows" id="ms-label-rows">${labels.map(l => `
      <div class="ms-row" data-row="${esc(String(l.id))}">
        ${mailLabelChip(l)}
        <div class="ms-row-main"><div class="ms-row-meta">${usedBy(l.id) ? `Added by ${usedBy(l.id)} filter${usedBy(l.id) === 1 ? '' : 's'}` : 'Added by hand'}</div></div>
        <div class="ms-row-actions"><button class="btn-ghost btn-sm" data-open="${esc(String(l.id))}">View mail</button><button class="btn-ghost btn-sm" data-edit="${esc(String(l.id))}">Edit</button>${msMoreBtn(String(l.id))}</div>
      </div>`).join('')}</div>`
      : `<div id="ms-label-rows">${msEmpty('ph-tag', 'No labels yet', 'Create labels like Travel or Receipts, then add them from a conversation or with a filter.')}</div>`);
  document.getElementById('ms-new-label').addEventListener('click', () => msLabelEditor(null));
  p.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => navigate('mail', 'label:' + b.dataset.open)));
  p.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => msLabelEditor(labels.find(l => String(l.id) === b.dataset.edit))));
  p.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => mailMenu(b, [
    { label: 'Delete label', icon: 'ph-trash', run: () => mailConfirmButton(b, 'Delete? Conversations keep their folders.', async () => {
      await mailApi('/labels/' + b.dataset.more, { method: 'DELETE' });
      await loadMailBoot(true);
      MS.filters = await mailApi('/filters');
      renderMsTabs(); renderMsPanel();
    }) },
  ])));
}

function msLabelEditor(l) {
  const panel = document.getElementById('mst-panel');
  panel.querySelector('.ms-edit')?.remove();
  const form = document.createElement('form');
  form.className = 'ms-edit ms-edit-inline';
  form.innerHTML = `<span class="mail-dot" style="--chip:${MAIL_LABEL_COLORS[l?.color || 'patina']}"></span>
    <input class="form-input" name="name" value="${esc(l?.name || '')}" placeholder="Label name" maxlength="40" aria-label="Label name">
    ${msColorSelect(l?.color || 'patina', 'name="color" aria-label="Colour"')}
    <button class="btn-primary btn-sm" type="submit">${l ? 'Save' : 'Add label'}</button><button class="btn-ghost btn-sm" type="button" data-cancel>Cancel</button>`;
  const row = l && panel.querySelector(`[data-row="${CSS.escape(String(l.id))}"]`);
  if (row) row.after(form); else document.getElementById('ms-label-rows').prepend(form);
  form.name.focus();
  form.color.addEventListener('change', () => form.querySelector('.mail-dot').style.setProperty('--chip', MAIL_LABEL_COLORS[form.color.value]));
  form.querySelector('[data-cancel]').addEventListener('click', () => { form.remove(); if (!MAIL.boot.labels.length) renderMsPanel(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.name.value.trim()) return form.name.focus();
    msRun(form.querySelector('[type=submit]'), async () => {
      await mailApi(l ? '/labels/' + l.id : '/labels', { method: l ? 'PATCH' : 'POST', body: { name: form.name.value.trim(), color: form.color.value } });
      await loadMailBoot(true); renderMsTabs(); renderMsPanel();
    });
  });
}

// ─── Templates ────────────────────────────────────────────────────────────────
function msTemplates(p) {
  const templates = MS.templates;
  const preview = html => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent.replace(/\s+/g, ' ').trim().slice(0, 160); };
  p.innerHTML = msCard('Templates', 'Replies you send often. Insert one from the note button in the composer toolbar.',
    '<button class="btn-primary btn-sm" id="ms-new-template"><i class="ph-bold ph-plus"></i>New template</button>',
    templates.length ? `<div class="ms-rows" id="ms-template-rows">${templates.map(t => `
      <div class="ms-row" data-row="${esc(String(t.id))}">
        <div class="ms-row-main"><div class="ms-row-title">${esc(t.name)}${t.subject ? ` <span class="ms-hint">· ${esc(t.subject)}</span>` : ''}</div>
          <div class="ms-row-meta mst-preview">${esc(preview(t.html)) || '<span class="ms-hint">Empty</span>'}</div></div>
        <div class="ms-row-actions"><button class="btn-ghost btn-sm" data-edit="${esc(String(t.id))}">Edit</button>${msMoreBtn(String(t.id))}</div>
      </div>`).join('')}</div>`
      : `<div id="ms-template-rows">${msEmpty('ph-note', 'No templates yet', 'Save answers you write again and again, like directions or a scheduling reply.')}</div>`);
  document.getElementById('ms-new-template').addEventListener('click', () => msTemplateEditor(null));
  p.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => msTemplateEditor(templates.find(t => String(t.id) === b.dataset.edit))));
  p.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => mailMenu(b, [
    { label: 'Delete template', icon: 'ph-trash', run: () => mailConfirmButton(b, 'Delete this template?', async () => {
      await mailApi('/templates/' + b.dataset.more, { method: 'DELETE' });
      MS.templates = await mailApi('/templates'); renderMsTabs(); renderMsPanel();
    }) },
  ])));
}

function msTemplateEditor(t) {
  const panel = document.getElementById('mst-panel');
  panel.querySelector('.ms-edit')?.remove();
  const form = document.createElement('form');
  form.className = 'ms-edit';
  form.innerHTML = `
    <div class="mst-editor-cols mst-editor-cols-even">
      <label class="form-field"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(t?.name || '')}" maxlength="80" placeholder="Thanks, will follow up"></label>
      <label class="form-field"><span class="form-label">Subject (used when the message has none)</span><input class="form-input" name="subject" value="${esc(t?.subject || '')}" maxlength="500"></label>
    </div>
    <div class="form-field"><span class="form-label">Body</span>${msEditorHTML('ms-template-body', t?.html, 'Template body')}</div>
    <div class="form-error" role="alert"></div>
    <div class="ms-actions"><button class="btn-primary btn-sm" type="submit">Save template</button><button type="button" class="btn-ghost btn-sm" data-cancel>Cancel</button></div>`;
  const row = t && panel.querySelector(`[data-row="${CSS.escape(String(t.id))}"]`);
  if (row) row.after(form); else document.getElementById('ms-template-rows').prepend(form);
  wireMsEditors(form);
  form.name.focus();
  form.querySelector('[data-cancel]').addEventListener('click', () => { form.remove(); if (!MS.templates.length) renderMsPanel(); });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.style.display = 'none';
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await mailApi(t ? '/templates/' + t.id : '/templates', { method: t ? 'PUT' : 'POST', body: { name: form.name.value, subject: form.subject.value, html: document.getElementById('ms-template-body').innerHTML } });
      MS.templates = await mailApi('/templates'); renderMsTabs(); renderMsPanel();
      mailToast('Template saved');
    } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; btn.disabled = false; }
  });
}

// ─── Setup & delivery ─────────────────────────────────────────────────────────
async function msLoadHealth() {
  try { MS.health = await mailApi('/health'); } catch (err) { MS.health = { error: err.message, checks: [] }; }
  if (!document.getElementById('mst-tabs')) return;
  renderMsTabs();
  if (MS.tab === 'setup') renderMsPanel();
}

function msSetup(p) {
  const h = MS.health;
  const recheck = '<button class="btn-ghost btn-sm" id="ms-recheck"><i class="ph-bold ph-arrow-clockwise"></i>Check again</button>';
  if (!h) { p.innerHTML = msCard('Setup and delivery', null, recheck, '<div class="skel" style="height:220px"></div>'); p.querySelector('#ms-recheck').addEventListener('click', msRecheck); return; }
  const required = h.checks.filter(c => c.id !== 'ptr');
  const passing = required.filter(c => c.ok).length;
  const pct = (n, of) => of ? Math.min(100, Math.round((n || 0) / of * 100)) : 0;
  const tile = (n, of, label, sub) => `<div class="kpi-tile">
      <div class="kpi-big">${n ?? '—'}<span class="mst-of"> / ${of}</span></div>
      <div class="kpi-lbl">${label}</div>
      ${sub ? `<div class="kpi-sub">${sub}</div>` : `<div class="mst-meter"><span style="width:${pct(n, of)}%"></span></div>`}
    </div>`;
  p.innerHTML = `
    <div class="kpi-tiles mst-kpis">
      ${tile(h.sentToday, h.dailyLimit, 'Sent today', null)}
      ${tile(h.sentThisMonth, h.monthlyLimit, 'Sent this month', null)}
      ${tile(passing, required.length, 'Checks passing', passing === required.length ? 'Mail is set up correctly' : `${required.length - passing} record${required.length - passing === 1 ? '' : 's'} to fix`)}
    </div>
    ${h.error ? `<p class="ms-empty">${esc(h.error)}</p>` : msCard('DNS and server checks', 'What the domain publishes, compared with what the mail server expects. Edit DNS in Hostinger → Domains → gacoka.com → DNS / Nameservers; changes can take an hour to show here.', recheck,
      `<div class="ms-rows">${h.checks.map((c, i) => `
        <div class="ms-row ms-check-row">
          <span class="mst-status ${c.ok ? 'ok' : c.id === 'ptr' ? 'opt' : 'bad'}" aria-hidden="true"><i class="ph-bold ${c.ok ? 'ph-check' : c.id === 'ptr' ? 'ph-minus' : 'ph-warning'}"></i></span>
          <div class="ms-row-main"><div class="ms-row-title">${esc(c.label)}${c.id === 'ptr' ? ' <span class="cur-badge cur-badge-neutral">Optional</span>' : ''}</div>
            <div class="ms-row-meta">${esc(c.detail)}</div>
            ${c.fix ? `<div class="mst-fix"><code>${esc(c.fix)}</code><button class="row-btn" data-copy="${i}" aria-label="Copy"><i class="ph-bold ph-copy"></i></button></div>` : ''}</div>
        </div>`).join('')}</div>`)}`;
  p.querySelector('#ms-recheck')?.addEventListener('click', msRecheck);
  p.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => msCopy(b, h.checks[+b.dataset.copy].fix)));
}

async function msRecheck() {
  MS.health = null;
  renderMsPanel();
  await msLoadHealth();
}
