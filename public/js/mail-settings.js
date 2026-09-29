'use strict';

// ─── mail settings ────────────────────────────────────────────────────────────
// Addresses and signatures, sending options, labels, filters, templates, and
// a setup check (DNS records the mail server needs, sending budget). Two
// columns on wide screens; every section is one card with one-line rows and
// an Edit button plus a "more" menu, editing inline.

const MAIL_FILTER_FIELDS = [['from', 'From'], ['to', 'To or Cc'], ['subject', 'Subject'], ['words', 'Has the words']];

async function renderMailSettings() {
  const el = document.getElementById('mail-settings');
  el.innerHTML = '<div class="ms-grid"><div class="ms-col"><div class="skel" style="height:220px"></div></div><div class="ms-col"><div class="skel" style="height:220px"></div></div></div>';
  try {
    await loadMailBoot(true);
    if (!MAIL.boot.configured) { el.innerHTML = `<div class="mail-empty"><i class="ph-bold ph-envelope-simple"></i><div class="mail-empty-title">Mail isn't set up on this server yet</div><p>See docs/mail.md in the repository.</p></div>`; return; }
    const [filters, templates] = await Promise.all([mailApi('/filters'), mailApi('/templates')]);
    el.innerHTML = `
      <div class="ms-grid">
        <div class="ms-col">
          <section class="ms-card" id="ms-addresses"></section>
          <section class="ms-card" id="ms-sending"></section>
          <section class="ms-card" id="ms-setup"></section>
        </div>
        <div class="ms-col">
          <section class="ms-card" id="ms-filters"></section>
          <section class="ms-card" id="ms-labels"></section>
          <section class="ms-card" id="ms-templates"></section>
        </div>
      </div>`;
    renderMsAddresses();
    renderMsSending();
    renderMsSetup();
    renderMsFilters(filters);
    renderMsLabels();
    renderMsTemplates(templates);
  } catch (err) {
    el.innerHTML = mailErrorHTML(err.message);
  }
}

// Card header: title, one-line description, optional action button.
function msHead(title, desc, action) {
  return `<header class="ms-card-hd"><div><h2 class="ms-card-title">${esc(title)}</h2>${desc ? `<p class="ms-card-desc">${desc}</p>` : ''}</div>${action || ''}</header>`;
}

function msRowActions(key) {
  return `<div class="ms-row-actions"><button class="btn-ghost btn-sm" data-edit="${esc(key)}">Edit</button><button class="row-btn" data-more="${esc(key)}" aria-label="More actions"><i class="ph-bold ph-dots-three"></i></button></div>`;
}

async function msRun(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (err) { mailToast(err.message, { error: true }); btn.disabled = false; }
}

// Confirm a destructive choice made from a "more" menu, in place of its button.
function msConfirmFromMenu(anchor, question, run) {
  mailConfirmButton(anchor, question, run);
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

// ─── addresses ────────────────────────────────────────────────────────────────
function renderMsAddresses() {
  const box = document.getElementById('ms-addresses');
  const a = MAIL.boot.addresses;
  if (!a) { box.innerHTML = msHead('Addresses', 'Address details are unavailable right now.'); return; }
  box.innerHTML = msHead('Addresses and signatures', 'Where you receive mail and how you sign it. Replies go out from the address a message was sent to.') + `
    <div class="ms-rows">
      ${a.addresses.map(x => `
        <div class="ms-row" data-row="${esc(x.email)}">
          <div class="ms-row-main">
            <div class="ms-row-title">${esc(x.email)} <span class="cur-badge ${x.primary ? 'cur-badge-success' : 'cur-badge-neutral'}">${x.primary ? 'Primary' : 'Alias'}</span></div>
            <div class="ms-row-meta">${esc(x.identity?.name && x.identity.name !== x.email ? x.identity.name : 'No display name')} · ${x.identity?.htmlSignature ? 'signature set' : 'no signature'}</div>
          </div>
          ${x.primary || !a.manageable ? `<div class="ms-row-actions"><button class="btn-ghost btn-sm" data-edit="${esc(x.email)}">Edit</button></div>` : msRowActions(x.email)}
        </div>`).join('')}
    </div>
    ${a.manageable ? `
    <form class="ms-add" id="ms-add-alias">
      <span class="ms-alias-input"><input class="form-input" name="alias" placeholder="New address, e.g. travel" maxlength="64" autocomplete="off" aria-label="New address"><span class="ms-domain">@${esc(a.domain)}</span></span>
      <button class="btn-ghost btn-sm" type="submit"><i class="ph-bold ph-plus"></i>Add address</button>
    </form>
    <label class="ms-toggle">
      <input type="checkbox" id="ms-catchall" ${a.catchAll ? 'checked' : ''}>
      <span><b>Catch-all</b><span class="ms-toggle-desc">Deliver mail for any address at ${esc(a.domain)} (like shop-name@${esc(a.domain)}) to this inbox. Replying from one turns it into a saved address.</span></span>
    </label>` : '<p class="ms-card-desc">Adding addresses needs the mail admin credentials on the server.</p>'}`;

  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => msAddressEditor(b.dataset.edit)));
  box.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => mailMenu(b, [
    { label: 'Remove address', icon: 'ph-trash', run: () => msConfirmFromMenu(b, `Stop receiving mail at ${b.dataset.more}?`, async () => {
      await mailApi('/addresses/' + encodeURIComponent(b.dataset.more), { method: 'DELETE' });
      await loadMailBoot(true); renderMsAddresses();
      mailToast(`${b.dataset.more} removed`);
    }) },
  ])));
  document.getElementById('ms-add-alias')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.alias;
    if (!input.value.trim()) return input.focus();
    msRun(e.target.querySelector('button'), async () => {
      await mailApi('/addresses', { method: 'POST', body: { name: input.value.trim() } });
      await loadMailBoot(true); renderMsAddresses();
      mailToast('Address added');
    });
  });
  document.getElementById('ms-catchall')?.addEventListener('change', async e => {
    e.target.disabled = true;
    try { await mailApi('/catch-all', { method: 'PUT', body: { enabled: e.target.checked } }); await loadMailBoot(true); mailToast(e.target.checked ? 'Catch-all is on' : 'Catch-all is off'); }
    catch (err) { e.target.checked = !e.target.checked; mailToast(err.message, { error: true }); }
    e.target.disabled = false;
  });
}

function msAddressEditor(email) {
  const row = document.querySelector(`#ms-addresses [data-row="${CSS.escape(email)}"]`);
  if (row.nextElementSibling?.classList.contains('ms-edit')) return row.nextElementSibling.querySelector('input').focus();
  const ident = MAIL.boot.identities.find(i => i.email === email);
  const form = document.createElement('form');
  form.className = 'ms-edit';
  form.innerHTML = `
    <label class="form-field"><span class="form-label">Display name</span>
      <input class="form-input" name="name" value="${esc(ident?.name && ident.name !== email ? ident.name : '')}" placeholder="Mark Gacoka" maxlength="100"></label>
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
      await loadMailBoot(true); renderMsAddresses();
      mailToast('Saved');
    });
  });
}

// ─── sending ──────────────────────────────────────────────────────────────────
function renderMsSending() {
  const box = document.getElementById('ms-sending');
  const s = MAIL.boot.settings;
  box.innerHTML = msHead('Sending and inbox', null) + `
    <div class="ms-rows">
      <div class="ms-row">
        <div class="ms-row-main"><div class="ms-row-title">Undo send</div><div class="ms-row-meta">How long a sent message waits on the server, so you can take it back</div></div>
        <select class="form-select ms-inline-select" id="ms-undo" aria-label="Undo send window">${MAIL.boot.undoChoices.map(n => `<option value="${n}"${n === s.undoSeconds ? ' selected' : ''}>${n ? `${n} seconds` : 'Off'}</option>`).join('')}</select>
      </div>
    </div>
    <label class="ms-toggle"><input type="checkbox" id="ms-split" ${s.splitInbox ? 'checked' : ''}>
      <span><b>Split inbox</b><span class="ms-toggle-desc">Newsletters, notifications and other bulk mail go under Other, so Important shows people. Anyone you've written to always counts as Important.</span></span></label>`;
  document.getElementById('ms-undo').addEventListener('change', async e => {
    try { await mailApi('/settings', { method: 'PUT', body: { undoSeconds: Number(e.target.value) } }); await loadMailBoot(true); mailToast('Undo window saved'); }
    catch (err) { mailToast(err.message, { error: true }); }
  });
  document.getElementById('ms-split').addEventListener('change', async e => {
    e.target.disabled = true;
    try { await mailApi('/settings', { method: 'PUT', body: { splitInbox: e.target.checked } }); await loadMailBoot(true); mailToast(e.target.checked ? 'Split inbox is on' : 'Split inbox is off'); }
    catch (err) { e.target.checked = !e.target.checked; mailToast(err.message, { error: true }); }
    e.target.disabled = false;
  });
}

// ─── labels ───────────────────────────────────────────────────────────────────
function msColorSelect(value, attrs) {
  return `<select class="form-select ms-color" ${attrs}>${MAIL.boot.labelColors.map(c => `<option value="${c}"${c === value ? ' selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select>`;
}

function renderMsLabels() {
  const box = document.getElementById('ms-labels');
  const labels = MAIL.boot.labels;
  box.innerHTML = msHead('Labels', 'Tag conversations without moving them. Filters can add labels automatically.',
    '<button class="btn-ghost btn-sm" id="ms-new-label"><i class="ph-bold ph-plus"></i>New label</button>') + `
    <div class="ms-rows" id="ms-label-rows">
      ${labels.map(l => `<div class="ms-row" data-row="${esc(String(l.id))}">
        <span class="mail-dot" style="--chip:${MAIL_LABEL_COLORS[l.color]}"></span>
        <div class="ms-row-main"><div class="ms-row-title">${esc(l.name)}</div></div>
        ${msRowActions(String(l.id))}
      </div>`).join('') || '<p class="ms-empty">No labels yet.</p>'}
    </div>`;
  document.getElementById('ms-new-label').addEventListener('click', () => msLabelEditor(null));
  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => msLabelEditor(labels.find(l => String(l.id) === b.dataset.edit))));
  box.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => mailMenu(b, [
    { label: 'Delete label', icon: 'ph-trash', run: () => msConfirmFromMenu(b, 'Delete? Conversations keep their folders.', async () => {
      await mailApi('/labels/' + b.dataset.more, { method: 'DELETE' });
      await loadMailBoot(true); renderMsLabels();
      renderMsFilters(await mailApi('/filters'));
    }) },
  ])));
}

function msLabelEditor(l) {
  const box = document.getElementById('ms-labels');
  box.querySelector('.ms-edit')?.remove();
  const form = document.createElement('form');
  form.className = 'ms-edit ms-edit-inline';
  form.innerHTML = `<span class="mail-dot" style="--chip:${MAIL_LABEL_COLORS[l?.color || 'patina']}"></span>
    <input class="form-input" name="name" value="${esc(l?.name || '')}" placeholder="Label name" maxlength="40" aria-label="Label name">
    ${msColorSelect(l?.color || 'patina', 'name="color" aria-label="Colour"')}
    <button class="btn-primary btn-sm" type="submit">${l ? 'Save' : 'Add'}</button><button class="btn-ghost btn-sm" type="button" data-cancel>Cancel</button>`;
  const row = l && box.querySelector(`[data-row="${CSS.escape(String(l.id))}"]`);
  if (row) row.after(form); else document.getElementById('ms-label-rows').prepend(form);
  form.name.focus();
  form.color.addEventListener('change', () => form.querySelector('.mail-dot').style.setProperty('--chip', MAIL_LABEL_COLORS[form.color.value]));
  form.querySelector('[data-cancel]').addEventListener('click', () => form.remove());
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!form.name.value.trim()) return form.name.focus();
    msRun(form.querySelector('[type=submit]'), async () => {
      await mailApi(l ? '/labels/' + l.id : '/labels', { method: l ? 'PATCH' : 'POST', body: { name: form.name.value.trim(), color: form.color.value } });
      await loadMailBoot(true); renderMsLabels();
    });
  });
}

// ─── filters ──────────────────────────────────────────────────────────────────
function msFilterSummary(f) {
  const field = Object.fromEntries(MAIL_FILTER_FIELDS);
  const conds = f.conditions.map(c => `${field[c.field]} ${c.op === 'is' ? 'is' : 'contains'} “${c.value}”`).join(f.match === 'any' ? ' or ' : ' and ');
  const a = f.actions, acts = [];
  const label = mailLabel(a.labelId);
  if (label) acts.push(`label ${label.name}`);
  if (a.archive) acts.push('skip the inbox');
  if (a.folderId) acts.push('move to ' + (MAIL.boot.folders.find(x => x.id === a.folderId)?.name || 'folder'));
  if (a.markRead) acts.push('mark read');
  if (a.star) acts.push('star');
  if (a.importance) acts.push(a.importance === 'important' ? 'Important' : 'Other');
  return `If ${conds} → ${acts.join(', ') || 'no action'}`;
}

function msFilterBody(f, overrides = {}) {
  return {
    name: f.name, match: f.match, enabled: f.enabled, conditions: f.conditions,
    actions: { labelId: f.actions.labelId, archive: !!f.actions.archive, folderId: f.actions.folderId || null, importance: f.actions.importance || null, markRead: !!f.actions.markRead, star: !!f.actions.star },
    ...overrides,
  };
}

function renderMsFilters(filters) {
  const box = document.getElementById('ms-filters');
  box.innerHTML = msHead('Filters', 'Run on the server as mail arrives, top to bottom, so they also apply on your phone. Spam is never filtered out of Junk.',
    '<button class="btn-ghost btn-sm" id="ms-new-filter"><i class="ph-bold ph-plus"></i>New filter</button>') + `
    <div class="ms-rows" id="ms-filter-rows">
      ${filters.map(f => `<div class="ms-row${f.enabled ? '' : ' off'}" data-row="${esc(String(f.id))}">
        <div class="ms-row-main"><div class="ms-row-title">${esc(f.name)}${f.enabled ? '' : ' <span class="cur-badge cur-badge-neutral">Paused</span>'}</div>
          <div class="ms-row-meta">${esc(msFilterSummary(f))}</div></div>
        ${msRowActions(String(f.id))}
      </div>`).join('') || '<p class="ms-empty">No filters yet.</p>'}
    </div>`;
  const reload = async () => renderMsFilters(await mailApi('/filters'));
  document.getElementById('ms-new-filter').addEventListener('click', () => msFilterEditor(null));
  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => msFilterEditor(filters.find(f => String(f.id) === b.dataset.edit))));
  box.querySelectorAll('[data-more]').forEach(b => {
    const i = filters.findIndex(f => String(f.id) === b.dataset.more);
    const f = filters[i];
    b.addEventListener('click', () => mailMenu(b, [
      { label: 'Apply to existing mail', icon: 'ph-play', run: async () => {
        try {
          const { matched } = await mailApi(`/filters/${f.id}/run`, { method: 'POST' });
          mailToast(matched ? `Applied to ${matched} message${matched === 1 ? '' : 's'}` : 'No existing mail matches this filter');
          refreshMailCounts();
        } catch (err) { mailToast(err.message, { error: true }); }
      } },
      { label: f.enabled ? 'Pause' : 'Resume', icon: f.enabled ? 'ph-pause' : 'ph-play-circle', run: async () => {
        try { await mailApi('/filters/' + f.id, { method: 'PUT', body: msFilterBody(f, { enabled: !f.enabled }) }); reload(); }
        catch (err) { mailToast(err.message, { error: true }); }
      } },
      { label: 'Move up', icon: 'ph-arrow-up', disabled: i === 0, run: async () => { await mailApi(`/filters/${f.id}/move`, { method: 'POST', body: { direction: 'up' } }); reload(); } },
      { label: 'Move down', icon: 'ph-arrow-down', disabled: i === filters.length - 1, run: async () => { await mailApi(`/filters/${f.id}/move`, { method: 'POST', body: { direction: 'down' } }); reload(); } },
      { sep: true },
      { label: 'Delete filter', icon: 'ph-trash', run: () => msConfirmFromMenu(b, 'Delete this filter?', async () => { await mailApi('/filters/' + f.id, { method: 'DELETE' }); reload(); }) },
    ]));
  });
}

function msFilterEditor(f) {
  const box = document.getElementById('ms-filters');
  box.querySelector('.ms-edit')?.remove();
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
  form.className = 'ms-edit';
  form.innerHTML = `
    <label class="form-field"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(f?.name || '')}" placeholder="Airline mail" maxlength="80"></label>
    <div class="form-field"><span class="form-label">When a message matches
      <select class="form-select ms-match" name="match" aria-label="Match all or any"><option value="all"${f?.match !== 'any' ? ' selected' : ''}>all</option><option value="any"${f?.match === 'any' ? ' selected' : ''}>any</option></select> of these</span>
      <div class="ms-conds">${(f?.conditions?.length ? f.conditions : [{ field: 'from' }]).map(condRow).join('')}</div>
      <button type="button" class="btn-link" data-add-cond><i class="ph-bold ph-plus"></i>Add condition</button>
    </div>
    <div class="form-field"><span class="form-label">Do this</span>
      <div class="ms-actions-grid">
        <label class="form-field"><span class="ms-sub">Label</span><select class="form-select" name="labelId"><option value="">None</option>${MAIL.boot.labels.map(l => `<option value="${l.id}"${String(a.labelId) === String(l.id) ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <label class="form-field"><span class="ms-sub">Move to</span><select class="form-select" name="dest"><option value="">Leave in Inbox</option><option value="archive"${dest === 'archive' ? ' selected' : ''}>Archive (skip the inbox)</option>${folders.map(x => `<option value="${esc(x.id)}"${dest === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="form-field"><span class="ms-sub">Inbox section</span><select class="form-select" name="importance"><option value="">Decide automatically</option><option value="important"${a.importance === 'important' ? ' selected' : ''}>Important</option><option value="other"${a.importance === 'other' ? ' selected' : ''}>Other</option></select></label>
      </div>
      <div class="ms-checks-row">
        <label class="ms-check"><input type="checkbox" name="markRead"${a.markRead ? ' checked' : ''}> Mark as read</label>
        <label class="ms-check"><input type="checkbox" name="star"${a.star ? ' checked' : ''}> Star it</label>
        <label class="ms-check"><input type="checkbox" name="enabled"${f?.enabled === false ? '' : ' checked'}> Filter is on</label>
      </div>
    </div>
    <div class="form-error" role="alert"></div>
    <div class="ms-actions"><button class="btn-primary btn-sm" type="submit">${f ? 'Save filter' : 'Create filter'}</button><button type="button" class="btn-ghost btn-sm" data-cancel>Cancel</button></div>`;
  const row = f && box.querySelector(`[data-row="${CSS.escape(String(f.id))}"]`);
  if (row) row.after(form); else document.getElementById('ms-filter-rows').prepend(form);
  const conds = form.querySelector('.ms-conds');
  const wireRm = () => conds.querySelectorAll('[data-rm-cond]').forEach(b => { b.onclick = () => { if (conds.children.length > 1) b.closest('.ms-cond').remove(); }; });
  wireRm();
  form.querySelector('[data-add-cond]').addEventListener('click', () => { conds.insertAdjacentHTML('beforeend', condRow({ field: 'subject' })); wireRm(); conds.lastElementChild.querySelector('input').focus(); });
  form.querySelector('[data-cancel]').addEventListener('click', () => form.remove());
  form.name.focus();
  form.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.style.display = 'none';
    const body = {
      name: form.name.value, match: form.match.value, enabled: form.enabled.checked,
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
      renderMsFilters(await mailApi('/filters'));
      mailToast(f ? 'Filter saved' : 'Filter created. It applies to new mail; use "Apply to existing mail" in its menu for the rest.');
    } catch (ex) {
      err.textContent = ex.message; err.style.display = 'block'; btn.disabled = false;
    }
  });
}

// ─── templates ────────────────────────────────────────────────────────────────
function renderMsTemplates(templates) {
  const box = document.getElementById('ms-templates');
  box.innerHTML = msHead('Templates', 'Reusable replies. Insert one from the note button while writing.',
    '<button class="btn-ghost btn-sm" id="ms-new-template"><i class="ph-bold ph-plus"></i>New template</button>') + `
    <div class="ms-rows" id="ms-template-rows">
      ${templates.map(t => `<div class="ms-row" data-row="${esc(String(t.id))}">
        <div class="ms-row-main"><div class="ms-row-title">${esc(t.name)}</div><div class="ms-row-meta">${esc(t.subject || 'No subject')}</div></div>
        ${msRowActions(String(t.id))}
      </div>`).join('') || '<p class="ms-empty">No templates yet.</p>'}
    </div>`;
  document.getElementById('ms-new-template').addEventListener('click', () => msTemplateEditor(null));
  box.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => msTemplateEditor(templates.find(t => String(t.id) === b.dataset.edit))));
  box.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => mailMenu(b, [
    { label: 'Delete template', icon: 'ph-trash', run: () => msConfirmFromMenu(b, 'Delete this template?', async () => {
      await mailApi('/templates/' + b.dataset.more, { method: 'DELETE' });
      renderMsTemplates(await mailApi('/templates'));
    }) },
  ])));
}

function msTemplateEditor(t) {
  const box = document.getElementById('ms-templates');
  box.querySelector('.ms-edit')?.remove();
  const form = document.createElement('form');
  form.className = 'ms-edit';
  form.innerHTML = `
    <label class="form-field"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(t?.name || '')}" maxlength="80" placeholder="Thanks, will follow up"></label>
    <label class="form-field"><span class="form-label">Subject (used when the message has none)</span><input class="form-input" name="subject" value="${esc(t?.subject || '')}" maxlength="500"></label>
    <div class="form-field"><span class="form-label">Body</span>${msEditorHTML('ms-template-body', t?.html, 'Template body')}</div>
    <div class="form-error" role="alert"></div>
    <div class="ms-actions"><button class="btn-primary btn-sm" type="submit">Save template</button><button type="button" class="btn-ghost btn-sm" data-cancel>Cancel</button></div>`;
  const row = t && box.querySelector(`[data-row="${CSS.escape(String(t.id))}"]`);
  if (row) row.after(form); else document.getElementById('ms-template-rows').prepend(form);
  wireMsEditors(form);
  form.name.focus();
  form.querySelector('[data-cancel]').addEventListener('click', () => form.remove());
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    err.style.display = 'none';
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      await mailApi(t ? '/templates/' + t.id : '/templates', { method: t ? 'PUT' : 'POST', body: { name: form.name.value, subject: form.subject.value, html: document.getElementById('ms-template-body').innerHTML } });
      renderMsTemplates(await mailApi('/templates'));
      mailToast('Template saved');
    } catch (ex) { err.textContent = ex.message; err.style.display = 'block'; btn.disabled = false; }
  });
}

// ─── setup check ──────────────────────────────────────────────────────────────
async function renderMsSetup() {
  const box = document.getElementById('ms-setup');
  const host = 'mail.' + (MAIL.boot.addresses?.domain || 'gacoka.com');
  box.innerHTML = msHead('Setup and delivery', 'DNS records the mail server needs, and how much of the relay\'s free allowance is used.',
    '<button class="btn-ghost btn-sm" id="ms-recheck"><i class="ph-bold ph-arrow-clockwise"></i>Check again</button>') + `
    <div id="ms-checks"><div class="skel" style="height:140px"></div></div>
    <details class="ms-phone"><summary>Use this mailbox in a phone or desktop mail app<i class="ph-bold ph-caret-down ms-caret"></i></summary>
      <dl class="ms-dl">
        <dt>Incoming (IMAP)</dt><dd>${esc(host)}, port 993, SSL/TLS</dd>
        <dt>Outgoing (SMTP)</dt><dd>${esc(host)}, port 465, SSL/TLS</dd>
        <dt>Username</dt><dd>${esc(MAIL.boot.address)}</dd>
        <dt>Password</dt><dd>The mailbox password set on the server (MAIL_PASSWORD), not your dashboard password</dd>
      </dl></details>`;
  document.getElementById('ms-recheck').addEventListener('click', renderMsSetup);
  try {
    const h = await mailApi('/health');
    const pending = h.checks.filter(c => !c.ok && c.id !== 'ptr');
    document.getElementById('ms-checks').innerHTML = `
      <div class="ms-budget">
        <div><span class="ms-budget-n">${h.sentToday ?? '—'}</span><span class="ms-budget-of"> / ${h.dailyLimit}</span><div class="ms-row-meta">sent today</div></div>
        <div><span class="ms-budget-n">${h.sentThisMonth ?? '—'}</span><span class="ms-budget-of"> / ${h.monthlyLimit}</span><div class="ms-row-meta">sent this month</div></div>
      </div>
      <div class="ms-rows">${h.checks.map(c => `<div class="ms-row ms-check-row">
        <div class="ms-row-main"><div class="ms-row-title">${esc(c.label)}</div><div class="ms-row-meta">${esc(c.detail)}</div>
          ${c.fix ? `<code class="ms-fix">${esc(c.fix)}</code>` : ''}</div>
        <span class="cur-badge ${c.ok ? 'cur-badge-success' : c.id === 'ptr' ? 'cur-badge-neutral' : 'cur-badge-warning'}">${c.ok ? 'OK' : c.id === 'ptr' ? 'Optional' : 'Fix'}</span>
      </div>`).join('')}</div>
      ${pending.length ? '<p class="ms-card-desc">Edit DNS in Hostinger → Domains → gacoka.com → DNS / Nameservers. Changes can take up to an hour to show here.</p>' : ''}`;
  } catch (err) {
    document.getElementById('ms-checks').innerHTML = `<p class="ms-empty">${esc(err.message)}</p>`;
  }
}
