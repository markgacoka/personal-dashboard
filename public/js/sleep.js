'use strict';

// ─── sleep page ───────────────────────────────────────────────────────────────
const SLEEP_STAGE = {
  0: { name: 'Deep',  color: '#9a80b8' },
  1: { name: 'Light', color: '#5a88c0' },
  2: { name: 'REM',   color: '#d4a520' },
  3: { name: 'Awake', color: '#c04870' },
};

function fmtSleepHM(sec) {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
// dailySleepDTO's "...Local" fields are epoch ms already shifted to local
// time then mislabeled as UTC — read them back with timeZone:'UTC' to
// recover the correct wall-clock time (same convention used elsewhere in
// this app for Garmin data).
function fmtSleepClockLocal(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
}
// sleepLevels' "...GMT" fields are genuine UTC (verified against the exact
// 7h PDT offset between sleepStartTimestampGMT and …Local for the same
// instant) and need a real timezone conversion.
function fmtSleepClockUTC(ms) {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' });
}
function sleepQualClass(q) {
  if (q === 'EXCELLENT' || q === 'GOOD') return 'go';
  if (q === 'FAIR') return 'caut';
  if (q === 'POOR') return 'nogo';
  return 'muted';
}
// sleep.hrvData is a raw per-5-minute time series ({value, startGMT}), not
// a pre-aggregated summary — average it ourselves (mirrors the backend).
function sleepAvgHrv(latest) {
  const vals = (latest?.hrvData || []).map(h => h.value).filter(v => v != null);
  return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
}

async function renderSleepView() {
  const el = document.getElementById('sleep-content');
  el.innerHTML = `<div style="padding:40px;text-align:center"><div class="spinner"></div></div>`;

  const [latestRes, trendRes] = await Promise.allSettled([
    fetch('/api/sleep/latest').then(r => r.ok ? r.json() : null),
    fetch('/api/sleep/trend?days=30').then(r => r.ok ? r.json() : null),
  ]);
  const latest = latestRes.status === 'fulfilled' ? latestRes.value : null;
  const trend  = (trendRes.status === 'fulfilled' ? trendRes.value?.trend : null) || [];
  window._sleepLatest = latest;
  window._sleepTrend  = trend;

  if (_currentView !== 'sleep') return; // stale — user navigated away during fetch

  if (!latest && !trend.some(t => t.duration_sec)) {
    el.innerHTML = `<div class="section-first"><span class="view-subhdr">Sleep</span></div>
      <div class="chart-empty" style="height:auto;padding:60px 20px;margin-top:16px">No sleep data available yet.</div>`;
    return;
  }

  const d = latest?.dailySleepDTO;
  const deepSec = d?.deepSleepSeconds ?? 0, lightSec = d?.lightSleepSeconds ?? 0,
        remSec = d?.remSleepSeconds ?? 0, awakeSec = d?.awakeSleepSeconds ?? 0;
  const stageTotal = (deepSec + lightSec + remSec + awakeSec) || 1;
  const pct = s => Math.round(s / stageTotal * 100);
  const score = d?.sleepScores?.overall?.value ?? null;
  const qual  = d?.sleepScores?.overall?.qualifierKey ?? null;
  const dateLabel = latest?.date
    ? fmtCalDate(latest.date, { weekday: 'long', month: 'short', day: 'numeric' })
    : '';

  const heroCard = !latest ? '' : `
    <div class="ov-card" style="margin-bottom:16px">
      <div class="ov-card-hd">Last Night <span style="font-weight:400;text-transform:none;letter-spacing:0">&middot; ${esc(dateLabel)}</span></div>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:16px">
        <div>
          <div class="fin-nw-amt">${fmtSleepHM(d?.sleepTimeSeconds)}</div>
          <div class="sleep-hero-time">
            <b>${fmtSleepClockLocal(d?.sleepStartTimestampLocal)}</b> &rarr; <b>${fmtSleepClockLocal(d?.sleepEndTimestampLocal)}</b>
          </div>
        </div>
        ${score != null ? `<span class="rd-pill ${sleepQualClass(qual)}"><i class="ph-bold ph-moon-stars"></i>${score} &middot; ${esc((qual||'').charAt(0)+(qual||'').slice(1).toLowerCase())}</span>` : ''}
      </div>
      <div class="sleep-stage-bar">
        <div style="width:${pct(deepSec)}%;background:${SLEEP_STAGE[0].color}"></div>
        <div style="width:${pct(lightSec)}%;background:${SLEEP_STAGE[1].color}"></div>
        <div style="width:${pct(remSec)}%;background:${SLEEP_STAGE[2].color}"></div>
        <div style="width:${pct(awakeSec)}%;background:${SLEEP_STAGE[3].color}"></div>
      </div>
      <div class="sleep-stage-legend">
        <span><i style="background:${SLEEP_STAGE[0].color}"></i>Deep ${pct(deepSec)}% &middot; ${fmtSleepHM(deepSec)}</span>
        <span><i style="background:${SLEEP_STAGE[1].color}"></i>Light ${pct(lightSec)}% &middot; ${fmtSleepHM(lightSec)}</span>
        <span><i style="background:${SLEEP_STAGE[2].color}"></i>REM ${pct(remSec)}% &middot; ${fmtSleepHM(remSec)}</span>
        <span><i style="background:${SLEEP_STAGE[3].color}"></i>Awake ${pct(awakeSec)}% &middot; ${fmtSleepHM(awakeSec)}${d?.awakeCount ? ` (${d.awakeCount}&times;)` : ''}</span>
      </div>
    </div>`;

  const hypnogramCard = !latest?.sleepLevels?.length ? '' : `
    <div class="chart-card" style="margin-bottom:16px">
      <div class="chart-label">Sleep Stages</div>
      <div id="sleep-hypnogram"></div>
    </div>`;

  const vitals = [
    ['Avg HR',   d?.avgHeartRate ? Math.round(d.avgHeartRate) : null, ''],
    ['SpO₂', d?.averageSpO2Value ?? null, '%'],
    ['Resp/min', d?.averageRespirationValue ?? null, ''],
    ['HRV',      sleepAvgHrv(latest), ''],
    ['Stress',   d?.avgSleepStress ?? null, ''],
  ];
  const vitalsCard = !latest ? '' : `
    <div class="ov-card" style="margin-bottom:16px">
      <div class="ov-card-hd">Overnight Vitals</div>
      <div class="sleep-vitals-grid">
        ${vitals.map(([lbl, val, unit]) => `
          <div class="kpi-tile">
            <div class="kpi-big" style="font-size:22px">${val ?? '—'}${val!=null&&unit?`<span style="font-size:12px;font-weight:400;color:var(--faint)">${unit}</span>`:''}</div>
            <div class="kpi-lbl">${esc(lbl)}</div>
          </div>`).join('')}
      </div>
    </div>`;

  const trendSection = !trend.length ? '' : `
    <div class="section-label" style="margin:24px 0 12px">${trend.length}-Day Trends</div>
    <div class="grid-2" style="margin-bottom:16px">
      <div class="chart-card">
        <div class="chart-label">Duration</div>
        <div id="sleep-duration-chart"></div>
      </div>
      <div class="chart-card">
        <div class="chart-label">Sleep Score</div>
        <div id="sleep-score-chart"></div>
      </div>
    </div>
    <div class="chart-card" style="margin-bottom:16px">
      <div class="chart-label">Stage Composition</div>
      <div id="sleep-stage-trend-chart"></div>
    </div>`;

  el.innerHTML = `
    <div class="section-first" style="margin-bottom:16px">
      <span class="view-subhdr">Sleep</span>
    </div>
    ${heroCard}${hypnogramCard}${vitalsCard}${trendSection}
  `;

  if (latest?.sleepLevels?.length) buildSleepHypnogram(latest);
  if (trend.length) { buildSleepDurationTrend(trend); buildSleepScoreTrend(trend); buildSleepStageTrend(trend); }
}

// sleepLevels' "...GMT" strings have no trailing Z ("2026-09-12T09:36:35.0"),
// and a date-time string with no timezone designator parses as LOCAL time
// per spec — even though this field is genuinely UTC (verified against the
// numeric sleepStartTimestampGMT for the same instant). Force UTC parsing.
function parseGMT(s) { return new Date(s.endsWith('Z') ? s : s + 'Z').getTime(); }

function buildSleepHypnogram(latest) {
  const levels = latest.sleepLevels || [];
  if (!levels.length) return;
  const cfg = getChartCfg();
  const t0 = parseGMT(levels[0].startGMT);
  const points = levels.map(s => ({ x: (parseGMT(s.startGMT) - t0) / 60000, y: s.activityLevel }));
  const lastSeg = levels[levels.length - 1];
  points.push({ x: (parseGMT(lastSeg.endGMT) - t0) / 60000, y: lastSeg.activityLevel });

  _cjsRender(document.getElementById('sleep-hypnogram'), {
    type: 'line',
    data: { datasets: [{
      data: points, stepped: true, borderWidth: 2, pointRadius: 0, fill: false,
      segment: { borderColor: ctx => SLEEP_STAGE[ctx.p0.parsed.y]?.color || cfg.tickColor },
    }] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { ...cfg.tt, callbacks: {
          title: items => new Date(t0 + items[0].parsed.x * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }),
          label: c => SLEEP_STAGE[c.parsed.y]?.name || '',
        }},
      },
      scales: {
        x: { ...cfg.scaleX, type: 'linear',
          ticks: { ...cfg.scaleX.ticks, maxTicksLimit: 7,
            callback: v => new Date(t0 + v * 60000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles' }) } },
        y: { ...cfg.scaleY, min: -0.3, max: 3.3,
          // Force exactly the 4 stage ticks — Chart.js's auto-generated
          // "nice number" ticks don't reliably land on 0/1/2/3 once min/max
          // aren't integers, leaving some stage labels blank.
          afterBuildTicks: axis => { axis.ticks = [0, 1, 2, 3].map(v => ({ value: v })); },
          ticks: { ...cfg.scaleY.ticks, callback: v => SLEEP_STAGE[v]?.name || '' } },
      },
    },
  }, 150);
}

function buildSleepDurationTrend(trend) {
  const cfg = getChartCfg();
  _cjsRender(document.getElementById('sleep-duration-chart'), {
    type: 'bar',
    data: {
      labels: trend.map(t => fmtChartDate(t.date, { month: 'short', day: 'numeric' })),
      datasets: [{ label: 'Duration', data: trend.map(t => t.duration_sec ? +(t.duration_sec / 3600).toFixed(2) : null),
        backgroundColor: '#5a88c0c8', borderRadius: 3, maxBarThickness: 14 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { ...cfg.tt, callbacks: {
        label: c => c.raw != null ? fmtSleepHM(c.raw * 3600) : 'No data',
      }}},
      scales: {
        x: { ...cfg.scaleX, ticks: { ...cfg.scaleX.ticks, maxTicksLimit: 8 } },
        y: { ...cfg.scaleY, ticks: { ...cfg.scaleY.ticks, callback: v => v + 'h' } },
      },
    },
  }, 160);
}

function buildSleepScoreTrend(trend) {
  const cfg = getChartCfg();
  _cjsRender(document.getElementById('sleep-score-chart'), {
    type: 'line',
    data: {
      labels: trend.map(t => fmtChartDate(t.date, { month: 'short', day: 'numeric' })),
      datasets: [{ label: 'Score', data: trend.map(t => t.score ?? null),
        borderColor: '#d4a520', backgroundColor: '#d4a52022', fill: true,
        borderWidth: 2, tension: 0.3, pointRadius: 2, pointBackgroundColor: '#d4a520', spanGaps: true }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { ...cfg.tt, callbacks: {
        label: c => c.raw != null ? `Score: ${c.raw}` : 'No data',
      }}},
      scales: {
        x: { ...cfg.scaleX, ticks: { ...cfg.scaleX.ticks, maxTicksLimit: 8 } },
        y: { ...cfg.scaleY, min: 0, max: 100 },
      },
    },
  }, 160);
}

function buildSleepStageTrend(trend) {
  const cfg = getChartCfg();
  const labels = trend.map(t => fmtChartDate(t.date, { month: 'short', day: 'numeric' }));
  const mkDataset = (key, stage) => ({
    label: SLEEP_STAGE[stage].name,
    data: trend.map(t => t[key] != null ? +(t[key] / 3600).toFixed(2) : null),
    backgroundColor: SLEEP_STAGE[stage].color + 'c8', stack: 'stage',
  });
  _cjsRender(document.getElementById('sleep-stage-trend-chart'), {
    type: 'bar',
    data: { labels, datasets: [
      mkDataset('deep_sec', 0), mkDataset('light_sec', 1),
      mkDataset('rem_sec', 2), mkDataset('awake_sec', 3),
    ] },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: {
        legend: { labels: { color: cfg.legendClr, font: CJ_FONT, boxWidth: 8, boxHeight: 8, padding: 10, usePointStyle: true, pointStyle: 'rect' } },
        tooltip: { ...cfg.tt, callbacks: { label: c => c.raw != null ? `${c.dataset.label}: ${fmtSleepHM(c.raw * 3600)}` : null } },
      },
      scales: {
        x: { ...cfg.scaleX, stacked: true, ticks: { ...cfg.scaleX.ticks, maxTicksLimit: 8 } },
        y: { ...cfg.scaleY, stacked: true, ticks: { ...cfg.scaleY.ticks, callback: v => v + 'h' } },
      },
    },
  }, 170);
}
