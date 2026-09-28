'use strict';

// ─── mail settings ────────────────────────────────────────────────────────────
// Addresses and signatures, sending options, labels, filters, templates, and
// a setup check (DNS records the mail server needs, daily sending budget).

const MAIL_FILTER_FIELDS = [['from', 'From'], ['to', 'To or Cc'], ['subject', 'Subject'], ['words', 'Has the words']];

async function renderMailSettings() {
  const el = document.getElementById('mail-settings');
  el.innerHTML = '<div class="skel" style="height:160px"></div><div class="skel" style="height:220px;margin-top:16px"></div>';
  try {
    await loadMailBoot(true);
    if (!MAIL.boot.configured) { el.innerHTML = `<div class="mail-empty"><i class="ph-bold ph-envelope-simple"></i><div class="mail-empty-title">Mail isn't set up on this server yet</div><p>See docs/mail.md in the repository.</p></div>`; return; }
    const [filters, templates] = await Promise.all([mailApi('/filters'), mailApi('/templates')]);
    el.innerHTML = `
      <div class="mail-settings-col">
        <section class="ov-card" id="ms-addresses"></section>
        <section class="ov-card" id="ms-sending"></section>
        <section class="ov-card" id="ms-labels"></section>
        <section class="ov-card" id="ms-filters"></section>
        <section class="ov-card" id="ms-templates"></section>
        <section class="ov-card" id="ms-setup"></section>
      </div>`;
    renderMsAddresses();
    renderMsSending();
    renderMsLabels();
    renderMsFilters(filters);
    renderMsTemplates(templates);
    renderMsSetup();
  } catch (err) {
    el.innerHTML = mailErrorHTML(err.message);
  }
}

function msSaved(btn, text = 'Saved') {
  const old = btn.innerHTML;
  btn.innerHTML = `<i class="ph-bold ph-check"></i>${esc(text)}`;
  setTimeout(() => { btn.innerHTML = old; btn.disabled = false; }, 1500);
}

async function msRun(btn, fn) {
  btn.disabled = true;
  try { await fn(); } catch (err) { mailToast(err.message, { error: true }); btn.disabled = false; }
}

// A small contenteditable rich-text box with bold/italic/link, for signatures and templates.
function msEditorHTML(id, html, label) {
  return `<div class="ms-editor-wrap">
    <div class="mc-toolbar ms-toolbar" data-for="${id}">
      <button class="mc-tool" data-mcmd="bold" aria-label="Bold"><i class="ph-bold ph-text-b"></i></button>
      <button class="mc-tool" data-mcmd="italic" aria-label="Italic"><i class="ph-bold ph-text-italic"></i></button>
      <button class="mc-tool" data-mcmd="link" aria-label="Insert link"><i class="ph-bold ph-link"></i></button>
      <button class="mc-tool" data-mcmd="removeFormat" aria-label="Clear formatting"><i class="ph-bold ph-text-t-slash"></i></button>
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
      if (b.dataset.mcmd === 'link') {
        const sel = getSelection();
        const range = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
        closeMailMenu();
        const pop = document.createElement('form');
        pop.id = 'mail-menu';
        pop.className = 'mail-menu mc-link-pop';
        pop.innerHTML = `<input class="form-input" type="url" placeholder="https://" aria-label="Link address" required><button class="btn-ghost btn-sm" type="submit">Add link</button>`;
        document.body.appendChild(pop);
        const r = b.getBoundingClientRect();
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
        return;
      }
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

// ─── addresses ────────────────────────────────────────────────────────────────
function renderMsAddresses() {
  const box = document.getElementById('ms-addresses');
  const a = MAIL.boot.addresses;
  if (!a) { box.innerHTML = '<div class="ov-card-hd">Addresses</div><p class="ms-note">Address details are unavailable right now.</p>'; return; }
  box.innerHTML = `
    <div class="ov-card-hd">Addresses and signatures</div>
    <div class="ms-list">
      ${a.addresses.map((x, i) => `
        <details class="ms-item"${i === 0 ? ' open' : ''}>
          <summary><span class="ms-item-title">${esc(x.email)}</span>${x.primary ? '<span class="cur-badge cur-badge-success">Primary</span>' : '<span class="cur-badge cur-badge-neutral">Alias</span>'}
            <span class="ms-item-meta">${esc(x.identity?.name || 'No display name')}</span><i class="ph-bold ph-caret-down ms-caret"></i></summary>
          <div class="ms-item-body">
            <label class="form-field"><span class="form-label">Display name</span>
              <input class="form-input" data-name="${esc(x.email)}" value="${esc(x.identity?.name && x.identity.name !== x.email ? x.identity.name : '')}" placeholder="Mark Gacoka" maxlength="100"></label>
            <div class="form-field"><span class="form-label">Signature</span>${msEditorHTML('sig-' + i, x.identity?.htmlSignature, 'Signature for ' + x.email)}</div>
            <div class="ms-actions">
              <button class="btn-primary btn-sm" data-save-id="${esc(x.email)}" data-ed="sig-${i}">Save</button>
              ${x.primary || !a.manageable ? '' : `<button class="btn-ghost btn-sm mail-danger" data-rm-alias="${esc(x.email)}">Remove address</button>`}
            </div>
          </div>
        </details>`).join('')}
    </div>
    ${a.manageable ? `
    <form class="ms-add" id="ms-add-alias">
      <label class="form-field"><span class="form-label">Add an address</span>
        <span class="ms-alias-input"><input class="form-input" name="alias" placeholder="travel" maxlength="64" autocomplete="off" aria-label="New address"><span class="ms-domain">@${esc(a.domain)}</span></span></label>
      <button class="btn-ghost btn-sm" type="submit"><i class="ph-bold ph-plus"></i>Add</button>
    </form>
    <label class="ms-toggle">
      <input type="checkbox" id="ms-catchall" ${a.catchAll ? 'checked' : ''}>
      <span><b>Catch-all</b>: deliver mail for any address at ${esc(a.domain)} (like shop-name@${esc(a.domain)}) to this inbox. Replying from one of those addresses turns it into a saved address.</span>
    </label>` : '<p class="ms-note">Adding addresses needs the mail admin credentials on the server.</p>'}`;

  box.querySelectorAll('[data-save-id]').forEach(b => b.addEventListener('click', () => msRun(b, async () => {
    const email = b.dataset.saveId;
    let ident = MAIL.boot.identities.find(i => i.email === email);
    if (!ident) { mailToast('This address has no sending identity yet. Send one message from it first.', { error: true }); b.disabled = false; return; }
    await mailApi('/identities/' + encodeURIComponent(ident.id), { method: 'PATCH', body: {
      name: box.querySelector(`[data-name="${CSS.escape(email)}"]`).value,
      htmlSignature: document.getElementById(b.dataset.ed).innerHTML,
    } });
    await loadMailBoot(true);
    msSaved(b);
  })));
  box.querySelectorAll('[data-rm-alias]').forEach(b => b.addEventListener('click', () => mailConfirmButton(b, `Stop receiving mail at ${b.dataset.rmAlias}?`, async () => {
    await mailApi('/addresses/' + encodeURIComponent(b.dataset.rmAlias), { method: 'DELETE' });
    await loadMailBoot(true); renderMsAddresses();
    mailToast(`${b.dataset.rmAlias} removed`);
  })));
  document.getElementById('ms-add-alias')?.addEventListener('submit', e => {
    e.preventDefault();
    const input = e.target.alias;
    const btn = e.target.querySelector('button');
    if (!input.value.trim()) return input.focus();
    msRun(btn, async () => {
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
  wireMsEditors(box);
}

// ─── sending ──────────────────────────────────────────────────────────────────
function renderMsSending() {
  const box = document.getElementById('ms-sending');
  const s = MAIL.boot.settings;
  box.innerHTML = `
    <div class="ov-card-hd">Sending and inbox</div>
    <label class="form-field ms-inline-field"><span class="form-label">Undo send</span>
      <select class="form-select" id="ms-undo">${MAIL.boot.undoChoices.map(n => `<option value="${n}"${n === s.undoSeconds ? ' selected' : ''}>${n ? `${n} seconds` : 'Off (send immediately)'}</option>`).join('')}</select></label>
    <p class="ms-note">How long a sent message waits on the server before it goes out, so you can take it back.</p>
    <label class="ms-toggle"><input type="checkbox" id="ms-split" ${s.splitInbox ? 'checked' : ''}>
      <span><b>Split inbox</b>: keep newsletters, notifications and other bulk mail under Other, so Important shows people. Anyone you've written to always counts as Important.</span></label>`;
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
  box.innerHTML = `
    <div class="ov-card-hd">Labels</div>
    <div class="ms-rows">
      ${labels.map(l => `<div class="ms-row" data-label="${esc(String(l.id))}">
        <span class="mail-dot" style="--chip:${MAIL_LABEL_COLORS[l.color]}"></span>
        <input class="form-input" value="${esc(l.name)}" maxlength="40" aria-label="Label name">
        ${msColorSelect(l.color, 'aria-label="Colour"')}
        <button class="btn-ghost btn-sm" data-save>Save</button>
        <button class="row-btn danger" data-del title="Delete label" aria-label="Delete label ${esc(l.name)}"><i class="ph-bold ph-trash"></i></button>
      </div>`).join('') || '<p class="ms-note">No labels yet. Labels tag conversations without moving them, and a filter can add them automatically.</p>'}
    </div>
    <form class="ms-add" id="ms-add-label">
      <input class="form-input" name="name" placeholder="New label" maxlength="40" aria-label="New label name">
      ${msColorSelect('patina', 'name="color" aria-label="Colour"')}
      <button class="btn-ghost btn-sm" type="submit"><i class="ph-bold ph-plus"></i>Add</button>
    </form>`;
  box.querySelectorAll('[data-label]').forEach(row => {
    const id = row.dataset.label;
    row.querySelector('select').addEventListener('change', e => { row.querySelector('.mail-dot').style.setProperty('--chip', MAIL_LABEL_COLORS[e.target.value]); });
    row.querySelector('[data-save]').addEventListener('click', e => msRun(e.currentTarget, async () => {
      await mailApi('/labels/' + id, { method: 'PATCH', body: { name: row.querySelector('input').value, color: row.querySelector('select').value } });
      await loadMailBoot(true); msSaved(e.target.closest('button'));
    }));
    row.querySelector('[data-del]').addEventListener('click', e => mailConfirmButton(e.currentTarget, 'Delete label? Conversations keep their folders.', async () => {
      await mailApi('/labels/' + id, { method: 'DELETE' });
      await loadMailBoot(true); renderMsLabels();
      renderMsFilters(await mailApi('/filters'));
    }));
  });
  document.getElementById('ms-add-label').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    if (!f.name.value.trim()) return f.name.focus();
    msRun(f.querySelector('button'), async () => {
      await mailApi('/labels', { method: 'POST', body: { name: f.name.value.trim(), color: f.color.value } });
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
  if (a.archive) acts.push('archive');
  if (a.folderId) acts.push('move to ' + (MAIL.boot.folders.find(x => x.id === a.folderId)?.name || 'folder'));
  if (a.markRead) acts.push('mark read');
  if (a.star) acts.push('star');
  if (a.importance) acts.push(a.importance === 'important' ? 'mark Important' : 'mark Other');
  return { conds, acts: acts.join(', ') || 'no action' };
}

function renderMsFilters(filters) {
  const box = document.getElementById('ms-filters');
  box.innerHTML = `
    <div class="ov-card-hd">Filters <button id="ms-new-filter"><i class="ph-bold ph-plus"></i> New filter</button></div>
    <p class="ms-note">Filters run on the mail server as mail arrives, top to bottom, so they also apply to mail read on your phone. Spam is never filtered out of Junk.</p>
    <div class="ms-rows" id="ms-filter-list">
      ${filters.map((f, i) => { const s = msFilterSummary(f); return `<div class="ms-filter${f.enabled ? '' : ' off'}" data-filter="${esc(String(f.id))}">
        <div class="ms-filter-text"><div class="ms-item-title">${esc(f.name)}${f.enabled ? '' : ' <span class="cur-badge cur-badge-neutral">Paused</span>'}</div>
          <div class="ms-item-meta">If ${esc(s.conds)} → ${esc(s.acts)}</div></div>
        <div class="ms-filter-actions">
          <button class="row-btn" data-move="up" ${i === 0 ? 'disabled' : ''} aria-label="Move up"><i class="ph-bold ph-arrow-up"></i></button>
          <button class="row-btn" data-move="down" ${i === filters.length - 1 ? 'disabled' : ''} aria-label="Move down"><i class="ph-bold ph-arrow-down"></i></button>
          <button class="btn-ghost btn-sm" data-run>Apply to existing mail</button>
          <button class="btn-ghost btn-sm" data-edit>Edit</button>
          <button class="row-btn danger" data-del aria-label="Delete filter"><i class="ph-bold ph-trash"></i></button>
        </div>
      </div>`; }).join('') || '<p class="ms-note">No filters yet.</p>'}
    </div>
    <div id="ms-filter-editor"></div>`;
  document.getElementById('ms-new-filter').addEventListener('click', () => msFilterEditor(null));
  box.querySelectorAll('[data-filter]').forEach(row => {
    const id = row.dataset.filter;
    const f = filters.find(x => String(x.id) === id);
    row.querySelector('[data-edit]').addEventListener('click', () => msFilterEditor(f));
    row.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => msRun(b, async () => {
      await mailApi(`/filters/${id}/move`, { method: 'POST', body: { direction: b.dataset.move } });
      renderMsFilters(await mailApi('/filters'));
    })));
    row.querySelector('[data-run]').addEventListener('click', e => msRun(e.currentTarget, async () => {
      const { matched } = await mailApi(`/filters/${id}/run`, { method: 'POST' });
      mailToast(matched ? `Applied to ${matched} message${matched === 1 ? '' : 's'}` : 'No existing mail matches this filter');
      e.target.closest('button').disabled = false;
      refreshMailCounts();
    }));
    row.querySelector('[data-del]').addEventListener('click', e => mailConfirmButton(e.currentTarget, 'Delete this filter?', async () => {
      await mailApi('/filters/' + id, { method: 'DELETE' });
      renderMsFilters(await mailApi('/filters'));
    }));
  });
}

function msFilterEditor(f) {
  const box = document.getElementById('ms-filter-editor');
  const a = f?.actions || {};
  const folders = MAIL.boot.folders.filter(x => !x.role);
  const dest = a.archive ? 'archive' : a.folderId || '';
  const condRow = c => `<div class="ms-cond">
      <select class="form-select" name="field" aria-label="Field">${MAIL_FILTER_FIELDS.map(([v, l]) => `<option value="${v}"${c.field === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select class="form-select" name="op" aria-label="Match">${[['contains', 'contains'], ['is', 'is exactly']].map(([v, l]) => `<option value="${v}"${(c.op || 'contains') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <input class="form-input" name="value" value="${esc(c.value || '')}" placeholder="airline.com" aria-label="Value">
      <button type="button" class="row-btn danger" data-rm-cond aria-label="Remove condition"><i class="ph-bold ph-x"></i></button>
    </div>`;
  box.innerHTML = `<form class="ms-filter-form" id="ms-filter-form">
    <div class="ms-filter-form-hd">${f ? 'Edit filter' : 'New filter'}</div>
    <label class="form-field"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(f?.name || '')}" placeholder="Airline mail" maxlength="80"></label>
    <div class="form-field"><span class="form-label">When a message matches
      <select class="form-select ms-match" name="match" aria-label="Match all or any"><option value="all"${f?.match !== 'any' ? ' selected' : ''}>all</option><option value="any"${f?.match === 'any' ? ' selected' : ''}>any</option></select> of these</span>
      <div id="ms-conds">${(f?.conditions?.length ? f.conditions : [{ field: 'from' }]).map(condRow).join('')}</div>
      <button type="button" class="btn-link" id="ms-add-cond"><i class="ph-bold ph-plus"></i>Add condition</button>
    </div>
    <div class="form-field"><span class="form-label">Do this</span>
      <div class="ms-actions-grid">
        <label>Label <select class="form-select" name="labelId"><option value="">None</option>${MAIL.boot.labels.map(l => `<option value="${l.id}"${String(a.labelId) === String(l.id) ? ' selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
        <label>Move to <select class="form-select" name="dest"><option value="">Leave in Inbox</option><option value="archive"${dest === 'archive' ? ' selected' : ''}>Archive (skip the inbox)</option>${folders.map(x => `<option value="${esc(x.id)}"${dest === x.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label>Inbox section <select class="form-select" name="importance"><option value="">Decide automatically</option><option value="important"${a.importance === 'important' ? ' selected' : ''}>Important</option><option value="other"${a.importance === 'other' ? ' selected' : ''}>Other</option></select></label>
        <label class="ms-check"><input type="checkbox" name="markRead"${a.markRead ? ' checked' : ''}> Mark as read</label>
        <label class="ms-check"><input type="checkbox" name="star"${a.star ? ' checked' : ''}> Star it</label>
        <label class="ms-check"><input type="checkbox" name="enabled"${f?.enabled === false ? '' : ' checked'}> Filter is on</label>
      </div>
    </div>
    <div class="form-error" id="ms-filter-error" role="alert"></div>
    <div class="ms-actions"><button class="btn-primary btn-sm" type="submit">${f ? 'Save filter' : 'Create filter'}</button><button type="button" class="btn-ghost btn-sm" id="ms-filter-cancel">Cancel</button></div>
  </form>`;
  const form = document.getElementById('ms-filter-form');
  const conds = document.getElementById('ms-conds');
  const wireRm = () => conds.querySelectorAll('[data-rm-cond]').forEach(b => { b.onclick = () => { if (conds.children.length > 1) b.closest('.ms-cond').remove(); }; });
  wireRm();
  document.getElementById('ms-add-cond').addEventListener('click', () => { conds.insertAdjacentHTML('beforeend', condRow({ field: 'subject' })); wireRm(); conds.lastElementChild.querySelector('input').focus(); });
  document.getElementById('ms-filter-cancel').addEventListener('click', () => { box.innerHTML = ''; });
  form.name.focus();
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('ms-filter-error');
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
      mailToast(f ? 'Filter saved' : 'Filter created. It applies to new mail; use "Apply to existing mail" for the rest.');
    } catch (ex) {
      err.textContent = ex.message; err.style.display = 'block'; btn.disabled = false;
    }
  });
}

// ─── templates ────────────────────────────────────────────────────────────────
function renderMsTemplates(templates) {
  const box = document.getElementById('ms-templates');
  box.innerHTML = `
    <div class="ov-card-hd">Templates <button id="ms-new-template"><i class="ph-bold ph-plus"></i> New template</button></div>
    <p class="ms-note">Insert a template from the <i class="ph-bold ph-note" aria-label="template"></i> button while writing.</p>
    <div class="ms-rows">
      ${templates.map(t => `<div class="ms-filter" data-template="${esc(String(t.id))}">
        <div class="ms-filter-text"><div class="ms-item-title">${esc(t.name)}</div><div class="ms-item-meta">${esc(t.subject || 'No subject')}</div></div>
        <div class="ms-filter-actions"><button class="btn-ghost btn-sm" data-edit>Edit</button><button class="row-btn danger" data-del aria-label="Delete template"><i class="ph-bold ph-trash"></i></button></div>
      </div>`).join('') || '<p class="ms-note">No templates yet. Save replies you send often.</p>'}
    </div>
    <div id="ms-template-editor"></div>`;
  document.getElementById('ms-new-template').addEventListener('click', () => msTemplateEditor(null));
  box.querySelectorAll('[data-template]').forEach(row => {
    const t = templates.find(x => String(x.id) === row.dataset.template);
    row.querySelector('[data-edit]').addEventListener('click', () => msTemplateEditor(t));
    row.querySelector('[data-del]').addEventListener('click', e => mailConfirmButton(e.currentTarget, 'Delete this template?', async () => {
      await mailApi('/templates/' + t.id, { method: 'DELETE' });
      renderMsTemplates(await mailApi('/templates'));
    }));
  });
}

function msTemplateEditor(t) {
  const box = document.getElementById('ms-template-editor');
  box.innerHTML = `<form class="ms-filter-form" id="ms-template-form">
    <div class="ms-filter-form-hd">${t ? 'Edit template' : 'New template'}</div>
    <label class="form-field"><span class="form-label">Name</span><input class="form-input" name="name" value="${esc(t?.name || '')}" maxlength="80" placeholder="Thanks, will follow up"></label>
    <label class="form-field"><span class="form-label">Subject (used when the message has none)</span><input class="form-input" name="subject" value="${esc(t?.subject || '')}" maxlength="500"></label>
    <div class="form-field"><span class="form-label">Body</span>${msEditorHTML('ms-template-body', t?.html, 'Template body')}</div>
    <div class="form-error" id="ms-template-error" role="alert"></div>
    <div class="ms-actions"><button class="btn-primary btn-sm" type="submit">Save template</button><button type="button" class="btn-ghost btn-sm" id="ms-template-cancel">Cancel</button></div>
  </form>`;
  wireMsEditors(box);
  const form = document.getElementById('ms-template-form');
  form.name.focus();
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  document.getElementById('ms-template-cancel').addEventListener('click', () => { box.innerHTML = ''; });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('ms-template-error');
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
  box.innerHTML = `<div class="ov-card-hd">Setup and delivery <button id="ms-recheck">Check again</button></div><div id="ms-checks"><div class="skel" style="height:120px"></div></div>
    <details class="ms-item ms-phone"><summary><span class="ms-item-title">Use this mailbox on your phone or laptop</span><i class="ph-bold ph-caret-down ms-caret"></i></summary>
      <div class="ms-item-body"><dl class="ms-dl">
        <dt>Incoming (IMAP)</dt><dd>${esc(host)}, port 993, SSL/TLS</dd>
        <dt>Outgoing (SMTP)</dt><dd>${esc(host)}, port 465, SSL/TLS</dd>
        <dt>Username</dt><dd>${esc(MAIL.boot.address)}</dd>
        <dt>Password</dt><dd>The mailbox password set on the server (not your dashboard password)</dd>
      </dl></div></details>`;
  document.getElementById('ms-recheck').addEventListener('click', renderMsSetup);
  try {
    const h = await mailApi('/health');
    const pending = h.checks.filter(c => !c.ok);
    document.getElementById('ms-checks').innerHTML = `
      <div class="ms-budget">Sent today: <b>${h.sentToday ?? '—'}</b> of ${h.dailyLimit} (the relay's free daily limit)</div>
      <div class="ms-checks">${h.checks.map(c => `<div class="ms-check-row">
        <span class="cur-badge ${c.ok ? 'cur-badge-success' : c.id === 'ptr' ? 'cur-badge-neutral' : 'cur-badge-warning'}">${c.ok ? 'OK' : c.id === 'ptr' ? 'Optional' : 'Action needed'}</span>
        <div class="ms-check-text"><div class="ms-item-title">${esc(c.label)}</div><div class="ms-item-meta">${esc(c.detail)}</div>
          ${c.fix ? `<code class="ms-fix">${esc(c.fix)}</code>` : ''}</div></div>`).join('')}</div>
      ${pending.length ? '<p class="ms-note">DNS records are edited in Hostinger → Domains → gacoka.com → DNS / Nameservers. Changes can take up to an hour to show here.</p>' : ''}`;
  } catch (err) {
    document.getElementById('ms-checks').innerHTML = `<p class="ms-note">${esc(err.message)}</p>`;
  }
}
