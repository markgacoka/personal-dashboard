'use strict';

// ─── logbook ──────────────────────────────────────────────────────────────────
function renderLogbookStats(s) {
  const h   = v => parseFloat(v||0) > 0 ? parseFloat(v).toFixed(1)+'h' : '—';
  const hc  = (v, clr) => parseFloat(v||0) > 0 ? clr : 'var(--faint)';
  const sub = (v, label) => parseFloat(v||0) > 0 ? `${parseFloat(v).toFixed(1)}h ${label}` : '&nbsp;';
  const statsEl = document.getElementById('logbook-stats');
  // Clear the skeleton's fixed placeholder height — it never got removed,
  // which silently capped the real content's height regardless of padding.
  statsEl.classList.remove('skel');
  statsEl.style.height = '';
  statsEl.innerHTML = `
    <div class="dp">
      <span class="dp-n">${h(s.total_hours)}</span>
      <span class="dp-u">Total time</span>
      <span class="dp-s">${s.total_flights||0} flight${s.total_flights!==1?'s':''} · ${s.total_takeoffs||0} T/O</span>
    </div>
    <div class="dp-div"></div>
    <div class="dp">
      <span class="dp-n" style="color:${hc(s.dual_received,'#5db87c')}">${h(s.dual_received)}</span>
      <span class="dp-u">Dual rcvd</span>
      <span class="dp-s">${sub(s.dual_given,'given')}</span>
    </div>
    <div class="dp-div"></div>
    <div class="dp">
      <span class="dp-n" style="color:${hc(s.solo,'#c99c3a')}">${h(s.solo)}</span>
      <span class="dp-u">Solo</span>
      <span class="dp-s">${parseFloat(s.pic||0) > parseFloat(s.solo||0) ? parseFloat(s.pic).toFixed(1)+'h PIC' : '&nbsp;'}</span>
    </div>
    <div class="dp-div"></div>
    <div class="dp">
      <span class="dp-n" style="color:${hc(s.cross_country,'#5a88c0')}">${h(s.cross_country)}</span>
      <span class="dp-u">X-country</span>
      <span class="dp-s">${s.airports_visited||0} airports</span>
    </div>
    <div class="dp-div"></div>
    <div class="dp">
      <span class="dp-n" style="color:${hc(s.night,'#9080c0')}">${h(s.night)}</span>
      <span class="dp-u">Night</span>
      <span class="dp-s">${s.night_landings > 0 ? s.night_landings+' ldg' : '&nbsp;'}</span>
    </div>
    <div class="dp-div"></div>
    <div class="dp">
      <span class="dp-n" style="color:${hc(s.actual_instrument,'var(--patina-text)')}">${h(s.actual_instrument)}</span>
      <span class="dp-u">Actual IFR</span>
      <span class="dp-s">${sub(s.simulated_instrument,'sim inst')}</span>
    </div>
  `;
  document.getElementById('fl-subtitle').textContent = `· ${s.total_hours}h · PPL training`;
}

const FL_PER_PAGE = 20;
let _flPage = 0;
let _flFilter = 'all';

function setFlFilter(filter) {
  _flFilter = filter;
  _flPage = 0;
  document.querySelectorAll('.fl-filter-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.filter === filter)
  );
  applyFlFilter();
}

function applyFlFilter() {
  let flights = window._flights || [];
  if (_flFilter === 'solo')  flights = flights.filter(f => (f.solo || 0) > 0 && !(f.dual_received > 0));
  if (_flFilter === 'dual')  flights = flights.filter(f => (f.dual_received || 0) > 0);
  if (_flFilter === 'night') flights = flights.filter(f => (f.night || 0) > 0);
  if (_flFilter === 'xc')    flights = flights.filter(f => (f.cross_country || 0) > 0);
  renderFlights(flights);
}

function flPageStep(dir) {
  const total = (window._flights || []).length;
  const pages = Math.ceil(total / FL_PER_PAGE);
  _flPage = Math.max(0, Math.min(pages - 1, _flPage + dir));
  renderFlights(window._flights || []);
}

function renderFlights(flights) {
  if (!flights.length) {
    document.getElementById('fl-list').innerHTML =
      '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No flights logged yet.</div>';
    const pg = document.getElementById('fl-pagination');
    if (pg) pg.style.display = 'none';
    return;
  }

  const total = flights.length;
  const pages = Math.ceil(total / FL_PER_PAGE);
  _flPage = Math.max(0, Math.min(pages - 1, _flPage));
  const page = flights.slice(_flPage * FL_PER_PAGE, (_flPage + 1) * FL_PER_PAGE);

  // Group by month, same pattern as the Activities list
  const groups = [];
  let lastKey = null;
  for (const f of page) {
    const key = calDateKey(f.date);
    const label = fmtCalDate(f.date, { month: 'long', year: 'numeric' });
    if (key !== lastKey) { groups.push({ label, rows: [] }); lastKey = key; }
    groups[groups.length - 1].rows.push(f);
  }

  document.getElementById('fl-list').innerHTML = groups.map(g =>
    `<div class="act-month-hdr">${g.label}</div>` + g.rows.map(f => {
    const color   = typeColor(f.training_type);
    const id      = f.id;
    const soloTag = f.solo > 0 && !f.dual_given
      ? `<span class="badge" style="color:oklch(65% 0.15 350);border-color:oklch(65% 0.15 350)">solo</span>` : '';
    const trackTag = f.has_track
      ? `<span class="badge" style="color:var(--patina-text);border-color:var(--patina-text)"><i class="ph-bold ph-map-pin" style="font-size:9px"></i> route</span>` : '';
    const icaoStyle = 'color:var(--champagne);font-weight:600';
    return `<div class="fl-row" data-flid="${id}">
      <div class="fl-summary">
        <span class="fl-type-dot" style="background:${color}"></span>
        <div class="fl-info">
          <div class="fl-route">
            <span style="${icaoStyle}">${esc(routeLabel(f))}</span>
            <span class="badge" style="color:${color};border-color:${color}">${esc(typeLabel(f.training_type))}</span>
            ${soloTag}${trackTag}
          </div>
          <div class="fl-meta">${fmtCalDate(f.date, {year:'numeric',month:'short',day:'numeric'})} · <span style="color:var(--faint)">${esc(f.aircraft?.tail_number||'')} ${esc(f.aircraft?.make||'')} ${esc(f.aircraft?.model||'')}</span></div>
        </div>
        <div class="fl-kpis">
          <div class="fl-kpi">
            <div class="fl-kpi-v">${fmtHrs(f.total_duration)}</div>
            <div class="fl-kpi-l">duration</div>
          </div>
          ${f.takeoffs > 0 ? `<div class="fl-kpi">
            <div class="fl-kpi-v">${f.takeoffs}/${f.landings}</div>
            <div class="fl-kpi-l">T/O · Lnd</div>
          </div>` : ''}
          ${f.cross_country > 0 && parseFloat(f.cross_country) < parseFloat(f.total_duration) * 0.95 ? `<div class="fl-kpi">
            <div class="fl-kpi-v" style="color:#5a88c0">${fmtHrs(f.cross_country)}</div>
            <div class="fl-kpi-l">x-country</div>
          </div>` : ''}
          ${f.dual_received > 0 ? `<div class="fl-kpi">
            <div class="fl-kpi-v" style="color:var(--patina-text)">${fmtHrs(f.dual_received)}</div>
            <div class="fl-kpi-l">dual</div>
          </div>` : f.solo > 0 ? `<div class="fl-kpi">
            <div class="fl-kpi-v" style="color:#c99c3a">${fmtHrs(f.solo)}</div>
            <div class="fl-kpi-l">solo</div>
          </div>` : ''}
        </div>
        <div class="row-actions" id="ra-${id}">
          <button class="row-btn" title="Edit" onclick="event.stopPropagation();openFlightModal('${id}')">
            <i class="ph-bold ph-pencil-simple"></i>
          </button>
          <button class="row-btn danger" title="Delete" onclick="event.stopPropagation();rowConfirmDelete('${id}')">
            <i class="ph-bold ph-trash"></i>
          </button>
        </div>
      </div>
    </div>`;
  }).join('')).join('');

  document.querySelectorAll('.fl-row').forEach(row => {
    row.addEventListener('click', () => navigate('flight', row.dataset.flid));
  });

  const pg = document.getElementById('fl-pagination');
  if (pg) {
    if (pages > 1) {
      pg.style.display = 'flex';
      document.getElementById('fl-page-label').textContent =
        `${_flPage * FL_PER_PAGE + 1}–${Math.min((_flPage + 1) * FL_PER_PAGE, total)} of ${total}`;
      document.getElementById('fl-prev').disabled = _flPage === 0;
      document.getElementById('fl-next').disabled = _flPage >= pages - 1;
    } else {
      pg.style.display = 'none';
    }
  }
}


// ─── load flights ─────────────────────────────────────────────────────────────
async function loadFlights() {
  const [statsRes, flightsRes] = await Promise.allSettled([
    fetch('/api/stats/logbook').then(r => r.ok ? r.json() : null),
    fetch('/api/flights').then(r => r.ok ? r.json() : []),
  ]);
  const stats   = statsRes.status   === 'fulfilled' ? statsRes.value   : null;
  const flights = flightsRes.status === 'fulfilled' ? flightsRes.value : [];

  if (stats) renderLogbookStats(stats);
  else {
    const el = document.getElementById('logbook-stats');
    el.classList.remove('skel'); el.style.height = '';
    el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:14px">Flight data unavailable</div>';
  }

  window._flights = Array.isArray(flights) ? flights : [];
  // _niceAirSchedules loaded lazily on first flight detail open — not on list load
  if (!window._niceAirSchedules) window._niceAirSchedules = [];
  applyFlFilter();
  renderFlightCurrency(window._flights);
}

// Fetch NICE AIR schedules once per session (lazy, on first flight detail open)
let _niceAirFetchPromise = null;
async function ensureNiceAirSchedules() {
  if (window._niceAirSchedules?.length) return;
  if (!_niceAirFetchPromise) {
    _niceAirFetchPromise = fetch('/api/gmail/nice-air')
      .then(r => r.ok ? r.json() : { schedules: [] })
      .catch(() => ({ schedules: [] }))
      .then(d => { window._niceAirSchedules = d.schedules || []; });
  }
  await _niceAirFetchPromise;
}
