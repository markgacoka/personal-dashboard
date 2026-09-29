'use strict';

// ─── view / router ────────────────────────────────────────────────────────────
function showView(viewId, opts = {}) {
  _currentView = viewId;
  if (viewId !== 'flight-detail') _currentFlightId = null;
  if (viewId !== 'activity-detail') _currentActivityId = null;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = document.getElementById('view-' + viewId);
  if (el) el.classList.add('active');

  const sidebarKey = { 'activity-detail': 'activities', 'flight-detail': 'logbook', 'fin-accounts': 'fin-accounts', 'mail-thread': 'mail' }[viewId] || viewId;
  // log-flight is its own sidebar item — keep active highlight on it
  document.querySelectorAll('.sb-item').forEach(n => n.classList.remove('active'));
  document.querySelectorAll(`.sb-item[data-view="${sidebarKey}"]`).forEach(n => n.classList.add('active'));

  const backBtn  = document.getElementById('back-btn');
  const backSep  = document.getElementById('back-sep');
  const backLbl  = document.getElementById('back-label');
  const topTitle = document.getElementById('topbar-title');

  if (opts.back) {
    backBtn.style.display = 'flex';
    backSep.style.display = 'block';
    backBtn.dataset.back  = opts.back;
    backLbl.textContent   = VIEW_TITLES[opts.back] || opts.back;
  } else {
    backBtn.style.display = 'none';
    backSep.style.display = 'none';
  }

  topTitle.textContent = opts.title || VIEW_TITLES[viewId] || '';
  document.getElementById('view-scroller').scrollTop = 0;
  if (!opts.back) localStorage.setItem('dash-view', viewId);
}

document.getElementById('back-btn').addEventListener('click', () => {
  const dest = document.getElementById('back-btn').dataset.back || 'overview';
  navigate(dest);
});

function navigate(view, id) {
  const hash = id ? `#${view}/${id}` : `#${view}`;
  history.pushState(null, '', hash);
  route(view, id);
}

function route(view, id) {
  if (!view) {
    const saved = localStorage.getItem('dash-view') || 'overview';
    const raw = location.hash.slice(1) || (saved === 'trends' ? 'overview' : saved);
    const [v, i] = raw.split('/');
    view = v; id = i;
  }
  switch (view) {
    case 'activities':
      showView('activities', { title: 'Activities' });
      break;
    case 'sleep':
      showView('sleep', { title: 'Sleep' });
      renderSleepView();
      break;
    case 'activity':
      if (id) showActivityDetail(id);
      else showView('activities', { title: 'Activities' });
      break;
    case 'logbook':
      showView('logbook', { title: 'Logbook' });
      break;
    case 'flight':
      if (id) showFlightDetail(id);
      else showView('logbook', { title: 'Logbook' });
      break;
    case 'log-flight':
      showLogFlightView(id);
      break;
    case 'finances':
      showView('finances', { title: 'Finances' });
      loadFinanceDashboard();
      break;
    case 'fin-accounts':
      showView('fin-accounts', { title: 'Linked Accounts' });
      loadFinanceAccounts();
      break;
    case 'certificates':
      showView('certificates', { title: 'Pilot Credentials' });
      renderCertificates();
      break;
    case 'chess':
      showView('chess', { title: 'Chess Progress' });
      renderChessView();
      break;
    case 'account':
      showView('account', { title: 'Account' });
      renderAccountView();
      break;
    case 'mail':
      showView('mail', { title: 'Mail' });
      showMailFolder(id);
      break;
    case 'mail-thread':
      if (id) showMailThread(id);
      else navigate('mail');
      break;
    case 'mail-settings':
      showView('mail-settings', { title: 'Mail Settings' });
      renderMailSettings(id);
      break;
    default:
      showView('overview', { title: 'Overview' });
      // Re-fetch net worth every time Overview is shown, not just at boot —
      // otherwise this widget can sit stale after a sync done from the
      // Finances page while the visitor wasn't looking at Overview.
      loadFinanceOverview().catch(() => {});
  }
}

window.addEventListener('popstate', () => route());

// ─── sidebar wiring ───────────────────────────────────────────────────────────
document.getElementById('account-btn').addEventListener('click', () => navigate('account'));

document.querySelectorAll('.sb-item').forEach(item => {
  item.addEventListener('click', () => navigate(item.dataset.view));
});

['fitness','flights','finances','chess','mail','dev'].forEach(grp => {
  const hdr   = document.getElementById('sbh-' + grp);
  const items = document.getElementById('sbi-' + grp);
  if (!hdr||!items) return;
  hdr.addEventListener('click', () => {
    hdr.classList.toggle('closed');
    items.classList.toggle('closed');
  });
});

const sidebar = document.getElementById('sidebar');
if (localStorage.getItem('dash-sidebar') === 'collapsed') sidebar.classList.add('collapsed');
document.getElementById('sb-toggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('dash-sidebar', sidebar.classList.contains('collapsed') ? 'collapsed' : 'expanded');
});
