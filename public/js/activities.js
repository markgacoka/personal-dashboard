'use strict';

// ─── charts ───────────────────────────────────────────────────────────────────

// Full 30-day date array in local time (oldest first), format "YYYY-MM-DD"
function last30Days() {
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
  });
}

function fmtChartDate(dayStr, opts) {
  // Parse as local noon to avoid UTC-shift edge cases
  return new Date(dayStr + 'T12:00:00').toLocaleDateString('en-US', opts);
}

function chartTooltipTitle(allDays, items) {
  const idx = items?.[0]?.dataIndex ?? -1;
  if (idx < 0 || !allDays[idx]) return '';
  return fmtChartDate(allDays[idx], { weekday:'short', month:'short', day:'numeric' });
}

function buildVolumeChart(activities) {
  const cfg = getChartCfg();
  const cutoffStr = last30Days()[0];
  const dayData = {};
  let totalHrs = 0;

  for (const a of activities) {
    const day = (a.startTimeLocal || '').slice(0, 10);
    if (!day || day < cutoffStr) continue;
    const dur = (a.movingDuration || a.duration || 0) / 3600;
    if (dur <= 0) continue;
    if (!dayData[day]) dayData[day] = { running:0, cycling:0, swimming:0, rowing:0, strength:0, other:0 };
    const sport = normSport(a.activityType?.typeKey);
    const key = ['running','cycling','swimming','rowing','strength'].includes(sport) ? sport : 'other';
    dayData[day][key] = (dayData[day][key] || 0) + dur;
    totalHrs += dur;
  }

  // Only days that have data — gives natural bar width, no dead space
  const days = Object.keys(dayData).sort();
  const sports = ['running','cycling','swimming','rowing','strength','other']
    .filter(sp => days.some(d => (dayData[d][sp] || 0) > 0));

  const el = document.getElementById('chart-volume');
  const lbl = el?.closest('.chart-card')?.querySelector('.chart-label');
  if (lbl) lbl.innerHTML = `30-day volume <span class="chart-sublabel">${totalHrs.toFixed(1)} hrs · ${days.length} sessions</span>`;

  if (!days.length) { el.innerHTML = '<div style="padding:20px;color:var(--faint);font-size:12px">No activity data</div>'; return; }

  _cjsRender(el, {
    type: 'bar',
    data: {
      labels: days.map(d => fmtChartDate(d, { month:'short', day:'numeric' })),
      datasets: sports.map(sp => ({
        label: SPORT_CFG[sp].label,
        data: days.map(d => parseFloat((dayData[d][sp] || 0).toFixed(2))),
        backgroundColor: SPORT_CFG[sp].color + 'cc',
        borderRadius: 3,
        barPercentage: 0.7,
        categoryPercentage: 0.85,
        stack: 'vol',
      }))
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          labels: { color: cfg.legendClr, font: CJ_FONT, boxWidth: 7, boxHeight: 7, padding: 12, usePointStyle: true, pointStyle: 'circle' },
          onClick: () => {},
        },
        tooltip: { ...cfg.tt,
          callbacks: {
            title: items => { const i = items[0]?.dataIndex; return days[i] ? fmtChartDate(days[i], { weekday:'short', month:'short', day:'numeric' }) : ''; },
            label: c => c.raw > 0 ? `${c.dataset.label}: ${c.raw.toFixed(1)}h` : null,
            footer: items => { const t = items.reduce((s,c)=>s+(c.raw||0), 0); return t > 0.01 ? `Total: ${t.toFixed(1)}h` : null; },
          }
        },
      },
      scales: {
        x: { ...cfg.scaleX, ticks: { ...cfg.scaleX.ticks, maxTicksLimit: 10, maxRotation: 0 } },
        y: { ...cfg.scaleY, stacked: true, ticks: { ...cfg.scaleY.ticks, callback: v => v > 0 ? `${v}h` : '0' } },
      },
    }
  }, 175);
}

function buildLoadChart(activities) {
  const cfg = getChartCfg();
  const cutoffStr = last30Days()[0];
  const dayMap = {};

  for (const a of activities) {
    const day = (a.startTimeLocal || '').slice(0, 10);
    if (!day || day < cutoffStr || !a.activityTrainingLoad) continue;
    if (!dayMap[day]) dayMap[day] = { load: 0, sport: 'other', topLoad: 0 };
    dayMap[day].load += a.activityTrainingLoad;
    if (a.activityTrainingLoad > dayMap[day].topLoad) {
      dayMap[day].topLoad = a.activityTrainingLoad;
      dayMap[day].sport = normSport(a.activityType?.typeKey);
    }
  }

  // Only workout days — same approach as volume chart
  const days = Object.keys(dayMap).sort();
  const loads  = days.map(d => Math.round(dayMap[d].load));
  const colors = days.map(d => SPORT_CFG[dayMap[d].sport || 'other'].color + 'cc');
  const totalLoad = loads.reduce((s, v) => s + v, 0);

  const el = document.getElementById('chart-load');
  const lbl = el?.closest('.chart-card')?.querySelector('.chart-label');
  if (lbl) lbl.innerHTML = `30-day load <span class="chart-sublabel">${totalLoad.toLocaleString()} total</span>`;

  if (!days.length) { el.innerHTML = '<div style="padding:20px;color:var(--faint);font-size:12px">No load data</div>'; return; }

  _cjsRender(el, {
    type: 'bar',
    data: {
      labels: days.map(d => fmtChartDate(d, { month:'short', day:'numeric' })),
      datasets: [{
        label: 'Training Load',
        data: loads,
        backgroundColor: colors,
        borderRadius: 3,
        barPercentage: 0.7,
        categoryPercentage: 0.85,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...cfg.tt,
          callbacks: {
            title: items => { const i = items[0]?.dataIndex; return days[i] ? fmtChartDate(days[i], { weekday:'short', month:'short', day:'numeric' }) : ''; },
            label: c => `Load: ${c.raw}`,
          }
        },
      },
      scales: {
        x: { ...cfg.scaleX, ticks: { ...cfg.scaleX.ticks, maxTicksLimit: 10, maxRotation: 0 } },
        y: cfg.scaleY,
      },
    }
  }, 175);
}

function buildHRChart(activities) {
  const cfg = getChartCfg();
  // A rolling cutoff (now, or even the latest activity's date) can legitimately
  // land on just one qualifying day when activities are logged with gaps —
  // e.g. one session today, next-most-recent eight days ago falls just
  // outside the window — leaving a single isolated dot with no visible trend.
  // Show the most recent 7 distinct days that actually have HR data instead.
  const dayMap = {};
  for (const a of activities) {
    if (!a.averageHR) continue;
    const day = new Date(a.startTimeLocal).toISOString().slice(0,10);
    if (!dayMap[day]) dayMap[day] = { avgHRs: [], maxHR: 0 };
    dayMap[day].avgHRs.push(a.averageHR);
    dayMap[day].maxHR = Math.max(dayMap[day].maxHR, a.maxHR||0);
  }
  const sorted = Object.keys(dayMap).sort().slice(-7);
  const labels = sorted.map(d => fmtCalDate(d, {month:'short',day:'numeric'}));
  const avgHRs = sorted.map(d => Math.round(dayMap[d].avgHRs.reduce((s,v)=>s+v,0)/dayMap[d].avgHRs.length));
  const maxHRs = sorted.map(d => dayMap[d].maxHR || null);
  _cjsRender(document.getElementById('chart-hr'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Avg HR', data: avgHRs,
          borderColor: '#b85e7a', fill: false, borderWidth: 2, tension: 0.3,
          pointRadius: 4, pointBackgroundColor: '#b85e7a', pointBorderWidth: 0, pointHoverRadius: 6 },
        { label: 'Max HR', data: maxHRs,
          borderColor: '#c99c3a', fill: false, borderWidth: 1.5,
          borderDash: [4,3], tension: 0.3, pointRadius: 2, pointBackgroundColor: '#c99c3a', pointBorderWidth: 0 },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        // pointStyle:'line' drew a swatch too thin to read as a color cue —
        // a filled circle in each dataset's own color makes it obvious which
        // legend label goes with which line.
        legend: { labels: { color: cfg.legendClr, font: CJ_FONT, boxWidth: 8, boxHeight: 8, padding: 10, usePointStyle: true, pointStyle: 'circle' } },
        tooltip: { ...cfg.tt, callbacks: { label: c => c.raw !== null ? `${c.dataset.label}: ${c.raw} bpm` : null } },
      },
      scales: { x: cfg.scaleX, y: cfg.scaleY },
    }
  });
}

function buildZonesChart(activities) {
  const cfg = getChartCfg();
  document.getElementById('zones-label').textContent = '· last 7d';
  const arr = Array.isArray(activities) ? activities : (activities ? [activities] : []);
  // Most recent 7 distinct days with zone data, not a rolling cutoff —
  // see buildHRChart for why (gaps can leave a cutoff window nearly empty).
  const daysWithData = [...new Set(
    arr.filter(a => [1,2,3,4,5].some(i => (a['hrTimeInZone_'+i]||0) > 0))
       .map(a => new Date(a.startTimeLocal||0).toISOString().slice(0,10))
  )].sort().slice(-7);
  const daySet = new Set(daysWithData);
  const zoneMins = [0, 0, 0, 0, 0];
  let hasData = false;
  for (const a of arr) {
    const day = new Date(a.startTimeLocal||0).toISOString().slice(0,10);
    if (!daySet.has(day)) continue;
    for (let i = 0; i < 5; i++) {
      const secs = a['hrTimeInZone_'+(i+1)] || 0;
      zoneMins[i] += Math.round(secs / 60);
      if (secs > 0) hasData = true;
    }
  }
  const el = document.getElementById('chart-zones');
  if (!hasData) { el.style.height = 'auto'; el.className = 'chart-empty'; el.textContent = 'No zone data for this period'; return; }
  _cjsRender(el, {
    type: 'bar',
    data: {
      labels: HR_ZONES.map(z => z.name),
      datasets: [{ label: 'Minutes', data: zoneMins,
        backgroundColor: HR_ZONES.map(z => z.color + 'c8'), borderRadius: 3, maxBarThickness: 18 }]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { ...cfg.tt, callbacks: {
        label: c => { const m = c.raw; return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`; }
      }}},
      scales: {
        x: { ...cfg.scaleY, ticks: { ...cfg.scaleY.ticks, callback: v => v >= 60 ? Math.floor(v/60)+'h' : v+'m' } },
        y: { ...cfg.scaleX, ticks: { ...cfg.scaleX.ticks, font: { ...CJ_FONT, size: 10 } } },
      },
    }
  }, 160);
}

// ─── activity list ────────────────────────────────────────────────────────────
let _actSport = 'all';

const TE_LABEL = {
  vo2max: 'VO₂ Max', aerobic_base: 'Base', aerobic_capacity: 'Capacity',
  lactate_threshold: 'Threshold', anaerobic: 'Anaerobic',
  tempo: 'Tempo', recovery: 'Recovery',
};
const TE_COLOR = {
  vo2max: '#5a88c0', aerobic_base: '#5db87c', aerobic_capacity: '#5db87c',
  lactate_threshold: '#c07030', anaerobic: '#c04040',
  tempo: '#c99c3a', recovery: '#7a8a98',
};
function fmtTE(te) {
  if (!te) return '';
  const label = TE_LABEL[te] || te.replace(/_/g, ' ');
  const color = TE_COLOR[te] || '#7a8a98';
  return `<span class="act-te" style="color:${color};background:${color}28">${label}</span>`;
}

function actRowHtml(a) {
  const sport = normSport(a.activityType?.typeKey);
  const { color, icon, label } = SPORT_CFG[sport];
  const te = a.trainingEffectLabel;
  const dur = a.movingDuration || a.duration;

  const metrics = [];
  if (a.distance > 0) {
    metrics.push({ v: fmtDist(a.distance), l: 'dist', c: color });
    if (dur > 0) {
      const timeLabel = (sport === 'running' || sport === 'swimming') && a.averageSpeed > 0
        ? fmtPace(a.averageSpeed)
        : sport === 'cycling' && a.averageSpeed > 0
          ? (a.averageSpeed * 2.23694).toFixed(1) + ' mph'
          : 'time';
      metrics.push({ v: fmtTime(dur), l: timeLabel, c: 'var(--champagne)' });
    }
  } else if (dur > 0) {
    metrics.push({ v: fmtTime(dur), l: 'time', c: 'var(--champagne)' });
  }
  if (a.averageHR > 0) metrics.push({ v: String(a.averageHR), l: 'bpm', c: 'oklch(65% 0.15 350)' });
  if (a.activityTrainingLoad > 0) metrics.push({ v: String(Math.round(a.activityTrainingLoad)), l: 'load', c: 'var(--patina-text)' });

  return `<div class="act-row" data-id="${a.activityId}" style="border-left-color:${color}55">
    <div class="act-summary">
      <div class="act-icon" style="background:color-mix(in oklch, ${color} 12%, var(--raised))">
        <i class="ph-bold ${icon}" style="color:${color}"></i>
      </div>
      <div class="act-body">
        <div class="act-name">${esc(a.activityName || label)}</div>
        <div class="act-meta">
          <span>${fmtDate(a.startTimeLocal)}</span>
          <span style="color:var(--faint)">·</span>
          <span>${label}</span>
          ${te ? fmtTE(te) : ''}
        </div>
      </div>
      ${metrics.length ? `<div class="act-metrics">
        ${metrics.map(m => `<div class="act-metric">
          <div class="act-metric-v" style="color:${m.c}">${m.v}</div>
          <div class="act-metric-l">${m.l}</div>
        </div>`).join('')}
      </div>` : ''}
    </div>
  </div>`;
}

const PRIMARY_SPORTS = new Set(['running', 'cycling', 'swimming', 'rowing', 'strength']);
const ACT_PER_PAGE = 20;
let _actPage = 0;

function actPageStep(dir) {
  const total = (window._actsFiltered || []).length;
  const pages = Math.ceil(total / ACT_PER_PAGE);
  _actPage = Math.max(0, Math.min(pages - 1, _actPage + dir));
  renderActivitiesPage(window._actsFiltered || []);
}

function filterActivities() {
  const all = window._actsArr || [];
  const q = (document.getElementById('act-search')?.value || '').toLowerCase();
  const filtered = all.filter(a => {
    const sport = normSport(a.activityType?.typeKey);
    if (_actSport !== 'all') {
      if (_actSport === 'other') {
        if (PRIMARY_SPORTS.has(sport)) return false;
      } else if (sport !== _actSport) {
        return false;
      }
    }
    if (q && !(a.activityName||'').toLowerCase().includes(q)) return false;
    return true;
  });

  const totalAll = all.length;
  const countEl = document.getElementById('act-count');
  if (countEl) {
    countEl.textContent = filtered.length < totalAll
      ? `· ${filtered.length} of ${totalAll} sessions`
      : `· ${totalAll} sessions`;
  }

  window._actsFiltered = filtered;
  _actPage = 0;
  renderActivitiesPage(filtered);
}

function renderActivitiesPage(filtered) {
  const list = document.getElementById('act-list');
  const pg = document.getElementById('act-pagination');
  if (!filtered.length) {
    list.innerHTML = `<div class="act-empty">No activities match</div>`;
    if (pg) pg.style.display = 'none';
    return;
  }

  const total = filtered.length;
  const pages = Math.ceil(total / ACT_PER_PAGE);
  _actPage = Math.max(0, Math.min(pages - 1, _actPage));
  const page = filtered.slice(_actPage * ACT_PER_PAGE, (_actPage + 1) * ACT_PER_PAGE);

  // Group by month
  const groups = [];
  let lastKey = null;
  for (const a of page) {
    const d = new Date(a.startTimeLocal);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (key !== lastKey) { groups.push({ label, rows: [] }); lastKey = key; }
    groups[groups.length - 1].rows.push(a);
  }

  list.innerHTML = groups.map(g =>
    `<div class="act-month-hdr">${g.label}</div>` + g.rows.map(actRowHtml).join('')
  ).join('');

  list.querySelectorAll('.act-row').forEach(row => {
    row.addEventListener('click', () => navigate('activity', row.dataset.id));
  });

  if (pg) {
    if (pages > 1) {
      pg.style.display = 'flex';
      document.getElementById('act-page-label').textContent =
        `${_actPage * ACT_PER_PAGE + 1}–${Math.min((_actPage + 1) * ACT_PER_PAGE, total)} of ${total}`;
      document.getElementById('act-prev').disabled = _actPage === 0;
      document.getElementById('act-next').disabled = _actPage >= pages - 1;
    } else {
      pg.style.display = 'none';
    }
  }
}

function setActSport(sport) {
  _actSport = sport;
  document.querySelectorAll('.act-chip').forEach(c => c.classList.toggle('active', c.dataset.sport === sport));
  filterActivities();
}

function renderActivities(activities) {
  document.getElementById('act-count').textContent = `· ${activities.length} sessions`;
  window._acts = {};
  for (const a of activities) window._acts[a.activityId] = a;
  _actSport = 'all';
  document.querySelectorAll('.act-chip').forEach(c => c.classList.toggle('active', c.dataset.sport === 'all'));
  const search = document.getElementById('act-search');
  if (search) search.value = '';
  filterActivities();
}

// ─── activity detail page ─────────────────────────────────────────────────────
async function showActivityDetail(id) {
  let a = window._acts?.[id];
  // A deep link can arrive before activities have loaded.
  if (!a && window._activitiesReady) { await window._activitiesReady; a = window._acts?.[id]; }
  if (!a) { navigate('activities'); return; }

  const sport = normSport(a.activityType?.typeKey);
  const { color, icon, label } = SPORT_CFG[sport];

  showView('activity-detail', {
    back: 'activities',
    title: a.activityName || label,
  });
  _currentActivityId = id;

  const content = document.getElementById('activity-detail-content');
  const heroKpis = [
    a.distance > 0 ? { label:'Distance', val: fmtDist(a.distance), color } : null,
    (a.movingDuration||a.duration) > 0 ? { label:'Duration', val: fmtTime(a.movingDuration||a.duration), color: 'var(--champagne)' } : null,
    a.averageSpeed > 0 ? { label: sport==='cycling'?'Speed':'Pace', val: fmtSpeed(a.averageSpeed, sport), color:'var(--champagne)' } : null,
    a.averageHR > 0 ? { label:'Avg HR', val: a.averageHR+' bpm', color:'oklch(65% 0.15 350)' } : null,
  ].filter(Boolean);

  const hasMap = !!a.hasPolyline;

  if (_actMap) { try { _actMap.remove(); } catch(_) {} _actMap = null; }

  content.innerHTML = `
    <div class="detail-header">
      <div class="detail-sport-chip">
        <i class="ph-bold ${icon}" style="color:${color};font-size:13px"></i>
        ${label}
        <span style="color:var(--rule-strong)">·</span>
        ${fmtDateLong(a.startTimeLocal)}
      </div>
      <div class="detail-title">${esc(a.activityName||label)}</div>
      <div class="hero-kpis">
        ${heroKpis.map(k => `<div class="hero-kpi">
          <div class="label">${k.label}</div>
          <div class="val" style="color:${k.color}">${esc(k.val)}</div>
        </div>`).join('')}
      </div>
    </div>
    ${hasMap ? `
    <div id="act-map-container">
      <div id="act-map"></div>
      <div id="act-map-spinner" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--canvas);border-radius:var(--r-md)">
        <div class="spinner"></div>
      </div>
    </div>
    <div id="act-elevation-wrap"><div id="act-elevation-chart"></div></div>` : ''}
    <div id="act-detail-body">
      <div style="display:flex;align-items:center;gap:8px;color:var(--muted)"><div class="spinner"></div> Loading…</div>
    </div>`;

  const [detailResult, gpxResult] = await Promise.allSettled([
    fetch('/api/activities/' + id).then(r => r.json()),
    hasMap ? fetch('/api/activities/' + id + '/gpx').then(r => r.ok ? r.json() : null) : Promise.resolve(null),
  ]);

  const body = document.getElementById('act-detail-body');
  if (body) {
    if (detailResult.status === 'fulfilled') {
      body.innerHTML = buildActivityDetailHTML(a, detailResult.value);
    } else {
      body.innerHTML = `<div style="color:var(--warn);font-size:13px">Failed to load activity detail.</div>`;
    }
  }

  const gpxData = gpxResult?.status === 'fulfilled' ? gpxResult.value : null;
  if (hasMap && gpxData?.points?.length >= 2) {
    requestAnimationFrame(() => initActRouteMap(gpxData.points, sport, color));
  } else if (hasMap) {
    const mapCont = document.getElementById('act-map-container');
    if (mapCont) mapCont.remove();
    const wrap = document.getElementById('act-elevation-wrap');
    if (wrap) wrap.remove();
  }
}

function buildActivityDetailHTML(a, detail) {
  const sport  = normSport(a.activityType?.typeKey);
  const s      = detail.summaryDTO || {};
  const splits = (detail.splitSummaries || []).filter(sp => sp.distance > 0 || sp.duration > 0);
  const meta   = detail.metadataDTO || {};
  const bbDiff = s.differenceBodyBattery ?? a.differenceBodyBattery;

  const metrics = [
    ['Avg HR',        a.averageHR ? Math.round(a.averageHR)+' bpm' : null,      'oklch(65% 0.15 350)'],
    ['Max HR',        a.maxHR ? Math.round(a.maxHR)+' bpm' : null,              'oklch(72% 0.17 55)'],
    ['Min HR',        s.minHR ? Math.round(s.minHR)+' bpm' : null,              'oklch(68% 0.15 235)'],
    ['Avg Power',     (s.averagePower||a.avgPower) ? Math.round(s.averagePower||a.avgPower)+' W' : null, 'oklch(80% 0.17 85)'],
    ['Norm Power',    (s.normalizedPower||a.normPower) ? Math.round(s.normalizedPower||a.normPower)+' W' : null, 'oklch(80% 0.17 85)'],
    ['Max Power',     (s.maxPower||a.maxPower) ? Math.round(s.maxPower||a.maxPower)+' W' : null, 'oklch(72% 0.17 55)'],
    ['Pace',          fmtSpeed(s.averageSpeed||a.averageSpeed, sport) !== '—' ? fmtSpeed(s.averageSpeed||a.averageSpeed, sport) : null],
    ['Max Pace',      fmtSpeed(s.maxSpeed||a.maxSpeed, sport) !== '—' ? fmtSpeed(s.maxSpeed||a.maxSpeed, sport) : null],
    ['Cadence',       (s.averageRunCadence||a.averageRunningCadenceInStepsPerMinute) ? Math.round(s.averageRunCadence||a.averageRunningCadenceInStepsPerMinute)+' spm' : null],
    ['Stride',        (s.strideLength||a.avgStrideLength) ? ((s.strideLength||a.avgStrideLength)/100).toFixed(2)+' m' : null],
    ['Gnd Contact',   (s.groundContactTime||a.avgGroundContactTime) ? Math.round(s.groundContactTime||a.avgGroundContactTime)+' ms' : null],
    ['Vert Osc',      (s.verticalOscillation||a.avgVerticalOscillation) ? (s.verticalOscillation||a.avgVerticalOscillation).toFixed(1)+' cm' : null],
    ['Training Load', (s.activityTrainingLoad||a.activityTrainingLoad) ? Math.round(s.activityTrainingLoad||a.activityTrainingLoad) : null, 'var(--patina-text)'],
    ['Calories',      (s.calories||a.calories) ? (s.calories||a.calories)+' kcal' : null],
    ['Body Battery',  bbDiff != null ? (bbDiff>0?'+':'')+bbDiff : null, bbDiff > 0 ? 'oklch(65% 0.16 145)' : 'oklch(65% 0.18 25)'],
    ['Total Work',    s.totalWork ? s.totalWork.toFixed(1)+' kJ' : null],
    ['Steps',         (s.steps||a.steps) ? (s.steps||a.steps).toLocaleString() : null],
    ['Laps',          meta.lapCount != null ? String(meta.lapCount) : null],
  ].filter(([,v]) => v);

  const metricsHTML = metrics.length ? `
    <div class="section-label" style="margin-bottom:10px">Performance</div>
    <div class="perf-dl">
      ${metrics.map(([l,v,c]) => `<div class="perf-entry">
        <span class="perf-label">${l}</span>
        <span class="perf-val" ${c?`style="color:${c}"`:''}>${esc(v)}</span>
      </div>`).join('')}
    </div>` : '';

  let teHTML = '';
  if (a.aerobicTrainingEffect > 0 || a.anaerobicTrainingEffect > 0) {
    teHTML = `<hr class="detail-rule">
    <div class="section-label" style="margin-bottom:12px">Training Effect</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px">
      ${a.aerobicTrainingEffect > 0 ? `<div class="te-card">
        <div style="font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Aerobic</div>
        <div class="te-score" style="color:oklch(65% 0.16 145)">${a.aerobicTrainingEffect.toFixed(1)}</div>
        <div class="te-lbl">${esc((a.trainingEffectLabel||'').toLowerCase())}</div>
        <div class="te-msg">${esc((a.aerobicTrainingEffectMessage||'').replace(/_/g,' ').toLowerCase())}</div>
      </div>` : ''}
      ${a.anaerobicTrainingEffect > 0 ? `<div class="te-card">
        <div style="font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">Anaerobic</div>
        <div class="te-score" style="color:oklch(80% 0.17 85)">${a.anaerobicTrainingEffect.toFixed(1)}</div>
        <div class="te-msg">${esc((a.anaerobicTrainingEffectMessage||'').replace(/_/g,' ').toLowerCase())}</div>
      </div>` : ''}
    </div>`;
  }

  const hrZones  = HR_ZONES.map((z,i) => ({ ...z, secs: a['hrTimeInZone_'+(i+1)] || 0 }));
  const pwrZones = HR_ZONES.map((z,i) => ({ name:'PZ'+(i+1), color:z.color, secs: a['powerTimeInZone_'+(i+1)] || 0 }));
  const hrTotal  = hrZones.reduce((s,z)=>s+z.secs,0);
  const pwrTotal = pwrZones.reduce((s,z)=>s+z.secs,0);
  const zoneBar  = (z,total) => `<div class="zone-row">
    <span class="zone-name">${z.name}</span>
    <div class="zone-bar-track"><div class="zone-bar-fill" style="width:${total?(z.secs/total*100).toFixed(1):0}%;background:${z.color}"></div></div>
    <span class="zone-time">${fmtTime(z.secs)}</span>
  </div>`;

  let zonesHTML = '';
  if (hrTotal || pwrTotal) {
    zonesHTML = `<hr class="detail-rule">
    <div class="section-label" style="margin-bottom:12px">Zones</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;margin-bottom:24px">
      ${hrTotal  ? `<div><div style="font-size:11px;color:var(--faint);margin-bottom:10px">Heart Rate</div>${hrZones.filter(z=>z.secs>0).map(z=>zoneBar(z,hrTotal)).join('')}</div>` : ''}
      ${pwrTotal ? `<div><div style="font-size:11px;color:var(--faint);margin-bottom:10px">Power</div>${pwrZones.filter(z=>z.secs>0).map(z=>zoneBar(z,pwrTotal)).join('')}</div>` : ''}
    </div>`;
  }

  let splitsHTML = '';
  if (splits.length) {
    const sport2 = normSport(a.activityType?.typeKey);
    splitsHTML = `<hr class="detail-rule">
    <div class="section-label" style="margin-bottom:10px">Intervals &amp; Splits</div>
    <div style="overflow-x:auto;margin-bottom:24px;border:1px solid var(--rule);border-radius:var(--r-sm);background:var(--raised)">
      <table class="splits-table">
        <thead><tr><th>Type</th><th>n</th><th>Dist</th><th>Time</th><th>Pace</th><th>Avg HR</th><th>Max HR</th><th>Avg W</th><th>NP</th><th>Cadence</th><th>Cal</th></tr></thead>
        <tbody>${splits.map(sp => {
          const m = SPLIT_META[sp.splitType] || { label:sp.splitType, color:'oklch(62% 0 0)' };
          return `<tr>
            <td><span class="badge" style="color:${m.color};border-color:${m.color}">${m.label}</span></td>
            <td style="color:var(--muted)">${sp.noOfSplits||1}</td>
            <td>${fmtDist(sp.distance)}</td>
            <td>${fmtTime(sp.movingDuration||sp.duration)}</td>
            <td>${fmtSpeed(sp.averageMovingSpeed||sp.averageSpeed, sport2)}</td>
            <td>${sp.averageHR ? Math.round(sp.averageHR) : '—'}</td>
            <td>${sp.maxHR ? Math.round(sp.maxHR) : '—'}</td>
            <td>${sp.averagePower ? Math.round(sp.averagePower)+'W' : '—'}</td>
            <td>${sp.normalizedPower ? Math.round(sp.normalizedPower)+'W' : '—'}</td>
            <td>${sp.averageRunCadence ? Math.round(sp.averageRunCadence) : '—'}</td>
            <td>${sp.calories||'—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
  }

  const descHTML = a.description ? `<hr class="detail-rule"><div class="desc-block">${esc(a.description)}</div>` : '';

  return metricsHTML + teHTML + zonesHTML + splitsHTML + descHTML;
}

function initActRouteMap(points, sport, color) {
  const container = document.getElementById('act-map');
  if (!container) return;

  const mapStyle = document.documentElement.getAttribute('data-theme') === 'light'
    ? 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'
    : 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

  _actMap = new maplibregl.Map({
    container: 'act-map',
    style: mapStyle,
    center: points[0],
    zoom: 13,
    attributionControl: false,
  });
  _actMap.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  _actMap.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

  _actMap.on('load', () => {
    const spinner = document.getElementById('act-map-spinner');
    if (spinner) spinner.remove();

    const coords = points.map(p => [p[0], p[1]]);
    _actMap.addSource('act-route', {
      type: 'geojson',
      data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } },
    });
    _actMap.addLayer({ id: 'act-route-glow', type: 'line', source: 'act-route',
      paint: { 'line-color': color, 'line-width': 10, 'line-opacity': 0.2, 'line-blur': 8 } });
    _actMap.addLayer({ id: 'act-route-line', type: 'line', source: 'act-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.95 } });

    const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
    _actMap.fitBounds(bounds, { padding: 60, duration: 600 });

    // Start (green) and end (gold) markers
    new maplibregl.Marker({ color: '#22c55e' }).setLngLat(coords[0]).addTo(_actMap);
    new maplibregl.Marker({ color: '#f59e0b' }).setLngLat(coords[coords.length - 1]).addTo(_actMap);

    if (points.some(p => p[2] != null)) buildElevationChart(points);
  });
}

function buildElevationChart(points) {
  const wrap = document.getElementById('act-elevation-wrap');
  const el   = document.getElementById('act-elevation-chart');
  if (!el || !window.Chart) return;

  function haversineMi(a, b) {
    const R = 3958.8, dLat = (b[1]-a[1])*Math.PI/180, dLon = (b[0]-a[0])*Math.PI/180;
    const s = Math.sin(dLat/2)**2 + Math.cos(a[1]*Math.PI/180)*Math.cos(b[1]*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.asin(Math.sqrt(s));
  }

  const labels = [], data = [];
  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) dist += haversineMi(points[i-1], points[i]);
    if (points[i][2] != null) {
      labels.push(dist.toFixed(2));
      data.push(+(points[i][2] * 3.28084).toFixed(0));
    }
  }
  if (data.length < 2) { if (wrap) wrap.remove(); return; }

  _cjsRender(el, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data,
        borderColor: 'oklch(70% 0.12 188)',
        backgroundColor: 'oklch(70% 0.12 188 / 0.15)',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: true,
        tension: 0.3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: {
          ticks: { color: 'oklch(60% 0 0)', font: { size: 10 }, maxTicksLimit: 7,
            callback: (_, i) => labels[i] !== undefined ? labels[i] + ' mi' : '' },
          grid: { color: 'oklch(100% 0 0 / 0.05)' },
          border: { display: false },
        },
        y: {
          ticks: { color: 'oklch(60% 0 0)', font: { size: 10 },
            callback: v => v + ' ft' },
          grid: { color: 'oklch(100% 0 0 / 0.05)' },
          border: { display: false },
        },
      },
    },
  }, 90);
}
