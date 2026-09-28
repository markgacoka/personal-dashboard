'use strict';

// ─── mail: folders, thread list, thread reader ────────────────────────────────
// Talks to /api/mail/*. Composer lives in mail-compose.js, settings in
// mail-settings.js. No live updates: the list refreshes when shown, after
// actions, and from the Refresh button.

const MAIL = {
  boot: null,          // /api/mail/bootstrap payload
  folder: 'inbox',     // role, custom folder id, 'starred' | 'all' | 'scheduled' | 'followups', or 'label:<id>'
  tab: (() => { try { return localStorage.getItem('mail-tab') || 'important'; } catch { return 'important'; } })(),
  q: '',
  threads: [], total: 0,
  selected: new Set(),
  thread: null,        // open conversation
  listSeq: 0,
};

const MAIL_ROLE_NAMES = { inbox: 'Inbox', drafts: 'Drafts', sent: 'Sent', archive: 'Archive', junk: 'Spam', trash: 'Trash' };
const MAIL_ROLE_ICONS = { inbox: 'ph-tray', drafts: 'ph-file-dashed', sent: 'ph-paper-plane-tilt', archive: 'ph-archive', junk: 'ph-warning-octagon', trash: 'ph-trash' };
const MAIL_LABEL_COLORS = { patina: 'var(--patina)', gold: 'var(--gold)', success: 'var(--success)', warning: 'var(--warning)', danger: 'var(--danger)', severe: 'var(--severe)', info: 'var(--info)', muted: 'var(--faint)' };

async function mailApi(path, { method = 'GET', body, headers } = {}) {
  const init = { method, credentials: 'same-origin', headers: { ...(headers || {}) } };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body;
    else { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  }
  const r = await fetch('/api/mail' + path, init);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

function mailFolderName(f) { return f.role ? (MAIL_ROLE_NAMES[f.role] || f.name) : f.name; }
function mailRoleId(role) { return MAIL.boot?.folders.find(f => f.role === role)?.id; }
function mailLabel(idOrKeyword) { return MAIL.boot?.labels.find(l => String(l.id) === String(idOrKeyword) || l.keyword === idOrKeyword); }
function mailLabelChip(l, removable) {
  return `<span class="mail-chip" style="--chip:${MAIL_LABEL_COLORS[l.color] || 'var(--patina)'}">${esc(l.name)}${removable ? `<button class="mail-chip-x" data-unlabel="${esc(String(l.id))}" aria-label="Remove label ${esc(l.name)}"><i class="ph-bold ph-x"></i></button>` : ''}</span>`;
}

// ─── toast ────────────────────────────────────────────────────────────────────
let _mailToastTimer = null;
function mailToast(text, { actionLabel, onAction, duration = 5000, error = false } = {}) {
  let el = document.getElementById('mail-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'mail-toast';
    el.className = 'mail-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.classList.toggle('error', error);
  el.innerHTML = `<span class="mail-toast-text">${esc(text)}</span>` +
    (actionLabel ? `<button class="mail-toast-action">${esc(actionLabel)}</button>` : '') +
    `<button class="mail-toast-close" aria-label="Dismiss"><i class="ph-bold ph-x"></i></button>`;
  el.classList.add('show');
  clearTimeout(_mailToastTimer);
  const hide = () => el.classList.remove('show');
  el.querySelector('.mail-toast-close').onclick = hide;
  if (actionLabel) el.querySelector('.mail-toast-action').onclick = () => { hide(); onAction?.(); };
  if (duration) _mailToastTimer = setTimeout(hide, duration);
  return { hide, set: t => { const s = el.querySelector('.mail-toast-text'); if (s) s.textContent = t; } };
}

// ─── popover menu (fixed position so it escapes scrolling containers) ─────────
function closeMailMenu() { document.getElementById('mail-menu')?.remove(); }
function mailMenu(anchor, items) {
  closeMailMenu();
  const menu = document.createElement('div');
  menu.id = 'mail-menu';
  menu.className = 'mail-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items.length ? items.map((it, i) => it.sep
    ? '<div class="mail-menu-sep" role="separator"></div>'
    : `<button role="menuitem" class="mail-menu-item" data-i="${i}" ${it.disabled ? 'disabled' : ''}>` +
      (it.color ? `<span class="mail-dot" style="--chip:${it.color}"></span>` : it.icon ? `<i class="ph-bold ${it.icon}"></i>` : '') +
      `<span>${esc(it.label)}</span>${it.hint ? `<span class="mail-menu-hint">${esc(it.hint)}</span>` : ''}</button>`).join('')
    : '<div class="mail-menu-empty">Nothing here yet</div>';
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.left, innerWidth - mw - 8)) + 'px';
  menu.style.top = (r.bottom + 4 + mh > innerHeight ? Math.max(8, r.top - mh - 4) : r.bottom + 4) + 'px';
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-i]');
    if (!b) return;
    closeMailMenu();
    items[+b.dataset.i].run?.();
  });
  menu.querySelector('button')?.focus();
  setTimeout(() => {
    const off = e => { if (!menu.contains(e.target)) { closeMailMenu(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
  menu.addEventListener('keydown', e => {
    const btns = [...menu.querySelectorAll('button:not([disabled])')];
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'Escape') { closeMailMenu(); anchor.focus(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
  });
}

// ─── bootstrap + counts ───────────────────────────────────────────────────────
async function loadMailBoot(force = false) {
  if (MAIL.boot && !force) return MAIL.boot;
  MAIL.boot = await mailApi('/bootstrap');
  updateMailBadge();
  return MAIL.boot;
}

function updateMailBadge() {
  const el = document.getElementById('sb-mail-count');
  if (!el) return;
  const n = MAIL.boot?.configured ? (MAIL.boot.settings.splitInbox ? MAIL.boot.counts.inboxImportant : MAIL.boot.counts.inbox) : 0;
  el.hidden = !n;
  el.textContent = n > 99 ? '99+' : String(n);
}

// Folder counts change with every action; refetching bootstrap keeps rail and badge honest.
async function refreshMailCounts() {
  try { await loadMailBoot(true); renderMailRail(); } catch { /* keep the old counts */ }
}

// ─── rail ─────────────────────────────────────────────────────────────────────
function renderMailRail() {
  const rail = document.getElementById('mail-rail');
  const b = MAIL.boot;
  if (!rail || !b?.configured) return;
  const f = b.folders;
  const count = (n, cls = '') => n ? `<span class="mail-count ${cls}">${n > 999 ? '999+' : n}</span>` : '';
  const item = (key, icon, label, n, cls) =>
    `<button class="mail-folder${MAIL.folder === key ? ' active' : ''}" data-folder="${esc(key)}"${MAIL.folder === key ? ' aria-current="page"' : ''}>` +
    `<i class="ph-bold ${icon}"></i><span class="mail-folder-name">${esc(label)}</span>${count(n, cls)}</button>`;
  const role = r => f.find(x => x.role === r) || {};
  const inboxUnread = b.settings.splitInbox ? b.counts.inboxImportant : b.counts.inbox;
  const custom = f.filter(x => !x.role).sort((a, c) => a.name.localeCompare(c.name));

  rail.innerHTML = `
    <button class="btn-primary mail-compose-btn" id="mail-compose"><i class="ph-bold ph-pencil-simple-line"></i> Compose</button>
    <div class="mail-folders">
      ${item('inbox', MAIL_ROLE_ICONS.inbox, 'Inbox', inboxUnread, 'strong')}
      ${item('starred', 'ph-star', 'Starred', 0)}
      ${item('followups', 'ph-bell-ringing', 'Follow-ups', b.counts.followupsDue, 'strong')}
      ${item('scheduled', 'ph-clock', 'Scheduled', b.counts.scheduled)}
      ${item('drafts', MAIL_ROLE_ICONS.drafts, 'Drafts', role('drafts').total)}
      ${item('sent', MAIL_ROLE_ICONS.sent, 'Sent', 0)}
      ${item('archive', MAIL_ROLE_ICONS.archive, 'Archive', 0)}
      ${item('junk', MAIL_ROLE_ICONS.junk, 'Spam', role('junk').unread)}
      ${item('trash', MAIL_ROLE_ICONS.trash, 'Trash', 0)}
      ${item('all', 'ph-envelope-simple', 'All mail', 0)}
    </div>
    <div class="mail-rail-hd"><span>Folders</span><button class="mail-rail-add" id="mail-add-folder" title="New folder" aria-label="New folder"><i class="ph-bold ph-plus"></i></button></div>
    <div class="mail-folders" id="mail-custom-folders">
      ${custom.map(x => item(x.id, 'ph-folder-simple', x.name, x.unread)).join('') || '<div class="mail-rail-empty">Folders hold mail you move out of the inbox.</div>'}
    </div>
    <div class="mail-rail-hd"><span>Labels</span><button class="mail-rail-add" id="mail-add-label" title="New label" aria-label="New label"><i class="ph-bold ph-plus"></i></button></div>
    <div class="mail-folders" id="mail-labels">
      ${b.labels.map(l => `<button class="mail-folder${MAIL.folder === 'label:' + l.id ? ' active' : ''}" data-folder="label:${esc(String(l.id))}"><span class="mail-dot" style="--chip:${MAIL_LABEL_COLORS[l.color]}"></span><span class="mail-folder-name">${esc(l.name)}</span></button>`).join('') || '<div class="mail-rail-empty">Labels tag conversations across folders.</div>'}
    </div>`;

  rail.querySelectorAll('[data-folder]').forEach(el => el.addEventListener('click', () => navigate('mail', el.dataset.folder)));
  document.getElementById('mail-compose').addEventListener('click', () => openComposer({ mode: 'new' }));
  document.getElementById('mail-add-folder').addEventListener('click', () => mailInlineCreate('mail-custom-folders', 'Folder name', async name => {
    const { id } = await mailApi('/folders', { method: 'POST', body: { name } });
    await refreshMailCounts();
    navigate('mail', id);
  }));
  document.getElementById('mail-add-label').addEventListener('click', () => mailInlineCreate('mail-labels', 'Label name', async name => {
    await mailApi('/labels', { method: 'POST', body: { name } });
    await refreshMailCounts();
  }));
}

// A one-line input at the top of a rail section; Enter saves, Escape cancels.
function mailInlineCreate(containerId, placeholder, save) {
  const box = document.getElementById(containerId);
  if (box.querySelector('.mail-inline-new')) return box.querySelector('input').focus();
  const row = document.createElement('form');
  row.className = 'mail-inline-new';
  row.innerHTML = `<input class="form-input" maxlength="60" placeholder="${esc(placeholder)}" aria-label="${esc(placeholder)}"><button class="btn-ghost btn-sm" type="submit">Add</button>`;
  box.prepend(row);
  const input = row.querySelector('input');
  input.focus();
  input.addEventListener('keydown', e => { if (e.key === 'Escape') row.remove(); });
  row.addEventListener('submit', async e => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return row.remove();
    row.querySelector('button').disabled = true;
    try { await save(name); } catch (err) { mailToast(err.message, { error: true }); row.querySelector('button').disabled = false; }
  });
}

// ─── folder view ──────────────────────────────────────────────────────────────
async function showMailFolder(id) {
  const list = document.getElementById('mail-list');
  if (id) MAIL.folder = decodeURIComponent(id);
  MAIL.selected.clear();
  if (!MAIL.boot) list.innerHTML = mailSkeleton();
  try { await loadMailBoot(true); }
  catch (err) { list.innerHTML = mailErrorHTML(err.message); return; }
  if (!MAIL.boot.configured) { renderMailUnconfigured(); return; }
  renderMailRail();
  const search = document.getElementById('mail-search');
  search.value = MAIL.q;
  await loadMailThreads();
}

function mailSkeleton(n = 8) {
  return Array.from({ length: n }, () => '<div class="mail-row mail-row-skel"><div class="skel" style="height:14px;width:28%"></div><div class="skel" style="height:12px;width:70%;margin-top:8px"></div></div>').join('');
}

function mailErrorHTML(msg) {
  return `<div class="mail-empty"><i class="ph-bold ph-plugs-connected"></i><div class="mail-empty-title">Mail is unreachable</div><p>${esc(msg)}</p><button class="btn-ghost btn-sm" onclick="showMailFolder()">Try again</button></div>`;
}

function renderMailUnconfigured() {
  document.getElementById('mail-rail').innerHTML = '';
  document.getElementById('mail-subbar').innerHTML = '';
  document.getElementById('mail-list').innerHTML = `<div class="mail-empty"><i class="ph-bold ph-envelope-simple"></i><div class="mail-empty-title">Mail isn't set up on this server yet</div><p>The mail server and its credentials (MAIL_JMAP_URL, MAIL_USER, MAIL_PASSWORD) need to be configured. See docs/mail.md in the repository.</p></div>`;
}

function mailListParams(position = 0) {
  const p = new URLSearchParams({ position: String(position), limit: '50' });
  if (MAIL.folder.startsWith('label:')) { p.set('folder', 'all'); p.set('label', MAIL.folder.slice(6)); }
  else p.set('folder', MAIL.folder);
  if (MAIL.folder === 'inbox' && MAIL.boot.settings.splitInbox && !MAIL.q) p.set('tab', MAIL.tab);
  if (MAIL.q) { p.set('q', MAIL.q); if (MAIL.folder === 'inbox') p.set('folder', 'all'); }
  return p;
}

async function loadMailThreads({ append = false } = {}) {
  const list = document.getElementById('mail-list');
  const seq = ++MAIL.listSeq;
  renderMailSubbar();
  if (MAIL.folder === 'scheduled') return renderMailScheduled(seq);
  if (MAIL.folder === 'followups') return renderMailFollowups(seq);
  if (!append) list.innerHTML = mailSkeleton();
  try {
    const data = await mailApi('/threads?' + mailListParams(append ? MAIL.threads.length : 0));
    if (seq !== MAIL.listSeq) return;
    MAIL.threads = append ? [...MAIL.threads, ...data.threads] : data.threads;
    MAIL.total = data.total;
    renderMailList();
  } catch (err) {
    if (seq === MAIL.listSeq) list.innerHTML = mailErrorHTML(err.message);
  }
}

function mailFolderTitle() {
  if (MAIL.q) return 'Search results';
  if (MAIL.folder.startsWith('label:')) return mailLabel(MAIL.folder.slice(6))?.name || 'Label';
  const virtual = { starred: 'Starred', all: 'All mail', scheduled: 'Scheduled', followups: 'Follow-ups' };
  if (virtual[MAIL.folder]) return virtual[MAIL.folder];
  const f = MAIL.boot.folders.find(x => x.role === MAIL.folder || x.id === MAIL.folder);
  return f ? mailFolderName(f) : 'Mail';
}

function renderMailSubbar() {
  const bar = document.getElementById('mail-subbar');
  const n = MAIL.selected.size;
  document.getElementById('topbar-title').textContent = mailFolderTitle();
  if (n) {
    const inTrash = MAIL.folder === 'trash', inJunk = MAIL.folder === 'junk';
    const btn = (act, icon, label) => `<button class="btn-ghost btn-sm" data-bulk="${act}"><i class="ph-bold ${icon}"></i><span class="mail-hide-sm">${label}</span></button>`;
    bar.innerHTML = `<div class="mail-bulk">
      <label class="mail-check" title="Select all"><input type="checkbox" id="mail-select-all" ${n === MAIL.threads.length ? 'checked' : ''} aria-label="Select all"></label>
      <span class="mail-bulk-n">${n} selected</span>
      ${inTrash || inJunk ? btn('inbox', 'ph-tray-arrow-up', 'Move to Inbox') : btn('archive', 'ph-archive', 'Archive')}
      ${inTrash || inJunk ? btn('delete', 'ph-trash', 'Delete forever') : btn('trash', 'ph-trash', 'Trash')}
      ${btn('read', 'ph-envelope-open', 'Read')}
      ${btn('unread', 'ph-envelope-simple', 'Unread')}
      <button class="btn-ghost btn-sm" data-bulk-menu="label"><i class="ph-bold ph-tag"></i><span class="mail-hide-sm">Label</span></button>
      <button class="btn-ghost btn-sm" data-bulk-menu="move"><i class="ph-bold ph-folder-simple-dashed"></i><span class="mail-hide-sm">Move</span></button>
      <button class="btn-link" id="mail-clear-sel">Clear</button>
    </div>`;
    bar.querySelectorAll('[data-bulk]').forEach(b => b.addEventListener('click', () => mailBulk(b.dataset.bulk)));
    bar.querySelector('[data-bulk-menu="label"]').addEventListener('click', e => mailLabelMenu(e.currentTarget, [...MAIL.selected]));
    bar.querySelector('[data-bulk-menu="move"]').addEventListener('click', e => mailMoveMenu(e.currentTarget, [...MAIL.selected]));
    document.getElementById('mail-select-all').addEventListener('change', e => {
      MAIL.selected = e.target.checked ? new Set(MAIL.threads.map(t => t.threadId)) : new Set();
      renderMailList();
    });
    document.getElementById('mail-clear-sel').addEventListener('click', () => { MAIL.selected.clear(); renderMailList(); });
    return;
  }
  const parts = [];
  if (MAIL.folder === 'inbox' && MAIL.boot.settings.splitInbox && !MAIL.q) {
    const c = MAIL.boot.counts;
    const tab = (key, label, count) => `<button class="fl-filter-btn${MAIL.tab === key ? ' active' : ''}" data-tab="${key}" aria-pressed="${MAIL.tab === key}">${label}${count ? ` <span class="mail-tab-n">${count}</span>` : ''}</button>`;
    parts.push(`<div class="mail-tabs" role="group" aria-label="Inbox sections">${tab('important', 'Important', c.inboxImportant)}${tab('other', 'Other', c.inboxOther)}</div>`);
  }
  if (MAIL.q) parts.push(`<span class="mail-search-note">Results for <b>${esc(MAIL.q)}</b></span><button class="btn-link" id="mail-clear-search">Clear search</button>`);
  if ((MAIL.folder === 'trash' || MAIL.folder === 'junk') && MAIL.threads.length && !MAIL.q) {
    parts.push(`<span class="mail-subbar-spacer"></span><button class="btn-link" id="mail-empty-folder">Empty ${MAIL.folder === 'trash' ? 'Trash' : 'Spam'} now</button>`);
  }
  bar.innerHTML = parts.join('');
  bar.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
    MAIL.tab = b.dataset.tab;
    try { localStorage.setItem('mail-tab', MAIL.tab); } catch { /* per-viewer convenience only */ }
    loadMailThreads();
  }));
  document.getElementById('mail-clear-search')?.addEventListener('click', () => { MAIL.q = ''; document.getElementById('mail-search').value = ''; loadMailThreads(); });
  document.getElementById('mail-empty-folder')?.addEventListener('click', e => mailConfirmButton(e.currentTarget, 'Delete everything permanently?', async () => {
    const { deleted } = await mailApi('/empty/' + MAIL.folder, { method: 'POST' });
    mailToast(`${deleted} message${deleted === 1 ? '' : 's'} deleted`);
    await refreshMailCounts(); loadMailThreads();
  }));
}

// Replace a button with an inline "Are you sure? Yes / Cancel" (no browser dialogs).
function mailConfirmButton(btn, question, run) {
  const wrap = document.createElement('span');
  wrap.className = 'row-confirm';
  wrap.innerHTML = `<span class="row-confirm-label">${esc(question)}</span><button class="btn-ghost btn-sm mail-danger">Yes</button><button class="btn-link">Cancel</button>`;
  btn.replaceWith(wrap);
  const [yes, cancel] = wrap.querySelectorAll('button');
  yes.focus();
  cancel.addEventListener('click', () => wrap.replaceWith(btn));
  yes.addEventListener('click', async () => {
    yes.disabled = true;
    try { await run(); } catch (err) { mailToast(err.message, { error: true }); wrap.replaceWith(btn); }
  });
}

function mailEmptyState() {
  if (MAIL.q) return { icon: 'ph-magnifying-glass', title: 'No conversations match', text: 'Try fewer words, or operators like from:, to:, subject:, has:attachment, is:unread, label:, before:2026-01-31.' };
  const map = {
    inbox: MAIL.tab === 'other' && MAIL.boot.settings.splitInbox
      ? { icon: 'ph-newspaper', title: 'Nothing in Other', text: 'Newsletters, notifications and other bulk mail land here, away from people who write to you.' }
      : { icon: 'ph-check-circle', title: 'Inbox zero', text: 'New mail to ' + MAIL.boot.address + ' shows up here.' },
    starred: { icon: 'ph-star', title: 'No starred conversations', text: 'Star a conversation to keep it one click away.' },
    drafts: { icon: 'ph-file-dashed', title: 'No drafts', text: 'Unsent messages are saved here automatically while you write.' },
    sent: { icon: 'ph-paper-plane-tilt', title: 'Nothing sent yet', text: 'Mail you send from any of your addresses appears here.' },
    archive: { icon: 'ph-archive', title: 'Archive is empty', text: 'Archiving takes a conversation out of the inbox without deleting it.' },
    junk: { icon: 'ph-shield-check', title: 'No spam', text: 'Mail the spam filter catches waits here for 30 days.' },
    trash: { icon: 'ph-trash', title: 'Trash is empty', text: 'Deleted conversations stay here until you empty the trash.' },
  };
  if (MAIL.folder.startsWith('label:')) return { icon: 'ph-tag', title: 'No conversations with this label', text: 'Add labels from a conversation or with a filter in Mail Settings.' };
  return map[MAIL.folder] || { icon: 'ph-folder-simple', title: 'This folder is empty', text: 'Move conversations here from the inbox, or with a filter.' };
}

function renderMailList() {
  const list = document.getElementById('mail-list');
  renderMailSubbar();
  if (!MAIL.threads.length) {
    const e = mailEmptyState();
    list.innerHTML = `<div class="mail-empty"><i class="ph-bold ${e.icon}"></i><div class="mail-empty-title">${esc(e.title)}</div><p>${esc(e.text)}</p></div>`;
    return;
  }
  const more = MAIL.threads.length < MAIL.total;
  list.innerHTML = MAIL.threads.map(mailRowHTML).join('') +
    (more ? `<div class="mail-more"><button class="btn-ghost btn-sm" id="mail-more">Show more (${MAIL.total - MAIL.threads.length} older)</button></div>` : '');
  document.getElementById('mail-more')?.addEventListener('click', e => { e.currentTarget.disabled = true; loadMailThreads({ append: true }); });
}

function mailRowHTML(t) {
  const sel = MAIL.selected.has(t.threadId);
  const who = MAIL.folder === 'sent' || MAIL.folder === 'drafts' || MAIL.folder === 'scheduled'
    ? 'To: ' + (t.to.join(', ') || '(no recipients)')
    : (t.participants.join(', ') || '(unknown sender)');
  const chips = t.labels.map(k => mailLabel(k)).filter(Boolean).map(l => mailLabelChip(l)).join('');
  const flags = [
    t.draft ? '<span class="cur-badge cur-badge-danger">Draft</span>' : '',
    t.scheduledAt ? `<span class="cur-badge cur-badge-warning" title="Scheduled"><i class="ph-bold ph-clock"></i>${esc(fmtMailDateLong(t.scheduledAt))}</span>` : '',
  ].join('');
  const archivable = MAIL.folder === 'inbox';
  return `<div class="mail-row${t.unread ? ' unread' : ''}${sel ? ' selected' : ''}" data-tid="${esc(t.threadId)}">
    <label class="mail-check"><input type="checkbox" ${sel ? 'checked' : ''} aria-label="Select conversation"></label>
    <button class="mail-star${t.starred ? ' on' : ''}" aria-pressed="${t.starred}" aria-label="${t.starred ? 'Unstar' : 'Star'}"><i class="ph-bold ph-star"></i></button>
    <a class="mail-row-body" href="#mail-thread/${esc(encodeURIComponent(t.threadId))}">
      <div class="mail-row-top">
        <span class="mail-from">${esc(who)}${t.count > 1 ? `<span class="mail-n">${t.count}</span>` : ''}</span>
        ${t.hasAttachment ? '<i class="ph-bold ph-paperclip mail-clip" aria-label="Has attachment"></i>' : ''}
        <time class="mail-date" datetime="${esc(t.date)}">${esc(fmtMailDate(t.date))}</time>
      </div>
      <div class="mail-row-sub"><span class="mail-subject">${esc(t.subject)}</span><span class="mail-preview">${esc(t.preview)}</span></div>
      ${chips || flags ? `<div class="mail-row-tags">${flags}${chips}</div>` : ''}
    </a>
    <div class="row-actions mail-row-actions">
      ${archivable ? `<button class="row-btn" data-act="archive" title="Archive" aria-label="Archive"><i class="ph-bold ph-archive"></i></button>` : ''}
      ${MAIL.folder !== 'trash' ? `<button class="row-btn danger" data-act="trash" title="Move to Trash" aria-label="Move to Trash"><i class="ph-bold ph-trash"></i></button>` : ''}
      <button class="row-btn" data-act="${t.unread ? 'read' : 'unread'}" title="${t.unread ? 'Mark as read' : 'Mark as unread'}" aria-label="${t.unread ? 'Mark as read' : 'Mark as unread'}"><i class="ph-bold ${t.unread ? 'ph-envelope-open' : 'ph-envelope-simple'}"></i></button>
    </div>
  </div>`;
}

// ─── list interactions (delegated once) ───────────────────────────────────────
document.getElementById('mail-list').addEventListener('click', async e => {
  const row = e.target.closest('.mail-row[data-tid]');
  if (!row) return;
  const tid = row.dataset.tid;
  const t = MAIL.threads.find(x => x.threadId === tid);
  if (e.target.closest('.mail-check')) return; // handled by change
  const star = e.target.closest('.mail-star');
  const act = e.target.closest('[data-act]');
  const body = e.target.closest('.mail-row-body');
  if (star) {
    e.preventDefault();
    t.starred = !t.starred;
    star.classList.toggle('on', t.starred);
    star.setAttribute('aria-pressed', String(t.starred));
    try { await mailApi('/actions', { method: 'POST', body: { threadIds: [tid], action: t.starred ? 'star' : 'unstar', context: MAIL.folder } }); }
    catch (err) { t.starred = !t.starred; star.classList.toggle('on', t.starred); mailToast(err.message, { error: true }); }
  } else if (act) {
    e.preventDefault();
    await mailThreadAction([tid], act.dataset.act);
  } else if (body && t?.draft && t.count === 1 && MAIL.folder === 'drafts') {
    e.preventDefault();
    openComposer({ mode: 'draft', emailId: t.emailId });
  } else if (body && MAIL.folder === 'scheduled') {
    e.preventDefault();
  }
});

document.getElementById('mail-list').addEventListener('change', e => {
  const row = e.target.closest('.mail-row[data-tid]');
  if (!row || !e.target.matches('.mail-check input')) return;
  if (e.target.checked) MAIL.selected.add(row.dataset.tid); else MAIL.selected.delete(row.dataset.tid);
  row.classList.toggle('selected', e.target.checked);
  renderMailSubbar();
});

let _mailSearchTimer = null;
document.getElementById('mail-search').addEventListener('input', e => {
  clearTimeout(_mailSearchTimer);
  _mailSearchTimer = setTimeout(() => { MAIL.q = e.target.value.trim(); MAIL.selected.clear(); loadMailThreads(); }, 350);
});
document.getElementById('mail-search').addEventListener('keydown', e => {
  if (e.key === 'Enter') { clearTimeout(_mailSearchTimer); MAIL.q = e.target.value.trim(); MAIL.selected.clear(); loadMailThreads(); }
});
document.getElementById('mail-refresh').addEventListener('click', async e => {
  const b = e.currentTarget;
  b.disabled = true;
  await refreshMailCounts();
  await loadMailThreads();
  b.disabled = false;
});

// ─── actions ──────────────────────────────────────────────────────────────────
const MAIL_ACTION_DONE = {
  archive: 'Archived', trash: 'Moved to Trash', spam: 'Marked as spam', notspam: 'Moved to Inbox', inbox: 'Moved to Inbox',
  read: 'Marked as read', unread: 'Marked as unread', delete: 'Deleted forever', move: 'Moved', label: 'Label added', unlabel: 'Label removed',
  important: 'Moved to Important — future mail from this sender too', other: 'Moved to Other — future mail from this sender too',
};
const MAIL_UNDO = { archive: 'inbox', trash: 'inbox', spam: 'notspam', inbox: null, read: 'unread', unread: 'read', label: 'unlabel', unlabel: 'label' };
const MAIL_REMOVES_FROM_VIEW = new Set(['archive', 'trash', 'spam', 'notspam', 'delete', 'move', 'inbox', 'important', 'other']);

async function mailThreadAction(threadIds, action, extra = {}, { quiet = false } = {}) {
  try {
    await mailApi('/actions', { method: 'POST', body: { threadIds, action, context: MAIL.folder, ...extra } });
  } catch (err) { mailToast(err.message, { error: true }); return false; }
  const removes = MAIL_REMOVES_FROM_VIEW.has(action) && !(action === 'inbox' && MAIL.folder === 'inbox') && !(MAIL.folder === 'all' && action !== 'delete' && action !== 'trash' && action !== 'spam');
  MAIL.threads = MAIL.threads.flatMap(t => {
    if (!threadIds.includes(t.threadId)) return [t];
    if (removes || (action === 'unlabel' && MAIL.folder === 'label:' + extra.labelId)) return [];
    if (action === 'read') t.unread = false;
    if (action === 'unread') t.unread = true;
    if (action === 'label') { const l = mailLabel(extra.labelId); if (l && !t.labels.includes(l.keyword)) t.labels.push(l.keyword); }
    if (action === 'unlabel') { const l = mailLabel(extra.labelId); t.labels = t.labels.filter(k => k !== l?.keyword); }
    return [t];
  });
  MAIL.total -= removes ? threadIds.length : 0;
  threadIds.forEach(id => MAIL.selected.delete(id));
  if (_currentView === 'mail') renderMailList();
  refreshMailCounts();
  if (!quiet) {
    const undo = MAIL_UNDO[action];
    const n = threadIds.length;
    mailToast((n > 1 ? `${n} conversations: ` : '') + (MAIL_ACTION_DONE[action] || 'Done'), undo ? {
      actionLabel: 'Undo',
      onAction: async () => { await mailThreadAction(threadIds, undo, extra, { quiet: true }); if (_currentView === 'mail') loadMailThreads(); },
    } : {});
  }
  return true;
}

function mailBulk(action) {
  const ids = [...MAIL.selected];
  if (!ids.length) return;
  if (action === 'delete') {
    const btn = document.querySelector('[data-bulk="delete"]');
    return mailConfirmButton(btn, `Delete ${ids.length} permanently?`, () => mailThreadAction(ids, 'delete'));
  }
  mailThreadAction(ids, action);
}

function mailLabelMenu(anchor, threadIds, current = []) {
  const labels = MAIL.boot.labels;
  mailMenu(anchor, [
    ...labels.map(l => {
      const has = current.includes(l.keyword);
      return { label: l.name, color: MAIL_LABEL_COLORS[l.color], hint: has ? 'Remove' : '', run: () => mailThreadAction(threadIds, has ? 'unlabel' : 'label', { labelId: l.id }).then(() => _currentView === 'mail-thread' && showMailThread(MAIL.thread.threadId, { keepScroll: true })) };
    }),
    ...(labels.length ? [{ sep: true }] : []),
    { label: 'New label…', icon: 'ph-plus', run: () => navigate('mail-settings') },
  ]);
}

function mailMoveMenu(anchor, threadIds) {
  const f = MAIL.boot.folders;
  const custom = f.filter(x => !x.role).sort((a, b) => a.name.localeCompare(b.name));
  mailMenu(anchor, [
    { label: 'Inbox', icon: MAIL_ROLE_ICONS.inbox, run: () => mailThreadAction(threadIds, 'inbox') },
    { label: 'Archive', icon: MAIL_ROLE_ICONS.archive, run: () => mailThreadAction(threadIds, 'archive') },
    ...custom.map(x => ({ label: x.name, icon: 'ph-folder-simple', run: () => mailThreadAction(threadIds, 'move', { folderId: x.id }) })),
    { sep: true },
    { label: 'Spam', icon: MAIL_ROLE_ICONS.junk, run: () => mailThreadAction(threadIds, 'spam') },
    { label: 'Trash', icon: MAIL_ROLE_ICONS.trash, run: () => mailThreadAction(threadIds, 'trash') },
  ]);
}

// ─── scheduled + follow-ups (virtual folders) ─────────────────────────────────
async function renderMailScheduled(seq) {
  const list = document.getElementById('mail-list');
  list.innerHTML = mailSkeleton(3);
  try {
    const items = await mailApi('/scheduled');
    if (seq !== MAIL.listSeq) return;
    MAIL.threads = [];
    if (!items.length) {
      list.innerHTML = `<div class="mail-empty"><i class="ph-bold ph-clock"></i><div class="mail-empty-title">Nothing scheduled</div><p>Use the arrow next to Send to pick a later time. Scheduled mail waits on the server, so it goes out even when this page is closed.</p></div>`;
      return;
    }
    list.innerHTML = items.map(s => `<div class="mail-row mail-row-static" data-sub="${esc(s.id)}">
      <div class="mail-row-body">
        <div class="mail-row-top"><span class="mail-from">To: ${esc(s.to.join(', '))}</span><span class="cur-badge cur-badge-warning"><i class="ph-bold ph-clock"></i>${esc(fmtMailDateLong(s.sendAt))}</span></div>
        <div class="mail-row-sub"><span class="mail-subject">${esc(s.subject)}</span><span class="mail-preview">${esc(s.preview || '')}</span></div>
      </div>
      <div class="mail-row-end"><button class="btn-ghost btn-sm" data-cancel="${esc(s.id)}">Cancel send</button></div>
    </div>`).join('');
    list.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const { draftId } = await mailApi(`/submissions/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: 'POST' });
        mailToast('Unscheduled — moved to Drafts', { actionLabel: 'Edit', onAction: () => openComposer({ mode: 'draft', emailId: draftId }) });
        await refreshMailCounts(); loadMailThreads();
      } catch (err) { mailToast(err.message, { error: true }); b.disabled = false; }
    }));
  } catch (err) { if (seq === MAIL.listSeq) list.innerHTML = mailErrorHTML(err.message); }
}

async function renderMailFollowups(seq) {
  const list = document.getElementById('mail-list');
  list.innerHTML = mailSkeleton(3);
  try {
    const { due, upcoming } = await mailApi('/followups');
    if (seq !== MAIL.listSeq) return;
    MAIL.threads = [];
    const row = (f, isDue) => `<div class="mail-row mail-row-static${isDue ? ' unread' : ''}">
      <a class="mail-row-body" href="#mail-thread/${esc(encodeURIComponent(f.threadId))}">
        <div class="mail-row-top"><span class="mail-from">To: ${esc(f.recipients || '(no recipients)')}</span>
          <span class="cur-badge ${isDue ? 'cur-badge-warning' : 'cur-badge-neutral'}">${isDue ? 'No reply yet' : 'Remind ' + esc(fmtMailDate(f.dueAt))}</span></div>
        <div class="mail-row-sub"><span class="mail-subject">${esc(f.subject)}</span><span class="mail-preview">Sent ${esc(fmtMailDateLong(f.sentAt))}</span></div>
      </a>
      <div class="mail-row-end"><button class="btn-link" data-dismiss="${esc(String(f.id))}">${isDue ? 'Done' : 'Cancel reminder'}</button></div>
    </div>`;
    if (!due.length && !upcoming.length) {
      list.innerHTML = `<div class="mail-empty"><i class="ph-bold ph-bell-ringing"></i><div class="mail-empty-title">No follow-ups</div><p>When you send a message, choose "Remind me" and it comes back here if nobody replies in time.</p></div>`;
      return;
    }
    list.innerHTML = (due.length ? `<div class="act-month-hdr">Due now</div>${due.map(f => row(f, true)).join('')}` : '') +
      (upcoming.length ? `<div class="act-month-hdr">Waiting for a reply</div>${upcoming.map(f => row(f, false)).join('')}` : '');
    list.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await mailApi(`/followups/${b.dataset.dismiss}/dismiss`, { method: 'POST' }); await refreshMailCounts(); loadMailThreads(); }
      catch (err) { mailToast(err.message, { error: true }); b.disabled = false; }
    }));
  } catch (err) { if (seq === MAIL.listSeq) list.innerHTML = mailErrorHTML(err.message); }
}

// ─── thread reader ────────────────────────────────────────────────────────────
function mailInitials(a) {
  const s = (a?.name || a?.email || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

async function showMailThread(threadId, { keepScroll = false } = {}) {
  const scroller = document.getElementById('view-scroller');
  const prevScroll = scroller.scrollTop;
  const backTo = MAIL.folder === 'inbox' ? 'mail' : 'mail/' + MAIL.folder;
  showView('mail-thread', { back: backTo, title: '' });
  document.getElementById('back-label').textContent = MAIL.boot ? mailFolderTitle() : 'Mail';
  const el = document.getElementById('mail-thread');
  if (!keepScroll) el.innerHTML = '<div class="skel" style="height:28px;width:50%"></div><div class="skel" style="height:220px;margin-top:20px"></div>';
  try {
    if (!MAIL.boot) await loadMailBoot();
    const t = await mailApi('/threads/' + encodeURIComponent(decodeURIComponent(threadId)));
    MAIL.thread = t;
    renderMailThread(t);
    if (keepScroll) scroller.scrollTop = prevScroll;
    refreshMailCounts();
    const listed = MAIL.threads.find(x => x.threadId === t.threadId);
    if (listed) listed.unread = false;
  } catch (err) {
    el.innerHTML = mailErrorHTML(err.message);
  }
}

function mailBackToList() {
  const [view, id] = (document.getElementById('back-btn').dataset.back || 'mail').split('/');
  navigate(view, id);
}

function mailThreadContext(t) {
  const r = t.roles;
  const visible = t.messages.filter(m => !m.mailboxIds.includes(r.trash) || t.trashedCount === 0);
  const boxes = new Set(visible.flatMap(m => m.mailboxIds));
  return { visible, inInbox: boxes.has(r.inbox), inTrash: t.trashedCount === 0 && boxes.has(r.trash) && !boxes.has(r.inbox), inJunk: boxes.has(r.junk), onlyDrafts: visible.every(m => m.draft) };
}

function renderMailThread(t) {
  const el = document.getElementById('mail-thread');
  const ctx = mailThreadContext(t);
  const kws = new Set(ctx.visible.flatMap(m => m.keywords));
  const starred = kws.has('$flagged');
  const other = kws.has('$other');
  const labels = [...kws].map(k => mailLabel(k)).filter(Boolean);
  const btn = (act, icon, label, cls = '') => `<button class="btn-ghost btn-sm ${cls}" data-tact="${act}" title="${label}"><i class="ph-bold ${icon}"></i><span class="mail-hide-sm">${label}</span></button>`;
  const lastIdx = ctx.visible.length - 1;

  el.innerHTML = `
    <div class="mail-thread-hd">
      <h1 class="mail-thread-subject">${esc(t.subject)}</h1>
      ${labels.length ? `<div class="mail-thread-labels">${labels.map(l => mailLabelChip(l, true)).join('')}</div>` : ''}
    </div>
    <div class="mail-thread-actions" role="toolbar" aria-label="Conversation actions">
      ${ctx.inTrash || ctx.inJunk ? btn('inbox', 'ph-tray-arrow-up', 'Move to Inbox') : ctx.inInbox ? btn('archive', 'ph-archive', 'Archive') : btn('inbox', 'ph-tray-arrow-up', 'Move to Inbox')}
      ${ctx.inTrash ? btn('delete', 'ph-trash', 'Delete forever', 'mail-danger') : btn('trash', 'ph-trash', 'Trash')}
      ${ctx.inJunk ? btn('notspam', 'ph-shield-check', 'Not spam') : btn('spam', 'ph-warning-octagon', 'Spam')}
      ${btn('unread', 'ph-envelope-simple', 'Mark unread')}
      <button class="btn-ghost btn-sm mail-star-btn${starred ? ' on' : ''}" data-tact="${starred ? 'unstar' : 'star'}" aria-pressed="${starred}" title="${starred ? 'Unstar' : 'Star'}"><i class="ph-bold ph-star"></i><span class="mail-hide-sm">${starred ? 'Starred' : 'Star'}</span></button>
      <button class="btn-ghost btn-sm" data-tmenu="label"><i class="ph-bold ph-tag"></i><span class="mail-hide-sm">Label</span></button>
      <button class="btn-ghost btn-sm" data-tmenu="move"><i class="ph-bold ph-folder-simple-dashed"></i><span class="mail-hide-sm">Move</span></button>
      ${ctx.inInbox && MAIL.boot.settings.splitInbox ? (other ? btn('important', 'ph-arrow-circle-up', 'Move to Important') : btn('other', 'ph-arrow-circle-down', 'Move to Other')) : ''}
    </div>
    ${t.trashedCount ? `<div class="mail-note"><i class="ph-bold ph-trash"></i>${t.trashedCount} message${t.trashedCount === 1 ? '' : 's'} in this conversation ${t.trashedCount === 1 ? 'is' : 'are'} in Trash and hidden.</div>` : ''}
    <div class="mail-msgs">
      ${ctx.visible.map((m, i) => mailMessageHTML(m, i === lastIdx || m.unread || m.draft)).join('')}
    </div>
    ${ctx.onlyDrafts ? '' : `<div class="mail-reply-bar">
      <button class="btn-ghost" data-reply="reply"><i class="ph-bold ph-arrow-bend-up-left"></i>Reply</button>
      <button class="btn-ghost" data-reply="replyAll"><i class="ph-bold ph-arrow-bend-double-up-left"></i>Reply all</button>
      <button class="btn-ghost" data-reply="forward"><i class="ph-bold ph-arrow-bend-up-right"></i>Forward</button>
    </div>`}`;

  el.querySelectorAll('.mail-msg').forEach(a => { if (!a.classList.contains('collapsed')) mountMailBody(a); });

  el.querySelectorAll('[data-tact]').forEach(b => b.addEventListener('click', async () => {
    const act = b.dataset.tact;
    if (act === 'delete') return mailConfirmButton(b, 'Delete forever?', async () => { await mailThreadAction([t.threadId], 'delete'); mailBackToList(); });
    b.disabled = true;
    const ok = await mailThreadAction([t.threadId], act);
    if (!ok) { b.disabled = false; return; }
    // Leaving the inbox (or marking unread) finishes with the conversation, as in Gmail.
    if (['archive', 'trash', 'spam', 'unread'].includes(act)) return mailBackToList();
    showMailThread(t.threadId, { keepScroll: true });
  }));
  el.querySelector('[data-tmenu="label"]').addEventListener('click', e => mailLabelMenu(e.currentTarget, [t.threadId], [...kws]));
  el.querySelector('[data-tmenu="move"]').addEventListener('click', e => mailMoveMenu(e.currentTarget, [t.threadId]));
  el.querySelectorAll('[data-unlabel]').forEach(b => b.addEventListener('click', async () => {
    await mailThreadAction([t.threadId], 'unlabel', { labelId: b.dataset.unlabel }, { quiet: true });
    showMailThread(t.threadId, { keepScroll: true });
  }));
  el.querySelectorAll('[data-reply]').forEach(b => b.addEventListener('click', () => {
    const target = [...ctx.visible].reverse().find(m => !m.draft) || ctx.visible[lastIdx];
    openComposer({ mode: b.dataset.reply, emailId: target.id, threadId: t.threadId });
  }));
  el.querySelectorAll('.mail-msg-hd').forEach(hd => hd.addEventListener('click', e => {
    if (e.target.closest('button, a')) return;
    const art = hd.closest('.mail-msg');
    art.classList.toggle('collapsed');
    hd.setAttribute('aria-expanded', String(!art.classList.contains('collapsed')));
    if (!art.classList.contains('collapsed')) mountMailBody(art);
  }));
  el.querySelectorAll('[data-msg-menu]').forEach(b => b.addEventListener('click', e => {
    e.stopPropagation();
    const m = t.messages.find(x => x.id === b.dataset.msgMenu);
    mailMenu(b, [
      { label: 'Reply', icon: 'ph-arrow-bend-up-left', run: () => openComposer({ mode: 'reply', emailId: m.id, threadId: t.threadId }) },
      { label: 'Reply all', icon: 'ph-arrow-bend-double-up-left', run: () => openComposer({ mode: 'replyAll', emailId: m.id, threadId: t.threadId }) },
      { label: 'Forward', icon: 'ph-arrow-bend-up-right', run: () => openComposer({ mode: 'forward', emailId: m.id }) },
      { sep: true },
      { label: 'Mark unread from here', icon: 'ph-envelope-simple', run: async () => { await mailApi('/actions', { method: 'POST', body: { emailIds: [m.id], action: 'unread' } }); refreshMailCounts(); navigate('mail'); } },
      { label: 'Move this message to Trash', icon: 'ph-trash', run: async () => { await mailApi('/actions', { method: 'POST', body: { emailIds: [m.id], action: 'trash' } }); mailToast('Message moved to Trash'); showMailThread(t.threadId, { keepScroll: true }); } },
    ]);
  }));
  el.querySelectorAll('[data-edit-draft]').forEach(b => b.addEventListener('click', () => openComposer({ mode: 'draft', emailId: b.dataset.editDraft, threadId: t.threadId })));
  el.querySelectorAll('[data-cancel-sub]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const { draftId } = await mailApi(`/submissions/${encodeURIComponent(b.dataset.cancelSub)}/cancel`, { method: 'POST' });
      mailToast('Unscheduled — moved to Drafts');
      openComposer({ mode: 'draft', emailId: draftId, threadId: t.threadId });
      refreshMailCounts();
    } catch (err) { mailToast(err.message, { error: true }); b.disabled = false; }
  }));
}

function mailMessageHTML(m, expanded) {
  const mine = m.mine;
  const toLine = [...m.to, ...m.cc].map(a => fmtMailAddr(a)).join(', ');
  return `<article class="mail-msg${expanded ? '' : ' collapsed'}${m.draft ? ' draft' : ''}" data-mid="${esc(m.id)}">
    <header class="mail-msg-hd" aria-expanded="${expanded}">
      <span class="mail-avatar${mine ? ' mine' : ''}" aria-hidden="true">${esc(mailInitials(m.from))}</span>
      <div class="mail-msg-who">
        <div class="mail-msg-from">${esc(mine ? 'Me' : fmtMailAddr(m.from) || 'Unknown sender')}${m.from && !mine ? ` <span class="mail-msg-addr">&lt;${esc(m.from.email)}&gt;</span>` : ''}${m.draft ? ' <span class="cur-badge cur-badge-danger">Draft</span>' : ''}</div>
        <div class="mail-msg-to">${expanded ? 'to ' + esc(toLine || '(no recipients)') + (m.bcc.length ? ' · bcc ' + esc(m.bcc.map(fmtMailAddr).join(', ')) : '') : esc(m.preview)}</div>
      </div>
      <time class="mail-date" datetime="${esc(m.date)}" title="${esc(fmtMailDateLong(m.date))}">${esc(fmtMailDate(m.date))}</time>
      ${m.draft ? '' : `<button class="row-btn" data-msg-menu="${esc(m.id)}" aria-label="Message actions"><i class="ph-bold ph-dots-three"></i></button>`}
    </header>
    <div class="mail-msg-body">
      ${m.scheduledAt ? `<div class="mail-note warn"><i class="ph-bold ph-clock"></i>Scheduled to send ${esc(fmtMailDateLong(m.scheduledAt))}<button class="btn-link" data-cancel-sub="${esc(m.submissionId)}">Cancel and edit</button></div>` : ''}
      ${m.draft ? `<div class="mail-note"><i class="ph-bold ph-file-dashed"></i>Unsent draft<button class="btn-link" data-edit-draft="${esc(m.id)}">Continue editing</button></div>` : ''}
      ${m.hasRemoteContent && !m.remoteAllowed ? `<div class="mail-note" data-remote="${esc(m.id)}"><i class="ph-bold ph-image-broken"></i>Remote images are blocked so the sender can't see when you read this.<button class="btn-link" data-load-images>Load images</button>${m.from ? `<button class="btn-link" data-always-images="${esc(m.from.email)}">Always for ${esc(m.from.email)}</button>` : ''}</div>` : ''}
      <div class="mail-content"></div>
      ${m.attachments.length ? `<div class="mail-atts">${m.attachments.map(a => {
        const q = `name=${encodeURIComponent(a.name)}&type=${encodeURIComponent(a.type)}`;
        const img = /^image\/(png|jpe?g|gif|webp|avif)$/.test(a.type);
        return `<a class="mail-att" href="/api/mail/blobs/${encodeURIComponent(a.blobId)}?${q}" download="${esc(a.name)}">
          ${img ? `<img src="/api/mail/blobs/${encodeURIComponent(a.blobId)}?${q}&inline=1" alt="" loading="lazy">` : `<i class="ph-bold ${a.type === 'application/pdf' ? 'ph-file-pdf' : 'ph-file'}"></i>`}
          <span class="mail-att-name">${esc(a.name)}</span><span class="mail-att-size">${esc(fmtBytes(a.size))}</span></a>`;
      }).join('')}</div>` : ''}
      ${m.listUnsubscribe && !mine ? `<div class="mail-unsub"><a href="${esc(m.listUnsubscribe)}" target="_blank" rel="noopener noreferrer">Unsubscribe from this sender</a></div>` : ''}
    </div>
  </article>`;
}

// Render a message body once its card is expanded: HTML in a sandboxed,
// script-less iframe sized to its content; plain text inline.
function mountMailBody(article) {
  const box = article.querySelector('.mail-content');
  if (!box || box.dataset.mounted) return;
  box.dataset.mounted = '1';
  const m = MAIL.thread.messages.find(x => x.id === article.dataset.mid);
  if (m.viewerHtml) mailFrame(box, m.viewerHtml);
  else box.innerHTML = `<div class="mail-text">${mailLinkify(m.text || '')}</div>`;

  article.querySelector('[data-load-images]')?.addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try {
      const { viewerHtml } = await mailApi(`/emails/${encodeURIComponent(m.id)}/view`);
      m.viewerHtml = viewerHtml; box.innerHTML = ''; mailFrame(box, viewerHtml);
      article.querySelector('[data-remote]')?.remove();
    } catch (err) { mailToast(err.message, { error: true }); e.currentTarget.disabled = false; }
  });
  article.querySelector('[data-always-images]')?.addEventListener('click', async e => {
    const sender = e.currentTarget.dataset.alwaysImages;
    try {
      await mailApi('/senders/' + encodeURIComponent(sender), { method: 'PUT', body: { loadImages: true } });
      article.querySelector('[data-load-images]')?.click();
      mailToast(`Images from ${sender} will load automatically`);
    } catch (err) { mailToast(err.message, { error: true }); }
  });
}

function mailFrame(box, doc) {
  const f = document.createElement('iframe');
  f.className = 'mail-frame';
  f.title = 'Message';
  // allow-same-origin (without allow-scripts) only lets this page measure the
  // content height; the message itself can't run code, submit forms or navigate us.
  f.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.srcdoc = doc;
  const fit = () => {
    try {
      const d = f.contentDocument;
      if (d?.documentElement) f.style.height = Math.min(20000, d.documentElement.scrollHeight + 2) + 'px';
    } catch { /* cross-origin: keep default height */ }
  };
  f.addEventListener('load', () => {
    fit();
    try { new ResizeObserver(fit).observe(f.contentDocument.body); } catch { /* old browsers: one-shot size */ }
  });
  box.appendChild(f);
}

function mailLinkify(text) {
  return esc(text).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

// ─── sidebar badge at startup ─────────────────────────────────────────────────
function loadMailBadge() {
  loadMailBoot().catch(() => {});
}
