'use strict';

// ─── flight detail page ───────────────────────────────────────────────────────
async function showFlightDetail(id) {
  const find = () => (window._flights||[]).find(f => String(f.id) === String(id));
  let f = find();
  // A deep link can arrive before the flight list has loaded.
  if (!f && window._flightsReady) { await window._flightsReady; f = find(); }
  if (!f) { navigate('logbook'); return; }

  const color = typeColor(f.training_type);

  showView('flight-detail', {
    back: 'logbook',
    title: routeLabel(f),
  });
  _currentFlightId = id;

  // All non-zero stats for the hero bar
  const heroStats = [
    { label:'Total',      val: parseFloat(f.total_duration||0).toFixed(1), unit:'h', color: 'var(--champagne)' },
    f.dual_received > 0 ? { label:'Dual Rcvd',  val: parseFloat(f.dual_received).toFixed(1),  unit:'h', color: TYPE_CFG.dual.color } : null,
    f.dual_given > 0    ? { label:'Dual Given',  val: parseFloat(f.dual_given).toFixed(1),     unit:'h', color: TYPE_CFG.dual.color } : null,
    f.pic > 0           ? { label:'PIC',         val: parseFloat(f.pic).toFixed(1),             unit:'h', color: TYPE_CFG.pattern.color } : null,
    f.solo > 0          ? { label:'Solo',        val: parseFloat(f.solo).toFixed(1),            unit:'h', color: TYPE_CFG.solo.color } : null,
    f.cross_country > 0 ? { label:'X-Country',  val: parseFloat(f.cross_country).toFixed(1),   unit:'h', color: TYPE_CFG['x-country'].color } : null,
    f.night > 0         ? { label:'Night',       val: parseFloat(f.night).toFixed(1),           unit:'h', color: TYPE_CFG.night.color } : null,
    f.actual_instrument > 0 ? { label:'Actual IFR', val: parseFloat(f.actual_instrument).toFixed(1), unit:'h', color: TYPE_CFG.instrument.color } : null,
    f.simulated_instrument > 0 ? { label:'Sim Inst', val: parseFloat(f.simulated_instrument).toFixed(1), unit:'h', color: TYPE_CFG.instrument.color } : null,
    f.day_takeoffs > 0  ? { label:'Day T/O',    val: String(f.day_takeoffs),   unit:'', color: 'var(--body-text)' } : null,
    f.day_landings_full_stop > 0 ? { label:'Day Ldg', val: String(f.day_landings_full_stop), unit:'', color: 'var(--body-text)' } : null,
    f.night_takeoffs > 0 ? { label:'Night T/O', val: String(f.night_takeoffs), unit:'', color: TYPE_CFG.night.color } : null,
    f.night_landings_full_stop > 0 ? { label:'Night Ldg', val: String(f.night_landings_full_stop), unit:'', color: TYPE_CFG.night.color } : null,
    f.holds > 0         ? { label:'Holds',      val: String(f.holds),          unit:'', color: TYPE_CFG['x-country'].color } : null,
    f.distance_nm       ? { label:'Distance',   val: Math.round(f.distance_nm)+' nm', unit:'', color: 'var(--muted)' } : null,
  ].filter(Boolean);

  const ac = f.aircraft;
  const acCardPlaceholder = ac ? `
    <div id="fd-ac-card" class="fd-ac-card">
      <div class="fd-ac-photo-wrap">
        <i class="ph-bold ph-airplane" style="font-size:28px;color:var(--disabled)"></i>
      </div>
      <div class="fd-ac-body">
        <div class="fd-ac-reg">${esc(ac.tail_number)}</div>
        <div class="fd-ac-name">${esc(ac.make||'')} ${esc(ac.model||'')}${ac.year ? ' · '+ac.year : ''}</div>
        <div style="display:flex;align-items:center;gap:5px;color:var(--faint);font-size:11px">
          <div class="spinner" style="width:10px;height:10px;border-width:2px;flex-shrink:0"></div>
          Loading…
        </div>
      </div>
    </div>` : `
    <div id="fd-ac-card" style="padding:20px;display:flex;align-items:center;justify-content:center;color:var(--disabled);font-size:12px">
      No aircraft on record
    </div>`;

  const longDate = fmtCalDate(f.date, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  document.getElementById('flight-detail-content').innerHTML = `

    <!-- ── Hero ─────────────────────────────────────────── -->
    <div class="fd-hero" style="--type-color:${color}">
      <div class="fd-hero-top">
        <div>
          <div class="fd-hero-chip" style="background:${color}1a;border:1px solid ${color}40;color:${color}">
            <i class="ph-bold ph-airplane" style="font-size:11px"></i>
            ${esc(typeLabel(f.training_type))}
            ${f.solo > 0 && !f.dual_given ? '· Solo' : ''}
          </div>
          <div class="fd-route-hero">${esc(routeLabel(f))}</div>
          <div class="fd-hero-meta">
            <span>${esc(longDate)}</span>
            ${ac ? `<span class="fd-hero-meta-sep">·</span><span style="color:var(--patina-text)">${esc(ac.tail_number)}</span><span class="fd-hero-meta-sep">·</span><span>${esc(ac.make)} ${esc(ac.model)}</span>` : ''}
            ${f.instructor_name ? `<span class="fd-hero-meta-sep">·</span><span>${esc(f.instructor_name)}</span>` : ''}
          </div>
        </div>
        <div class="fd-hero-actions">
          <button class="btn-ghost btn-sm" onclick="openFlightModal(${f.id})">
            <i class="ph-bold ph-pencil-simple"></i> Edit
          </button>
          <button class="btn-ghost btn-sm" onclick="confirmDeleteFlight(${f.id})" style="color:var(--warn)">
            <i class="ph-bold ph-trash"></i>
          </button>
        </div>
      </div>
      <div class="fd-hero-stats-bar">
        ${heroStats.map(k => `<div class="fd-hstat">
          <div class="fd-hstat-label">${k.label}</div>
          <div class="fd-hstat-val" style="color:${k.color}">${k.val}${k.unit ? `<span class="fd-hstat-unit">${k.unit}</span>` : ''}</div>
        </div>`).join('')}
      </div>
    </div>

    <!-- ── Map + Sidebar ─────────────────────────────────── -->
    <div class="fd-main-grid">
      <div id="fd-map-container"><div id="fd-map"></div></div>
      <div class="fd-sidebar">
        ${acCardPlaceholder}
        <div id="fd-schedule-wrap"></div>
      </div>
    </div>

    <!-- ── Track auto-fetch status (shown while fetching or when no track) -->
    ${!f.has_track ? `<div id="fd-track-fetch-status" style="margin-bottom:12px"></div>` : ''}

    <!-- ── Track Scrubber ────────────────────────────────── -->
    ${f.has_track ? `<div id="fd-scrubber-wrap" style="display:none;margin-bottom:16px;border:1px solid var(--rule);border-radius:var(--r-md);overflow:hidden;background:var(--deep)">
      <div style="position:relative;background:var(--deep)">
        <canvas id="fd-elev-chart" style="display:block;width:100%;height:160px;cursor:crosshair;touch-action:none"></canvas>
        <div id="fd-scrubber-info" style="position:absolute;top:8px;left:50px;right:10px;display:flex;gap:5px;flex-wrap:wrap;pointer-events:none"></div>
      </div>
      <div style="display:flex;align-items:center;gap:5px;padding:6px 10px;background:var(--raised);border-top:1px solid var(--rule)">
        <button id="fd-skip-start-btn" title="Skip to start" style="width:26px;height:26px;flex-shrink:0;border-radius:50%;border:1px solid var(--rule);background:var(--graphite);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i class="ph-bold ph-skip-back" style="font-size:11px"></i>
        </button>
        <button id="fd-play-btn" title="Play" style="width:28px;height:28px;flex-shrink:0;border-radius:50%;border:1px solid var(--rule);background:var(--graphite);color:var(--champagne);cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i class="ph-bold ph-play" id="fd-play-icon" style="font-size:12px"></i>
        </button>
        <button id="fd-skip-end-btn" title="Skip to end" style="width:26px;height:26px;flex-shrink:0;border-radius:50%;border:1px solid var(--rule);background:var(--graphite);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center">
          <i class="ph-bold ph-skip-forward" style="font-size:11px"></i>
        </button>
        <span id="fd-time-start" style="font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap;margin-left:2px"></span>
        <div style="flex:1"></div>
        <span id="fd-time-end" style="font-size:10px;color:var(--faint);font-variant-numeric:tabular-nums;white-space:nowrap"></span>
        <select id="fd-speed-sel" title="Playback speed" style="margin-left:6px;background:var(--graphite);border:1px solid var(--rule);color:var(--muted);border-radius:4px;padding:2px 4px;font-size:10px;cursor:pointer;outline:none">
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
          <option value="8">8×</option>
        </select>
      </div>
    </div>` : ''}

    <!-- ── GPS Stats ─────────────────────────────────────── -->
    ${f.has_track ? `<div id="fd-track-stats" style="margin-bottom:12px;display:flex;flex-wrap:wrap;gap:8px;min-height:28px">
      <span style="font-size:11px;color:var(--faint)">Loading GPS stats…</span>
    </div>` : ''}

    <!-- ── Details ───────────────────────────────────────── -->
    ${(f.flight_review||f.checkride||f.ipc||f.approaches?.length||f.remarks||f.instructor_comments) ? `
    <div style="margin-bottom:20px">
      ${(f.flight_review||f.checkride||f.ipc) ? `
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${f.flight_review ? `<span class="type-badge" style="color:${TYPE_CFG.night.color};border-color:${TYPE_CFG.night.color}">Flight Review</span>` : ''}
        ${f.checkride     ? `<span class="type-badge" style="color:${TYPE_CFG.pattern.color};border-color:${TYPE_CFG.pattern.color}">Checkride</span>` : ''}
        ${f.ipc           ? `<span class="type-badge" style="color:${TYPE_CFG.dual.color};border-color:${TYPE_CFG.dual.color}">IPC</span>` : ''}
      </div>` : ''}

      ${(f.approaches&&f.approaches.length) ? `
      <div style="margin-bottom:14px">
        <div class="section-label" style="margin-bottom:8px">Approaches</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${f.approaches.map(ap => `<span class="approach-tag">
            ${esc(ap.approach_type)} ${ap.runway?'Rwy '+esc(ap.runway):''} ${esc(ap.airport_icao||'')}${ap.circle_to_land?' C/L':''}
          </span>`).join('')}
        </div>
      </div>` : ''}

      ${f.remarks ? `
      <div style="border-left:3px solid var(--patina-text);padding:10px 14px;background:var(--raised);border-radius:0 var(--r-sm) var(--r-sm) 0;margin-bottom:8px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin-bottom:4px">Remarks</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6">${esc(f.remarks)}</div>
      </div>` : ''}

      ${f.instructor_comments ? `
      <div style="border-left:3px solid ${TYPE_CFG.dual.color};padding:10px 14px;background:var(--raised);border-radius:0 var(--r-sm) var(--r-sm) 0">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--faint);margin-bottom:4px">Instructor Comments</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.6">${esc(f.instructor_comments)}</div>
      </div>` : ''}
    </div>` : ''}

    ${f.source && f.source !== 'manual' ? `<div style="font-size:11px;color:var(--faint)">Source: ${esc(f.source)}</div>` : ''}
    ${(f.hobbs_start&&f.hobbs_end)||(f.tach_start&&f.tach_end) ? `
    <div style="display:flex;gap:16px;font-size:11px;color:var(--faint);margin-top:8px">
      ${(f.hobbs_start&&f.hobbs_end) ? `<span>Hobbs ${f.hobbs_start} → ${f.hobbs_end}</span>` : ''}
      ${(f.tach_start&&f.tach_end)   ? `<span>Tach ${f.tach_start} → ${f.tach_end}</span>`   : ''}
    </div>` : ''}
  `;

  if (_fdMap) { try { _fdMap.remove(); } catch(_) {} _fdMap = null; }
  requestAnimationFrame(() => initFlightDetailMap(f));

  // Populate NICE AIR schedule card (lazy-loads Gmail data on first open)
  const fdSchedWrap = document.getElementById('fd-schedule-wrap');
  if (fdSchedWrap) {
    ensureNiceAirSchedules().then(() => {
    const dateStr  = String(f.date).slice(0, 10);
    const tail     = f.aircraft?.tail_number || '';
    const tailShort = tail.replace(/^N/, '');
    const schedules = window._niceAirSchedules || [];
    const sched = schedules
      .filter(s => s.date_str === dateStr &&
        (s.tail === tail || s.tail === tailShort || s.tail.replace(/^N/, '') === tailShort))
      .filter(s => s.type !== 'cancelled')
      .sort((a, b) => (b.received || '').localeCompare(a.received || ''))[0] || null;

    if (!sched) {
      fdSchedWrap.innerHTML = `<div style="border-top:1px solid var(--rule);padding:9px 14px;display:flex;align-items:center;gap:7px">
        <i class="ph-bold ph-envelope" style="color:var(--disabled);font-size:12px"></i>
        <span style="font-size:11px;color:var(--faint)">No NICE AIR schedule on record for this flight</span>
      </div>`;
    } else {
    const schedOut = (sched.start_local || '').replace(/^\d+\/\d+\/\d+\s+/, '') || '—';
      const schedIn  = (sched.end_local   || '').replace(/^\d+\/\d+\/\d+\s+/, '') || '—';
      const fmtLocal = iso => iso ? new Date(iso).toLocaleTimeString('en-US',
        { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Los_Angeles' }) : null;
      const actualOut = fmtLocal(f.time_out);
      const actualIn  = fmtLocal(f.time_in);
      fdSchedWrap.innerHTML = `
        <div style="border-top:1px solid oklch(38% 0 0/0.25)">
          <div style="background:oklch(45% 0.1 188/0.1);padding:8px 14px;display:flex;align-items:center;gap:7px;border-bottom:1px solid oklch(38% 0 0/0.2)">
            <i class="ph-bold ph-envelope-open" style="color:var(--patina-text);font-size:12px"></i>
            <span style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:var(--patina-text)">NICE AIR</span>
          </div>
          <div class="fd-ac-body">
            <div class="fd-ac-specs">
              ${sched.cfi ? `<div style="grid-column:1/-1">
                <div class="fd-ac-spec-label">CFI</div>
                <div class="fd-ac-spec-val">${esc(sched.cfi)}</div>
              </div>` : ''}
              <div>
                <div class="fd-ac-spec-label">Sched Out</div>
                <div class="fd-ac-spec-val">${esc(schedOut)}</div>
              </div>
              <div>
                <div class="fd-ac-spec-label">Sched In</div>
                <div class="fd-ac-spec-val">${esc(schedIn)}</div>
              </div>
              ${actualOut ? `<div>
                <div class="fd-ac-spec-label">Block Out</div>
                <div class="fd-ac-spec-val" style="color:var(--patina-text)">${esc(actualOut)}</div>
              </div>` : ''}
              ${actualIn ? `<div>
                <div class="fd-ac-spec-label">Block In</div>
                <div class="fd-ac-spec-val" style="color:var(--patina-text)">${esc(actualIn)}</div>
              </div>` : ''}
            </div>
            ${sched.type === 'changed' ? `<div style="margin-top:8px;font-size:10px;color:oklch(80% 0.17 85)"><i class="ph-bold ph-warning"></i> Modified schedule.</div>` : ''}
          </div>
        </div>`;
    } // end if (sched) else
    }); // end ensureNiceAirSchedules().then
  }

  // Load comprehensive aircraft data and render full card
  if (ac?.tail_number) {
    fetch('/api/external/aircraft/' + encodeURIComponent(ac.tail_number.replace(/^N/i, '')))
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const card = document.getElementById('fd-ac-card');
        if (!card) return;

        const photoUrl = d?.photo_url || null;
        const photoHtml = photoUrl
          ? `<div class="fd-ac-photo-wrap">
               <img src="${esc(photoUrl)}" alt="${esc(ac.tail_number)}"
                 onerror="this.parentElement.innerHTML='<i class=\\'ph-bold ph-airplane\\' style=\\'font-size:32px;color:var(--disabled)\\'></i>'">
               ${d?.owner ? `<div class="fd-ac-photo-credit">${esc(d.owner)}</div>` : ''}
             </div>`
          : `<div class="fd-ac-photo-wrap">
               <i class="ph-bold ph-airplane" style="font-size:32px;color:var(--disabled)"></i>
             </div>`;

        const make  = d?.make  || ac.make  || '';
        const model = d?.model || ac.model || '';
        const year  = d?.year  || ac.year  || null;
        const specRows = [
          d?.serial       ? ['Serial',    d.serial]                                  : null,
          d?.engine_type  ? ['Engine',    d.engine_type + (d.engine_hp ? ' · ' + d.engine_hp + ' HP' : '')] : null,
          d?.category     ? ['Category',  d.category + (d.aircraft_class ? ' / ' + d.aircraft_class : '')] : null,
          d?.gear_type    ? ['Gear',      d.gear_type.replace(/_/g, ' ')]            : null,
          d?.seats        ? ['Seats',     String(d.seats)]                           : null,
          d?.is_complex   ? ['Complex',   'Yes']                                     : null,
          d?.status       ? ['Status',    d.status]                                  : null,
          d?.mode_s_hex   ? ['Mode S',    d.mode_s_hex.toUpperCase()]               : null,
        ].filter(Boolean);

        const p = d?.performance;
        const perfRows = p ? [
          ['MTOW',    p.mtow_lbs ? p.mtow_lbs.toLocaleString() + ' lbs' : null],
          ['Cruise',  p.cruise_ktas ? p.cruise_ktas + ' ktas' : null],
          ['Ceiling', p.service_ceiling_ft ? (p.service_ceiling_ft/1000).toFixed(0) + ',000 ft' : null],
          ['Range',   p.range_nm ? p.range_nm + ' nm' : null],
          ['Fuel',    p.fuel_gal ? p.fuel_gal + ' gal' : null],
          ['Burn',    p.fuel_burn_gph ? p.fuel_burn_gph + ' gph' : null],
          ['Vne',     p.vne_kts ? p.vne_kts + ' kts' : null],
          ['Vno',     p.vno_kts ? p.vno_kts + ' kts' : null],
          ['Vx',      p.vx_kts  ? p.vx_kts  + ' kts' : null],
          ['Vy',      p.vy_kts  ? p.vy_kts  + ' kts' : null],
          ['Vs0',     p.vs0_kts ? p.vs0_kts + ' kts' : null],
          ['Vs1',     p.vs1_kts ? p.vs1_kts + ' kts' : null],
          ['Va',      p.va_kts  ? p.va_kts  + ' kts' : null],
        ].filter(([,v]) => v) : [];

        card.innerHTML = `
          ${photoHtml}
          <div class="fd-ac-body">
            <div class="fd-ac-reg">${esc(ac.tail_number)}</div>
            <div class="fd-ac-name">${esc(make)} ${esc(model)}${year ? ' · ' + year : ''}</div>
            ${specRows.length ? `<div class="fd-ac-specs">
              ${specRows.map(([k,v]) => `<div>
                <div class="fd-ac-spec-label">${esc(k)}</div>
                <div class="fd-ac-spec-val">${esc(String(v))}</div>
              </div>`).join('')}
            </div>` : ''}
            ${perfRows.length ? `<div class="fd-perf-section">
              <div class="fd-perf-label">Performance (POH reference)</div>
              <div class="fd-perf-grid">
                ${perfRows.map(([k,v]) => `<div class="fd-perf-item">
                  <div class="fd-pk">${esc(k)}</div>
                  <div class="fd-pv">${esc(v)}</div>
                </div>`).join('')}
              </div>
            </div>` : ''}
          </div>`;
      }).catch(() => {
        const card = document.getElementById('fd-ac-card');
        if (!card) return;
        // On fetch failure, fall back to basic info from flight record
        card.innerHTML = `
          <div class="fd-ac-photo-wrap">
            <i class="ph-bold ph-airplane" style="font-size:32px;color:var(--disabled)"></i>
          </div>
          <div class="fd-ac-body">
            <div class="fd-ac-reg">${esc(ac.tail_number)}</div>
            <div class="fd-ac-name">${esc(ac.make||'')} ${esc(ac.model||'')}${ac.year ? ' · '+ac.year : ''}</div>
            ${ac.engine_type ? `<div class="fd-ac-specs"><div>
              <div class="fd-ac-spec-label">Engine</div>
              <div class="fd-ac-spec-val">${esc(ac.engine_type)}${ac.engine_hp ? ' · '+ac.engine_hp+' HP' : ''}</div>
            </div></div>` : ''}
          </div>`;
      });
  }

  // Populate GPS track stats
  if (f.has_track) {
    fetch('/api/flights/' + f.id + '/track-stats')
      .then(r => r.ok ? r.json() : null)
      .then(s => {
        const el = document.getElementById('fd-track-stats');
        if (!el || !s) return;
        const chips = [
          s.max_altitude_ft  ? { label: 'Peak Alt',    val: s.max_altitude_ft.toLocaleString() + ' ft' } : null,
          s.distance_nm      ? { label: 'GPS Dist',    val: s.distance_nm.toFixed(1) + ' nm' }           : null,
          s.max_groundspeed_kts ? { label: 'Max GS',   val: s.max_groundspeed_kts + ' kts' }             : null,
          s.avg_groundspeed_kts ? { label: 'Avg GS',   val: s.avg_groundspeed_kts + ' kts' }             : null,
          s.max_climb_fpm > 50  ? { label: 'Peak Climb', val: '+' + s.max_climb_fpm.toLocaleString() + ' fpm' } : null,
          s.max_descent_fpm < -50 ? { label: 'Peak Desc', val: s.max_descent_fpm.toLocaleString() + ' fpm' }   : null,
          s.track_points     ? { label: 'Track Pts',   val: String(s.track_points) }                     : null,
        ].filter(Boolean);
        if (!chips.length) { el.remove(); return; }
        el.innerHTML = chips.map(c => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:var(--raised);border:1px solid var(--rule);border-radius:var(--r-sm);font-size:11px">
          <span style="color:var(--faint)">${c.label}</span>
          <span style="color:var(--champagne);font-weight:600;font-variant-numeric:tabular-nums">${c.val}</span>
        </span>`).join('');
      }).catch(() => {
        const el = document.getElementById('fd-track-stats');
        if (el) el.remove();
      });
  }

  // Auto-fetch GPS track from FR24 for any flight that has none yet
  if (!f.has_track) {
    autoLoadTrack(f);
  }
}

// ─── FR24 auto-track loader ───────────────────────────────────────────────────
// Silently fetches GPS track from FlightRadar24 when a flight has no stored track.
// Uses time window from DB → Gmail schedule → FR24 summary scoring (by airport + duration).
// On success, re-renders the full flight detail so the scrubber appears automatically.
async function autoLoadTrack(f) {
  if (!f) return;
  const flightId = f.id;
  const skipKey  = `fr24-skip-${flightId}`;
  if (sessionStorage.getItem(skipKey)) return;

  const statusEl = document.getElementById('fd-track-fetch-status');
  if (statusEl) statusEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted)">
      <div class="spinner" style="width:10px;height:10px;border-width:2px;flex-shrink:0"></div>
      Fetching GPS track from FlightRadar24…
    </div>`;

  try {
    const res = await fetch(`/api/external/auto-fetch-fr24-track/${flightId}`, { method: 'POST' })
      .then(r => r.json()).catch(() => null);

    if (!res?.success || !res.points_saved) {
      sessionStorage.setItem(skipKey, '1');
      if (statusEl) statusEl.innerHTML = '<span style="font-size:11px;color:var(--faint)">No GPS track available</span>';
      return;
    }

    const fi = (window._flights || []).findIndex(x => String(x.id) === String(flightId));
    if (fi >= 0) window._flights[fi].has_track = true;

    // Re-render the full detail so the scrubber HTML is injected with has_track=true
    await showFlightDetail(flightId);

  } catch (e) {
    sessionStorage.setItem(skipKey, '1');
    if (statusEl) statusEl.innerHTML = '<span style="font-size:11px;color:var(--faint)">GPS track unavailable</span>';
  }
}


async function initFlightDetailMap(f) {
  const container = document.getElementById('fd-map');
  if (!container) return;

  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const mapStyle = isLight
    ? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
    : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

  // Capture local ref so async callbacks don't operate on a replaced map
  const thisMap = _fdMap = new maplibregl.Map({
    container: 'fd-map',
    style: mapStyle,
    center: [f.departure?.lon || -122.0, f.departure?.lat || 37.5],
    zoom: 8,
    attributionControl: false,
  });
  thisMap.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'top-right');
  thisMap.addControl(new maplibregl.FullscreenControl(), 'top-right');
  thisMap.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }), 'bottom-left');
  thisMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  // Satellite + Airspace toggles in one control group
  const _mapCtrlWrap = document.createElement('div');
  _mapCtrlWrap.className = 'maplibregl-ctrl maplibregl-ctrl-group';

  // Satellite button
  const _satBtn = document.createElement('button');
  _satBtn.title = 'Toggle satellite imagery';
  _satBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:14px;width:29px;height:29px';
  _satBtn.innerHTML = '<i class="ph-bold ph-globe-hemisphere-west"></i>';
  let _satOn = false;
  _satBtn.addEventListener('click', () => {
    _satOn = !_satOn;
    _satBtn.style.background = _satOn ? 'var(--amber,#d4a520)' : '';
    _satBtn.style.color = _satOn ? '#000' : '';
    if (_satOn) {
      if (!thisMap.getSource('sat')) {
        thisMap.addSource('sat', {
          type: 'raster',
          tiles: ['https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
          tileSize: 256, attribution: '© Esri'
        });
      }
      // Insert below every overlay layer currently on the map, not just one
      // fixed anchor — satellite is opaque raster imagery, so if it lands
      // above any of them (airspace, airports, route) it covers them
      // entirely. Airspace and the airports layer load asynchronously and
      // can finish before or after this click, so find whichever overlay is
      // actually bottom-most in the live style right now rather than
      // assuming a fixed order.
      const overlayIds = ['us-airports-dot','aspc-b-fill','aspc-b-line','aspc-c-fill','aspc-c-line','aspc-d-fill','aspc-d-line','route-glow'];
      const styleLayerIds = thisMap.getStyle().layers.map(l => l.id);
      const present = overlayIds.filter(id => styleLayerIds.includes(id));
      const before = present.length
        ? present.reduce((bottom, id) => styleLayerIds.indexOf(id) < styleLayerIds.indexOf(bottom) ? id : bottom)
        : undefined;
      thisMap.addLayer({ id:'sat-layer', type:'raster', source:'sat', paint:{'raster-opacity':0.88} }, before);
    } else {
      if (thisMap.getLayer('sat-layer')) thisMap.removeLayer('sat-layer');
    }
  });

  // Airspace button (wired to layers once the FAA data loads)
  const _aspcBtn = document.createElement('button');
  _aspcBtn.id    = 'fd-aspc-toggle';
  _aspcBtn.title = 'Toggle FAA airspace (Class B/C/D)';
  _aspcBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:13px;width:29px;height:29px;background:var(--amber,#d4a520);color:#000';
  _aspcBtn.innerHTML = '<i class="ph-bold ph-polygon"></i>';

  _mapCtrlWrap.appendChild(_satBtn);
  _mapCtrlWrap.appendChild(_aspcBtn);
  thisMap.addControl({ onAdd: () => _mapCtrlWrap, onRemove: () => {} }, 'top-right');

  thisMap.on('load', async () => {
    if (_fdMap !== thisMap) return; // stale — a newer map replaced this one

    const routeColor = typeColor(f.training_type);
    const dotColor   = isLight ? '#1a1a1a' : '#d4a520';
    const dotStroke  = isLight ? '#ffffff' : '#0a0909';
    const lblColor   = isLight ? '#1a1a1a' : '#d4a520';
    const lblHalo    = isLight ? '#ffffff' : '#0a0909';

    let coords = [];
    let firstPtTime = null, lastPtTime = null;
    let allPts = [];
    if (f.has_track) {
      allPts = await fetch('/api/flights/' + f.id + '/track')
        .then(r => r.ok ? r.json() : []).catch(() => []);
      if (_fdMap !== thisMap) return; // stale after await
      coords = allPts.map(p => [p.lon, p.lat]).filter(c => c[0] != null && c[1] != null);
      if (allPts.length) {
        firstPtTime = allPts[0].ts;
        lastPtTime  = allPts[allPts.length - 1].ts;
      }
    }

    if (coords.length < 2) {
      if (f.departure?.lon) coords.push([f.departure.lon, f.departure.lat]);
      if (f.via_airports) for (const a of f.via_airports) { if (a.lon) coords.push([a.lon, a.lat]); }
      if (f.arrival?.lon && f.arrival.icao !== f.departure?.icao) {
        coords.push([f.arrival.lon, f.arrival.lat]);
      }
    }

    if (coords.length >= 2) {
      thisMap.addSource('route', {
        type: 'geojson',
        lineMetrics: true,
        data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
      });
      thisMap.addLayer({ id:'route-glow', type:'line', source:'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': routeColor, 'line-width': 6, 'line-opacity': 0.08, 'line-blur': 4 } });
      thisMap.addLayer({ id:'route-line', type:'line', source:'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': 1.6,
          'line-opacity': 0.92,
          'line-gradient': ['interpolate', ['linear'], ['line-progress'],
            0,   routeColor,
            0.4, '#5ab4ff',
            0.6, '#5ab4ff',
            1,   routeColor
          ]
        }
      });

      const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
      thisMap.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 500 });
    } else if (coords.length === 1) {
      thisMap.setCenter(coords[0]);
      thisMap.setZoom(12);
    }

    // Deduplicate airports (for map display), preserving first occurrence
    const seen = new Set();
    const apts = [];
    for (const a of [f.departure, ...(f.via_airports||[]), f.arrival]) {
      if (a?.lon && !seen.has(a.icao)) { seen.add(a.icao); apts.push(a); }
    }

    if (apts.length) {
      // Fetch METAR for each unique airport in parallel, using leg-specific times
      const dateBase  = String(f.date).slice(0, 10);
      const deptTime  = firstPtTime || f.time_out  || (dateBase + 'T19:00:00Z');
      const arrvTime  = lastPtTime  || f.time_in   || (dateBase + 'T21:00:00Z');
      const allLegs   = [f.departure, ...(f.via_airports||[]), f.arrival].filter(a => a?.icao);
      const metarCache = {}; // icao → [{leg, metar, valid}]

      const fetchMetar = (icao, time, leg) =>
        fetch(`/api/metar?station=${encodeURIComponent(icao)}&time=${encodeURIComponent(new Date(time).toISOString())}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d?.metar) return;
            if (!metarCache[icao]) metarCache[icao] = [];
            const alreadyHasLeg = metarCache[icao].some(x => x.leg === leg);
            if (!alreadyHasLeg) metarCache[icao].push({ leg, metar: d.metar, valid: d.valid });
          })
          .catch(() => {});

      const n = allLegs.length;
      await Promise.allSettled(allLegs.map((a, i) => {
        const t = i === 0 ? deptTime : i === n - 1 ? arrvTime
          : new Date(new Date(deptTime).getTime() + (new Date(arrvTime) - new Date(deptTime)) * (i / (n - 1))).toISOString();
        const leg = i === 0 ? 'Departure' : i === n - 1 ? 'Arrival' : 'Via';
        return fetchMetar(a.icao, t, leg);
      }));
      if (_fdMap !== thisMap) return; // stale after METAR fetches

      for (const a of apts) {
        const aptEl = document.createElement('div');
        aptEl.style.cssText = 'cursor:pointer;text-align:center;pointer-events:auto;user-select:none';
        aptEl.innerHTML = `<div style="width:9px;height:9px;border-radius:50%;background:${dotColor};border:2px solid ${dotStroke};margin:0 auto;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>
        <div style="font-size:9px;font-weight:700;font-family:system-ui,sans-serif;color:${dotColor};letter-spacing:.04em;text-shadow:-1px -1px 0 ${dotStroke},1px -1px 0 ${dotStroke},-1px 1px 0 ${dotStroke},1px 1px 0 ${dotStroke};margin-top:3px;white-space:nowrap;line-height:1">${a.icao}</div>`;
        aptEl.addEventListener('click', () => {
          const obs = metarCache[a.icao] || [];
          const metarHtml = obs.length
            ? obs.map(o => {
                const t = o.valid ? new Date(o.valid)
                  .toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', hour12:false, timeZone:'UTC' }) + ' UTC' : '';
                return `<div style="margin-top:6px"><span style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;opacity:.6">${o.leg}${t ? ' · ' + t : ''}</span><br>
                  <code style="font-size:10px;word-break:break-all">${o.metar}</code></div>`;
              }).join('')
            : '<div style="margin-top:6px;font-size:11px;opacity:.6">No METAR available</div>';
          new maplibregl.Popup({ offset: [0,-22], closeButton: false, maxWidth: '320px' })
            .setLngLat([a.lon, a.lat])
            .setHTML(`<strong>${a.icao}</strong>${a.name ? '<br><span style="font-size:11px">' + a.name + '</span>' : ''}${metarHtml}`)
            .addTo(thisMap);
        });
        new maplibregl.Marker({ element: aptEl, anchor: 'top' })
          .setLngLat([a.lon, a.lat])
          .addTo(thisMap);
      }
    }

    // ── Track scrubber + animated plane marker ────────────────────────────────
    if (allPts.length >= 2) {
      const scrubWrap  = document.getElementById('fd-scrubber-wrap');
      const elevCanvas = document.getElementById('fd-elev-chart');
      const playBtn    = document.getElementById('fd-play-btn');
      const playIcon   = document.getElementById('fd-play-icon');
      const scrubInfo  = document.getElementById('fd-scrubber-info');
      const timeStart  = document.getElementById('fd-time-start');
      const timeEnd    = document.getElementById('fd-time-end');

      if (scrubWrap && elevCanvas) {
        scrubWrap.style.display = 'block';
        let scrubIdx = 0;
        let _playTimer = null;

        // Time range labels
        const fmtTime = (ts, sec) => new Date(ts).toLocaleTimeString('en-US',{
          hour:'2-digit', minute:'2-digit', ...(sec ? {second:'2-digit'} : {}), hour12:false, timeZone:'UTC'
        }) + ' UTC';
        if (timeStart) timeStart.textContent = fmtTime(allPts[0].ts, false);
        if (timeEnd)   timeEnd.textContent   = fmtTime(allPts[allPts.length-1].ts, false);

        // ── Plane marker ──────────────────────────────────────────────────────
        // markerOuter: MapLibre owns its transform (translate). planeEl: we rotate only.
        const markerOuter = document.createElement('div');
        markerOuter.style.cssText = 'width:30px;height:30px;pointer-events:none';
        const planeEl = document.createElement('div');
        planeEl.style.cssText = 'width:30px;height:30px;transform-origin:center center;will-change:transform';
        planeEl.innerHTML = `<svg viewBox="0 0 30 30" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="psh${f.id}" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="0.5" stdDeviation="0.8" flood-color="#000" flood-opacity=".55"/>
            </filter>
          </defs>
          <g transform="translate(15,15)" filter="url(#psh${f.id})">
            <path d="M0,-12 C0.9,-10 1.6,-5 1.6,1 C1.6,6 1,9 0,12 C-1,9 -1.6,6 -1.6,1 C-1.6,-5 -0.9,-10 0,-12 Z"
                  fill="${routeColor}"/>
            <path d="M-1.4,0 L-13,5.5 L-12.5,7 L-1.4,2 Z"  fill="${routeColor}"/>
            <path d="M1.4,0  L13,5.5  L12.5,7  L1.4,2  Z"   fill="${routeColor}"/>
            <path d="M-1.2,8 L-6.5,11 L-6.2,12 L-1.2,9.5 Z" fill="${routeColor}"/>
            <path d="M1.2,8  L6.5,11  L6.2,12  L1.2,9.5  Z"  fill="${routeColor}"/>
            <ellipse cx="0" cy="-7" rx="0.9" ry="1.6" fill="rgba(255,255,255,.45)"/>
          </g>
        </svg>`;
        markerOuter.appendChild(planeEl);
        const planeMkr = new maplibregl.Marker({ element: markerOuter, anchor: 'center' })
          .setLngLat([allPts[0].lon, allPts[0].lat])
          .addTo(thisMap);

        // ── Elevation chart (canvas handles all scrubber interaction) ─────────
        const alts  = allPts.map(p => p.altitude_ft ?? 0);
        const altMn = Math.min(...alts);
        const altMx = Math.max(...alts) || altMn + 1;
        const n     = allPts.length;

        const spds   = allPts.map(p => p.groundspeed_kts ?? 0);
        const spdMx  = Math.max(...spds, 1);

        // Cardinal spline helper — smooth curve through all (x,y) points
        function cardinalSplinePath(ctx, pts, tension) {
          if (pts.length < 2) return;
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[Math.max(i - 1, 0)];
            const p1 = pts[i];
            const p2 = pts[i + 1];
            const p3 = pts[Math.min(i + 2, pts.length - 1)];
            const cp1x = p1[0] + (p2[0] - p0[0]) * tension;
            const cp1y = p1[1] + (p2[1] - p0[1]) * tension;
            const cp2x = p2[0] - (p3[0] - p1[0]) * tension;
            const cp2y = p2[1] - (p3[1] - p1[1]) * tension;
            ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2[0], p2[1]);
          }
        }

        function drawElev(idx) {
          const dpr    = window.devicePixelRatio || 1;
          const cw     = elevCanvas.offsetWidth;
          const ch     = elevCanvas.offsetHeight;
          if (!cw || !ch) return;
          elevCanvas.width  = cw * dpr;
          elevCanvas.height = ch * dpr;
          const ctx = elevCanvas.getContext('2d');
          ctx.scale(dpr, dpr);

          // Theme-aware palette — isLight is captured from loadFdMap() closure
          const _bg   = isLight ? '#f5f0ea' : '#1a1912';
          const _grid = isLight ? 'rgba(0,0,0,0.06)'  : 'rgba(255,255,255,0.055)';
          const _base = isLight ? 'rgba(0,0,0,0.2)'   : 'rgba(255,255,255,0.18)';
          const _axis = isLight ? 'rgba(0,0,0,0.1)'   : 'rgba(255,255,255,0.1)';
          const _lblHi = isLight ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.5)';
          const _lblLo = isLight ? 'rgba(0,0,0,0.3)'  : 'rgba(255,255,255,0.28)';
          const _gs    = isLight ? 'rgba(0,0,0,0.3)'  : 'rgba(255,255,255,0.38)';
          const _curs  = isLight ? 'rgba(0,0,0,0.4)'  : 'rgba(255,255,255,0.5)';
          const _track = isLight ? 'rgba(0,0,0,0.1)'  : 'rgba(255,255,255,0.1)';
          const _dotOuter = isLight ? '#222' : '#fff';

          // Background — match theme
          ctx.fillStyle = _bg;
          ctx.fillRect(0, 0, cw, ch);

          // Layout zones
          const barH   = 3;
          const padT   = 14;
          const padB   = barH + 16;
          const padL   = 46;
          const profH  = ch - padT - padB;
          const chartW = cw - padL - 6;

          const xOf = i => padL + (i / Math.max(n - 1, 1)) * chartW;
          const yOf = a => altMx === altMn ? padT + profH / 2
            : padT + profH - ((a - altMn) / (altMx - altMn)) * profH;
          const pct     = idx / Math.max(n - 1, 1);
          const groundY = yOf(altMn);

          // Grid lines
          ctx.strokeStyle = _grid;
          ctx.lineWidth   = 1;
          for (let g = 1; g < 4; g++) {
            const gy = padT + (profH / 4) * g;
            ctx.beginPath(); ctx.moveTo(padL, gy); ctx.lineTo(padL + chartW, gy); ctx.stroke();
          }

          // Ground baseline
          ctx.strokeStyle = _base;
          ctx.lineWidth   = 1;
          ctx.beginPath(); ctx.moveTo(padL, groundY); ctx.lineTo(padL + chartW, groundY); ctx.stroke();

          // Left axis separator
          ctx.strokeStyle = _axis;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(padL, padT - 4); ctx.lineTo(padL, ch - padB + 4); ctx.stroke();

          // Y-axis altitude labels
          ctx.font = '8.5px system-ui,sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'middle';
          for (let g = 0; g <= 4; g++) {
            const aVal = altMn + ((altMx - altMn) / 4) * (4 - g);
            const gy   = padT + (profH / 4) * g;
            const lbl  = aVal >= 10000 ? Math.round(aVal / 1000) + 'k\'' :
                         aVal >= 1000  ? (aVal / 1000).toFixed(1) + 'k\'' :
                                         Math.round(aVal / 50) * 50 + '\'';
            ctx.fillStyle = (g === 4 || g === 0) ? _lblHi : _lblLo;
            ctx.fillText(lbl, padL - 6, gy);
          }

          // Pre-compute smoothed point arrays
          const altPts = Array.from({length: n}, (_, i) => [xOf(i), yOf(alts[i])]);
          const spdPts = Array.from({length: n}, (_, i) => [xOf(i), padT + profH - (spds[i] / spdMx) * profH]);

          // Gradient fill under altitude profile
          const fillGrad = ctx.createLinearGradient(0, padT, 0, groundY);
          fillGrad.addColorStop(0,   routeColor + (isLight ? '40' : '55'));
          fillGrad.addColorStop(0.5, routeColor + (isLight ? '18' : '22'));
          fillGrad.addColorStop(1,   routeColor + '05');
          ctx.beginPath();
          ctx.moveTo(altPts[0][0], groundY);
          cardinalSplinePath(ctx, altPts, 0.18);
          ctx.lineTo(altPts[n-1][0], groundY);
          ctx.closePath();
          ctx.fillStyle = fillGrad;
          ctx.fill();

          // Groundspeed dashed overlay
          ctx.save();
          ctx.setLineDash([3, 4]);
          ctx.strokeStyle = _gs;
          ctx.lineWidth = 1;
          ctx.lineJoin  = 'round';
          ctx.lineCap   = 'round';
          ctx.beginPath();
          cardinalSplinePath(ctx, spdPts, 0.18);
          ctx.stroke();
          ctx.restore();

          // Altitude profile line
          ctx.beginPath();
          cardinalSplinePath(ctx, altPts, 0.18);
          ctx.strokeStyle = routeColor;
          ctx.lineWidth   = 1.6;
          ctx.lineJoin    = 'round';
          ctx.lineCap     = 'round';
          ctx.stroke();

          // Legend — bottom-right
          ctx.font = '7.5px system-ui,sans-serif';
          ctx.textAlign = 'right';
          ctx.textBaseline = 'bottom';
          const legY = ch - padB - 4;
          ctx.fillStyle = routeColor + 'cc';
          ctx.fillText('ALT', padL + chartW, legY);
          ctx.save();
          ctx.setLineDash([3,4]);
          ctx.strokeStyle = _gs;
          ctx.lineWidth = 1;
          const legW = 14, legX = padL + chartW - 28, legLineY = legY - 4;
          ctx.beginPath(); ctx.moveTo(legX, legLineY); ctx.lineTo(legX + legW, legLineY); ctx.stroke();
          ctx.restore();
          ctx.fillStyle = _lblHi;
          ctx.fillText('GS', legX - 2, legY);

          // Cursor vertical line
          const cx = xOf(idx);
          ctx.save();
          ctx.setLineDash([2, 3]);
          ctx.strokeStyle = _curs;
          ctx.lineWidth   = 1;
          ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, ch - padB); ctx.stroke();
          ctx.restore();

          // Dot at cursor on profile
          const cy = altPts[idx][1];
          ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = _dotOuter; ctx.fill();
          ctx.beginPath(); ctx.arc(cx, cy, 2, 0, Math.PI * 2);
          ctx.fillStyle = routeColor; ctx.fill();

          // Progress bar track
          const barY = ch - barH - 4;
          ctx.fillStyle = _track;
          ctx.beginPath(); ctx.roundRect(padL, barY, chartW, barH, barH / 2); ctx.fill();

          // Progress bar fill
          if (pct > 0) {
            ctx.fillStyle = routeColor;
            ctx.beginPath(); ctx.roundRect(padL, barY, pct * chartW, barH, barH / 2); ctx.fill();
          }

          // Playhead thumb
          const thumbX = padL + pct * chartW;
          ctx.beginPath(); ctx.arc(thumbX, barY + barH / 2, 5, 0, Math.PI * 2);
          ctx.fillStyle = _dotOuter;
          ctx.shadowColor = 'rgba(0,0,0,0.4)';
          ctx.shadowBlur = 4;
          ctx.fill();
          ctx.shadowBlur = 0;
          ctx.beginPath(); ctx.arc(thumbX, barY + barH / 2, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = routeColor; ctx.fill();
        }

        // Info chips overlay
        function updateChips(idx) {
          if (!scrubInfo) return;
          const pt  = allPts[Math.min(idx, n - 1)];
          const utc = fmtTime(pt.ts, true);
          const alt = pt.altitude_ft != null ? Math.round(pt.altitude_ft).toLocaleString() + ' ft' : '';
          const spd = pt.groundspeed_kts != null ? Math.round(pt.groundspeed_kts) + ' kts' : '';
          const hdg = pt.track_deg != null ? Math.round(pt.track_deg) + '°' : '';
          let vs = '';
          if (idx > 0 && pt.altitude_ft != null) {
            const prev = allPts[idx - 1];
            const dtSec = (new Date(pt.ts) - new Date(prev.ts)) / 1000;
            if (dtSec > 0 && prev.altitude_ft != null) {
              const fpm = ((pt.altitude_ft - prev.altitude_ft) / dtSec) * 60;
              if (Math.abs(fpm) > 80) vs = (fpm > 0 ? '+' : '') + Math.round(fpm / 10) * 10 + ' fpm';
            }
          }
          const chip = (val, label) => val
            ? `<span style="background:rgba(8,8,12,.86);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.18);padding:3px 9px;border-radius:20px;font-size:10.5px;font-weight:500;color:#f5edd0;white-space:nowrap;font-variant-numeric:tabular-nums">${label ? `<span style="font-size:8.5px;color:rgba(255,255,255,.48);letter-spacing:.06em;margin-right:4px;text-transform:uppercase">${label}</span>` : ''}${val}</span>`
            : '';
          scrubInfo.innerHTML = chip(utc,'') + chip(alt,'ALT') + chip(spd,'GS') + chip(hdg,'HDG') + chip(vs,'VS');
        }

        function updateScrubPos(idx) {
          scrubIdx   = Math.max(0, Math.min(n - 1, idx));
          const pt   = allPts[scrubIdx];
          planeMkr.setLngLat([pt.lon, pt.lat]);
          planeEl.style.transform = `rotate(${pt.track_deg ?? 0}deg)`;
          updateChips(scrubIdx);
          drawElev(scrubIdx);
        }

        // Canvas pointer interaction — x mapping matches drawElev's xOf(i)=padL+i/n*chartW
        function idxFromPointer(e) {
          const rect   = elevCanvas.getBoundingClientRect();
          const padL   = 44;
          const chartW = rect.width - padL;
          const pct    = Math.max(0, Math.min(1, (e.clientX - rect.left - padL) / chartW));
          return Math.round(pct * (n - 1));
        }
        let _dragging = false;
        elevCanvas.addEventListener('pointerdown', e => {
          _dragging = true;
          elevCanvas.setPointerCapture(e.pointerId);
          if (_playTimer) { clearInterval(_playTimer); _playTimer = null; playIcon.className = 'ph-bold ph-play'; }
          updateScrubPos(idxFromPointer(e));
        });
        elevCanvas.addEventListener('pointermove', e => {
          if (!_dragging) return;
          updateScrubPos(idxFromPointer(e));
        });
        elevCanvas.addEventListener('pointerup', () => { _dragging = false; });

        // Skip to start / end
        const skipStartBtn = document.getElementById('fd-skip-start-btn');
        const skipEndBtn   = document.getElementById('fd-skip-end-btn');
        const speedSel     = document.getElementById('fd-speed-sel');
        if (skipStartBtn) skipStartBtn.addEventListener('click', () => {
          if (_playTimer) { clearInterval(_playTimer); _playTimer = null; playIcon.className = 'ph-bold ph-play'; }
          updateScrubPos(0);
        });
        if (skipEndBtn) skipEndBtn.addEventListener('click', () => {
          if (_playTimer) { clearInterval(_playTimer); _playTimer = null; playIcon.className = 'ph-bold ph-play'; }
          updateScrubPos(n - 1);
        });

        // Play / pause with speed selector
        if (playBtn) {
          playBtn.addEventListener('click', () => {
            if (_playTimer) {
              clearInterval(_playTimer); _playTimer = null;
              playIcon.className = 'ph-bold ph-play';
            } else {
              playIcon.className = 'ph-bold ph-pause';
              let idx = scrubIdx >= n - 1 ? 0 : scrubIdx;
              const speed    = speedSel ? Number(speedSel.value) : 1;
              const interval = Math.max(16, Math.round(160 / speed));
              _playTimer = setInterval(() => {
                idx++;
                if (idx >= n) {
                  clearInterval(_playTimer); _playTimer = null;
                  playIcon.className = 'ph-bold ph-play';
                  return;
                }
                updateScrubPos(idx);
              }, interval);
            }
          });
        }

        // Resize — redraw at current index
        new ResizeObserver(() => drawElev(scrubIdx)).observe(elevCanvas);

        // Initial render
        requestAnimationFrame(() => updateScrubPos(0));
      }
    }

    // ── FAA Airspace overlay (toggle, AIRAC 28-day data) ─────────────────────
    // Shown by default; the toggle button (styled active on load) hides it.
    fetch('/api/external/faa-airspace')
      .then(r => r.ok ? r.json() : null)
      .then(fc => {
        if (!fc || _fdMap !== thisMap) return;
        thisMap.addSource('airspace', { type: 'geojson', data: fc });
        const aspcLayers = [
          // Class B — solid blue (SFO, LAX, etc.)
          { id:'aspc-b-fill', type:'fill',   filter:['==',['get','CLASS'],'B'], paint:{'fill-color':'#1a6ef5','fill-opacity':0.07} },
          { id:'aspc-b-line', type:'line',   filter:['==',['get','CLASS'],'B'], paint:{'line-color':'#2979ff','line-width':1.4,'line-opacity':0.75} },
          // Class C — magenta (SJC, OAK, etc.)
          { id:'aspc-c-fill', type:'fill',   filter:['==',['get','CLASS'],'C'], paint:{'fill-color':'#cc33cc','fill-opacity':0.05} },
          { id:'aspc-c-line', type:'line',   filter:['==',['get','CLASS'],'C'], paint:{'line-color':'#dd55dd','line-width':1.2,'line-opacity':0.7} },
          // Class D — dashed blue (KRHV, KPAO-area towers)
          { id:'aspc-d-fill', type:'fill',   filter:['==',['get','CLASS'],'D'], paint:{'fill-color':'#1a6ef5','fill-opacity':0.03} },
          { id:'aspc-d-line', type:'line',   filter:['==',['get','CLASS'],'D'], paint:{'line-color':'#4488ee','line-width':1.0,'line-opacity':0.6,'line-dasharray':[4,3]} },
        ];
        // Stay below the airport dots (points shouldn't be washed out by an
        // area fill) — insert before whichever of those already exists.
        const beforeId = thisMap.getLayer('us-airports-dot') ? 'us-airports-dot'
                        : thisMap.getLayer('route-glow')      ? 'route-glow' : undefined;
        for (const cfg of aspcLayers) {
          thisMap.addLayer({ id:cfg.id, type:cfg.type, source:'airspace',
            filter:cfg.filter, paint:cfg.paint,
            layout:{ visibility:'visible' } }, beforeId);
        }
        // Wire the airspace toggle button (added earlier in the control panel)
        const aspcBtn = document.getElementById('fd-aspc-toggle');
        if (aspcBtn) {
          aspcBtn.addEventListener('click', () => {
            const vis = thisMap.getLayoutProperty('aspc-b-fill','visibility') === 'visible' ? 'none' : 'visible';
            for (const cfg of aspcLayers) thisMap.setLayoutProperty(cfg.id,'visibility',vis);
            aspcBtn.style.background = vis === 'visible' ? 'var(--amber,#d4a520)' : '';
            aspcBtn.style.color      = vis === 'visible' ? '#000' : '';
          });
        }
      })
      .catch(e => console.warn('[airspace]', e));

    // ── US airports (nationwide reference layer) ─────────────────────────────
    // Small, dim dots so they read as background context — the flight's own
    // departure/via/arrival airports keep their existing larger dot+ICAO
    // label markers (added above) so they stay visually distinct.
    fetch('/api/external/us-airports')
      .then(r => r.ok ? r.json() : null)
      .then(fc => {
        if (!fc || _fdMap !== thisMap) return;
        thisMap.addSource('us-airports', { type: 'geojson', data: fc });
        // Always anchor at route-glow (never below airspace) — points
        // shouldn't be washed out by an area fill. If airspace loaded first
        // its layers are already sitting at this same anchor; inserting here
        // pushes the dots above them regardless of which fetch finished first.
        const beforeId = thisMap.getLayer('route-glow') ? 'route-glow' : undefined;
        thisMap.addLayer({
          id: 'us-airports-dot', type: 'circle', source: 'us-airports',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 1.4, 8, 2.8, 12, 4.5],
            'circle-color': isLight ? '#7a7a7a' : '#9a9a9a',
            'circle-opacity': 0.75,
            'circle-stroke-width': 1,
            'circle-stroke-color': isLight ? '#ffffff' : '#0a0909',
            'circle-stroke-opacity': 0.6,
          },
        }, beforeId);
        console.info('[us-airports] layer added, features:', fc.features.length, 'beforeId:', beforeId);
      })
      .catch(e => console.warn('[us-airports]', e));
  });
}

// ─── row-level delete (logbook list) ─────────────────────────────────────────
function rowConfirmDelete(id) {
  const area = document.getElementById('ra-' + id);
  if (!area) return;
  area.style.opacity = '1';
  area.innerHTML = `
    <div class="row-confirm">
      <span class="row-confirm-label">Delete?</span>
      <button class="row-btn danger" title="Confirm delete"
        onclick="event.stopPropagation();rowDoDelete('${id}',this)">
        <i class="ph-bold ph-check"></i>
      </button>
      <button class="row-btn" title="Cancel"
        onclick="event.stopPropagation();applyFlFilter()">
        <i class="ph-bold ph-x"></i>
      </button>
    </div>`;
}

async function rowDoDelete(id, btn) {
  btn.disabled = true;
  try {
    const res = await fetch('/api/flights/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    window._flights = (window._flights || []).filter(f => String(f.id) !== String(id));
    await loadFlights();
  } catch(e) {
    renderFlights(window._flights); // reset row
  }
}

// ─── flight delete ────────────────────────────────────────────────────────────
function confirmDeleteFlight(id) {
  const area = document.getElementById('flight-action-area');
  if (!area) return;
  area.innerHTML = `
    <span style="font-size:13px;color:var(--warn)">Delete this flight?</span>
    <button class="btn-ghost" onclick="deleteFlight(${id})"
      style="font-size:12px;padding:6px 12px;color:var(--warn);border-color:var(--warn)">
      <i class="ph-bold ph-trash"></i> Yes, delete
    </button>
    <button class="btn-ghost" onclick="showFlightDetail(${id})"
      style="font-size:12px;padding:6px 12px">Cancel</button>
  `;
}

async function deleteFlight(id) {
  try {
    const res = await fetch('/api/flights/' + id, { method: 'DELETE' });
    if (!res.ok) throw new Error('Delete failed');
    window._flights = (window._flights || []).filter(f => String(f.id) !== String(id));
    renderFlights(window._flights);
    navigate('logbook');
    loadFlights().catch(() => {});
  } catch(err) {
    const area = document.getElementById('flight-action-area');
    if (area) area.innerHTML = `<span style="color:var(--warn);font-size:13px">${esc(err.message)}</span>`;
  }
}
