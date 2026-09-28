'use strict';

// ─── readiness ────────────────────────────────────────────────────────────────
function renderReadiness(activities, daily) {
  const now = Date.now();
  // 7-day sum of Garmin's per-activity training load (Garmin's own computation)
  const acute = Math.round(activities
    .filter(a => now - new Date(a.startTimeLocal).getTime() < 7*86400000)
    .reduce((s,a) => s + (a.activityTrainingLoad||0), 0));

  const d = daily;
  if (d?.date) {
    const el = document.getElementById('data-date');
    const isToday = d.date === new Date().toISOString().slice(0,10);
    el.textContent = isToday ? '' : '· as of '+fmtCalDate(d.date, {month:'short',day:'numeric'});
  }

  const rhr    = d?.heart_rate?.restingHeartRate;
  const avgRhr = d?.heart_rate?.lastSevenDaysAvgRestingHeartRate;
  const rhrDelta = (rhr&&avgRhr) ? rhr-avgRhr : null;

  const sleep    = d?.sleep?.dailySleepDTO;
  const sleepSec = sleep?.sleepTimeSeconds ?? 0;
  const sleepHrs = sleepSec ? (sleepSec/3600).toFixed(1) : null; // raw hours, used for the low/ok threshold below
  const sleepHM  = sleepSec ? `${Math.floor(sleepSec/3600)}h ${Math.round((sleepSec%3600)/60)}m` : null;
  const deepSec  = sleep?.deepSleepSeconds  ?? 0;
  const lightSec = sleep?.lightSleepSeconds ?? 0;
  const remSec   = sleep?.remSleepSeconds   ?? 0;
  const deepPct  = sleepSec ? Math.round(deepSec/sleepSec*100)  : null;
  const lightPct = sleepSec ? Math.round(lightSec/sleepSec*100) : null;
  const remPct   = sleepSec ? Math.round(remSec/sleepSec*100)   : null;

  const sleepScore = sleep?.sleepScores?.overall;  // { value, qualifierKey }
  const sleepQual  = sleepScore?.qualifierKey;      // EXCELLENT / GOOD / FAIR / POOR

  const spo2   = d?.sleep?.wellnessSpO2SleepSummaryDTO?.averageSPO2
              ?? sleep?.averageSpO2Value ?? null;
  const vo2max = d?.vo2max ? Math.round(d.vo2max) : null;

  // Garmin HRV summary
  const hrv       = d?.hrv?.hrvSummary;
  const hrvStatus = hrv?.status ?? null;  // OPTIMAL / BALANCED / UNBALANCED / LOW_POOR_SLEEP / POOR_SLEEP_QUALITY

  // Garmin body battery (from daily summary)
  const bb = d?.daily_summary?.bodyBatteryMostRecentValue ?? null;

  // ── Signal chip helpers ──────────────────────────────────────────────────────
  function sigChip(label, value, cls, color, bg) {
    return `<span class="rdy-sig" style="color:${color};background:${bg};border-color:${color}40">
      <span class="rdy-sig-label">${esc(label)}</span>${esc(value)}
    </span>`;
  }

  // HRV chip
  let hrvChip = '';
  if (hrvStatus) {
    const map = {
      OPTIMAL:           ['Optimal',    'oklch(68% 0.14 155)', 'oklch(68% 0.14 155 / 0.08)'],
      BALANCED:          ['Balanced',   'oklch(68% 0.14 155)', 'oklch(68% 0.14 155 / 0.08)'],
      UNBALANCED:        ['Unbalanced', 'oklch(72% 0.15 70)',  'oklch(72% 0.15 70  / 0.08)'],
      LOW_POOR_SLEEP:    ['Low',        'oklch(68% 0.14 20)',  'oklch(68% 0.14 20  / 0.08)'],
      POOR_SLEEP_QUALITY:['Low',        'oklch(68% 0.14 20)',  'oklch(68% 0.14 20  / 0.08)'],
    };
    const [lbl, col, bg] = map[hrvStatus] ?? [hrvStatus.replace(/_/g,' ').toLowerCase(), 'var(--faint)', 'var(--deep)'];
    hrvChip = sigChip('HRV', lbl, '', col, bg);
  }

  // Sleep quality chip
  let sleepChip = '';
  if (sleepQual) {
    const map = {
      EXCELLENT: ['Excellent', 'oklch(68% 0.14 155)', 'oklch(68% 0.14 155 / 0.08)'],
      GOOD:      ['Good',      'oklch(68% 0.14 155)', 'oklch(68% 0.14 155 / 0.08)'],
      FAIR:      ['Fair',      'oklch(72% 0.15 70)',  'oklch(72% 0.15 70  / 0.08)'],
      POOR:      ['Poor',      'oklch(68% 0.14 20)',  'oklch(68% 0.14 20  / 0.08)'],
    };
    const [lbl, col, bg] = map[sleepQual] ?? ['—', 'var(--faint)', 'var(--deep)'];
    const score = sleepScore?.value ? ` ${sleepScore.value}` : '';
    sleepChip = sigChip('Sleep', lbl + score, '', col, bg);
  }

  // Body battery chip
  let bbChip = '';
  if (bb !== null) {
    const col = bb >= 75 ? 'oklch(68% 0.14 155)' : bb >= 50 ? 'oklch(68% 0.14 235)' : bb >= 25 ? 'oklch(72% 0.15 70)' : 'oklch(68% 0.14 20)';
    const bg  = col.replace(')', ' / 0.08)');
    const lbl = bb >= 75 ? 'High' : bb >= 50 ? 'Moderate' : bb >= 25 ? 'Low' : 'Very Low';
    bbChip = sigChip('Body Battery', `${lbl} ${bb}`, '', col, bg);
  }

  // Acute load chip
  let loadChip = '';
  if (acute) {
    const col = 'oklch(68% 0.14 235)';
    loadChip = sigChip('7-Day Load', String(acute), '', col, col.replace(')', ' / 0.08)'));
  }

  // ── Tile colors ──────────────────────────────────────────────────────────────
  const rhrBigColor = rhrDelta!==null&&rhrDelta>4 ? 'oklch(68% 0.14 20)' : rhrDelta!==null&&rhrDelta>1 ? 'oklch(72% 0.15 70)' : 'var(--champagne)';
  let rhrSignal='', rhrSubColor='var(--faint)';
  if (rhrDelta!==null) {
    if (rhrDelta>4)       { rhrSignal='↑ elevated';          rhrSubColor='oklch(68% 0.14 20)'; }
    else if (rhrDelta>1)  { rhrSignal='↑ slightly elevated'; rhrSubColor='oklch(72% 0.15 70)'; }
    else if (rhrDelta<=-2){ rhrSignal='↓ well recovered';    rhrSubColor='oklch(68% 0.14 155)'; }
    else                  { rhrSignal='at baseline';          rhrSubColor='var(--faint)'; }
  }

  const spo2Color = spo2&&spo2<95 ? 'oklch(68% 0.14 20)' : 'var(--champagne)';
  const spo2Lbl   = spo2&&spo2>=97?'optimal':spo2&&spo2>=95?'normal':spo2?'low':'';

  const vo2Color = vo2max&&vo2max>=55?'oklch(68% 0.14 155)':vo2max&&vo2max>=48?'oklch(68% 0.14 235)':vo2max&&vo2max>=40?'oklch(72% 0.15 70)':'var(--champagne)';
  const vo2Lbl   = vo2max ? (vo2max>=55?'excellent':vo2max>=48?'good':vo2max>=40?'average':'below avg') : '';

  // Phase sub-label: D · L · R  (only show if we have data)
  const phaseSub = (deepPct!==null && lightPct!==null && remPct!==null)
    ? `<span title="Deep">D ${deepPct}%</span> · <span title="Light">L ${lightPct}%</span> · <span title="REM">R ${remPct}%</span>`
    : sleepHrs ? (parseFloat(sleepHrs)<7?'<span style="color:oklch(70% 0.14 70)">low</span>':'ok') : '';

  document.getElementById('readiness-card').innerHTML = `
    <div class="ov-card-hd">Training Readiness</div>

    <div class="rdy-signals">
      ${sleepChip}${hrvChip}${bbChip}${loadChip}
    </div>

    <div class="kpi-tiles">
      <div class="kpi-tile">
        <div class="kpi-big">${sleepHM||'—'}</div>
        <div class="kpi-lbl">Sleep</div>
        <div class="kpi-sub">${phaseSub}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-big" style="color:${vo2Color}">${vo2max||'—'}</div>
        <div class="kpi-lbl">VO₂max</div>
        <div class="kpi-sub">${vo2Lbl}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-big" style="color:${rhrBigColor}">${rhr||'—'}<span style="font-size:14px;font-weight:400;color:var(--faint)"> bpm</span></div>
        <div class="kpi-lbl">RHR</div>
        <div class="kpi-sub" style="color:${rhrSubColor}">${rhrSignal||'—'}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-big" style="color:${spo2Color}">${spo2?Math.round(spo2)+'%':'—'}</div>
        <div class="kpi-lbl">SpO₂</div>
        <div class="kpi-sub">${spo2Lbl}</div>
      </div>
      <div class="kpi-tile">
        <div class="kpi-big">${acute||'—'}</div>
        <div class="kpi-lbl">Acute Score</div>
        <div class="kpi-sub">7-day load</div>
      </div>
    </div>
  `;
}

// ─── weather widget ───────────────────────────────────────────────────────────
async function loadWeatherWidget() {
  const icao = localStorage.getItem('home-airport') || 'KRHV';
  document.getElementById('weather-card').innerHTML =
    `<div class="ov-card-hd">${esc(icao)} Weather</div><div class="skel" style="height:180px;border-radius:6px"></div>`;
  try {
    // Fast fetches — render the card immediately without waiting for NOTAMs
    const [metarRes, airportRes, detailRes, tafRes] = await Promise.allSettled([
      fetch(`/api/external/metar/${encodeURIComponent(icao)}`).then(r=>r.ok?r.json():null),
      fetch(`/api/external/airport/${encodeURIComponent(icao)}`).then(r=>r.ok?r.json():null),
      fetch(`/api/external/airport-detail/${encodeURIComponent(icao)}`).then(r=>r.ok?r.json():{runways:[],frequencies:[]}),
      fetch(`/api/external/taf/${encodeURIComponent(icao)}`).then(r=>r.ok?r.json():{taf:null}),
    ]);
    const metar   = metarRes.value?.metar || null;
    const airport = airportRes.value || null;
    const detail  = detailRes.value || {runways:[], frequencies:[]};
    const taf     = tafRes.value?.taf || null;
    renderWeatherCard(metar, airport, { count: 0, notams: [], loading: true }, icao, detail, taf);
    // NOTAM fetch runs independently — first call may take 30-60 s (Playwright cold start)
    fetch(`/api/external/notam/${encodeURIComponent(icao)}`)
      .then(r => r.ok ? r.json() : { count: 0, notams: [] })
      .then(notamData => renderWeatherCard(metar, airport, notamData || { count: 0, notams: [] }, icao, detail, taf))
      .catch(() => {});
  } catch(_) {
    renderWeatherCard(null, null, {count:0,notams:[]}, icao, {runways:[],frequencies:[]}, null);
  }
}

// runways: [{le_ident, le_hdg, he_ident, he_hdg}] from OurAirports airport-detail
// bestRwyId: identifier of the specific wind-favored runway end (or null)
function windCompassSvg(wdir, wspd, wgst, runways, bestRwyId) {
  const R = 64, size = 168;
  const isCalm = !wspd || wspd < 2;
  const isVRB  = wdir === 'VRB' || wdir == null;

  // ── Tick marks ───────────────────────────────────────────────────────────────
  const ticks = Array.from({length:36}, (_, i) => {
    const a = i * 10 * Math.PI / 180;
    const o = R, inn = i%9===0 ? R-12 : i%3===0 ? R-7 : R-4;
    const sw = i%9===0 ? 1.5 : 0.8;
    return `<line x1="${+(Math.sin(a)*o).toFixed(2)}" y1="${+(-Math.cos(a)*o).toFixed(2)}" x2="${+(Math.sin(a)*inn).toFixed(2)}" y2="${+(-Math.cos(a)*inn).toFixed(2)}" stroke="var(--rule)" stroke-width="${sw}"/>`;
  }).join('');

  // ── Group parallel runways (same canonical heading ±10°) ─────────────────────
  const rwyList = runways || [];
  const assigned = new Set();
  const groups = [];
  for (let i = 0; i < rwyList.length; i++) {
    if (assigned.has(i)) continue;
    const rwy = rwyList[i];
    const canon = ((rwy.le_hdg - 1) % 180 + 180) % 180;
    const group = [{ rwy, i }];
    assigned.add(i);
    for (let j = i + 1; j < rwyList.length; j++) {
      if (assigned.has(j)) continue;
      const other = rwyList[j];
      const otherCanon = ((other.le_hdg - 1) % 180 + 180) % 180;
      const diff = Math.abs(canon - otherCanon);
      if (diff < 12 || diff > 168) { group.push({ rwy: other, i: j }); assigned.add(j); }
    }
    groups.push(group);
  }

  // ── Draw runway rectangles ───────────────────────────────────────────────────
  const rwyElems = [];
  for (const group of groups) {
    const n = group.length;
    group.forEach(({ rwy }, gi) => {
      const perpOff = n > 1 ? (gi - (n - 1) / 2) * 17 : 0;
      const drawHdg = rwy.he_hdg;   // rotate so top = he_end, bottom = le_end
      const rLen    = R - 9;
      // Match by the specific favored end's identifier, not heading — parallel
      // runways share headings, so a heading match would highlight both.
      const isBest  = (rwy.le_ident === bestRwyId || rwy.he_ident === bestRwyId);
      const fill    = isBest ? 'oklch(23% 0.07 80)'  : 'oklch(15% 0.02 95)';
      const stroke  = isBest ? 'oklch(62% 0.14 82)'  : 'oklch(30% 0.03 95)';
      const sw      = isBest ? 1.8 : 0.9;
      const heNum   = Math.round(rwy.he_hdg / 10).toString().padStart(2, '0');
      const leNum   = Math.round(rwy.le_hdg / 10).toString().padStart(2, '0');
      rwyElems.push(
        `<g transform="rotate(${drawHdg}) translate(${perpOff} 0)">` +
        `<rect x="-6" y="${-rLen}" width="12" height="${rLen*2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" rx="2"/>` +
        (isBest ? `<line x1="0" y1="${-rLen}" x2="0" y2="${rLen}" stroke="${stroke}" stroke-width="0.7" stroke-dasharray="5 3"/>` : '') +
        `<text y="${-rLen-7}" text-anchor="middle" fill="${stroke}" font-size="9" font-weight="600" font-family="Albert Sans,sans-serif">${heNum}</text>` +
        `<text y="${rLen+15}" text-anchor="middle" fill="${stroke}" font-size="9" font-weight="600" font-family="Albert Sans,sans-serif">${leNum}</text>` +
        `</g>`
      );
    });
  }

  // ── Wind indicator ───────────────────────────────────────────────────────────
  let windEl;
  if (isCalm) {
    windEl = `<circle r="8" fill="none" stroke="oklch(65% 0.14 145)" stroke-width="2.5"/>` +
             `<circle r="3.5" fill="oklch(65% 0.14 145)"/>`;
  } else if (isVRB) {
    windEl = [0,90,180,270].map(a =>
      `<g transform="rotate(${a})"><line x1="0" y1="24" x2="0" y2="-26" stroke="var(--muted)" stroke-width="1.8" stroke-linecap="round"/><polygon points="0,-34 -5,-25 5,-25" fill="var(--muted)"/></g>`
    ).join('');
  } else {
    windEl = `<g transform="rotate(${wdir})">` +
      `<line x1="0" y1="14" x2="0" y2="-40" stroke="white" stroke-width="2.8" stroke-linecap="round"/>` +
      `<polygon points="0,-52 -8,-38 8,-38" fill="white"/>` +
      (wgst ? `<circle r="5" cx="0" cy="19" fill="none" stroke="oklch(78% 0.14 75)" stroke-width="1.8"/>` : '') +
      `</g>`;
  }

  const spd = isCalm
    ? `<text text-anchor="middle" y="5" fill="oklch(65% 0.14 145)" font-size="11" font-family="Albert Sans,sans-serif">calm</text>`
    : `<text text-anchor="middle" y="4" fill="white" font-size="16" font-weight="700" font-family="Albert Sans,sans-serif">${wspd}</text>` +
      `<text text-anchor="middle" y="18" fill="var(--faint)" font-size="10" font-family="Albert Sans,sans-serif">kt${wgst ? ' G'+wgst : ''}</text>`;

  return `<svg width="${size}" height="${size}" viewBox="${-size/2} ${-size/2} ${size} ${size}" style="overflow:visible;flex-shrink:0">
    <circle r="${R}" fill="none" stroke="var(--rule)" stroke-width="1.5"/>
    ${ticks}
    <text text-anchor="middle" y="${-R-9}" fill="var(--muted)" font-size="11" font-weight="600" font-family="Albert Sans,sans-serif">N</text>
    <text text-anchor="middle" y="${R+17}" fill="var(--muted)" font-size="11" font-weight="600" font-family="Albert Sans,sans-serif">S</text>
    <text x="${-R-13}" y="4" text-anchor="middle" fill="var(--muted)" font-size="11" font-weight="600" font-family="Albert Sans,sans-serif">W</text>
    <text x="${R+13}" y="4" text-anchor="middle" fill="var(--muted)" font-size="11" font-weight="600" font-family="Albert Sans,sans-serif">E</text>
    ${rwyElems.join('')}
    <circle r="24" fill="oklch(9% 0.002 95 / 0.88)"/>
    ${windEl}
    ${spd}
  </svg>`;
}

function parseMetarObsTime(rawOb) {
  const m = rawOb?.match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
  if (!m) return null;
  const now = new Date();
  const obs = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), +m[1], +m[2], +m[3]));
  if (obs > now) obs.setUTCMonth(obs.getUTCMonth()-1);
  return obs;
}

function renderWeatherCard(metar, airport, notamData, icao, detail, taf) {
  const el = document.getElementById('weather-card');
  const runways = detail?.runways || [];

  // ── Airport header info ─────────────────────────────────────────────────────
  const aptName = airport?.name || icao;
  const aptCity = airport ? `${airport.city || ''}, ${airport.state || ''}`.replace(/^, |, $/g,'') : '';
  const aptElev = airport?.elev != null ? `${airport.elev} ft MSL` : '';
  const aptMeta = [aptCity, aptElev].filter(Boolean).join(' · ');

  if (!metar) {
    el.innerHTML = `
      <div class="ov-card-hd">${esc(icao)} Weather <button onclick="editHomeAirport()" style="font-size:11px;color:var(--faint);background:none;border:none;cursor:pointer;padding:0;font-family:inherit;margin-left:auto"><i class="ph-bold ph-pencil-simple"></i> edit</button></div>
      <div class="wx-header"><div class="wx-header-left"><div class="wx-airport">${esc(aptName)}</div><div class="wx-airport-meta">${esc(aptMeta)}</div></div></div>
      <div style="color:var(--faint);font-size:13px;padding:8px 0">Weather data unavailable</div>`;
    return;
  }

  // ── Parse METAR fields ──────────────────────────────────────────────────────
  const raw      = metar.rawOb || metar.raw || '';
  const cat      = (metar.fltcat||'').toUpperCase() || 'VFR';
  const wdir     = metar.wdir;
  const wspd     = metar.wspd || 0;
  const wgst     = metar.wgst || null;
  const vis      = metar.visib;
  const ceil     = metar.ceil;
  const temp     = metar.temp;
  const dewp     = metar.dewp;
  const altimHpa = metar.altim;
  const altimInhg = altimHpa ? (altimHpa / 33.8639).toFixed(2) : null;

  // Obs time from rawOb (AWC obsTime field is not a reliable ISO string)
  const obsDate = parseMetarObsTime(raw) || (metar.obsTime ? new Date(metar.obsTime) : null);
  let ageStr = '';
  if (obsDate && !isNaN(obsDate)) {
    const mins = Math.round((Date.now() - obsDate.getTime()) / 60000);
    ageStr = mins < 2 ? 'just now' : mins < 60 ? `${mins} min ago` : `${Math.round(mins/60)}h ago`;
  }

  // ── Best runway & wind components ──────────────────────────────────────────
  let xwind = null, headwind = null, bestRwyId = null, bestHdg = null;
  if (typeof wdir === 'number' && wspd && runways.length) {
    let bestScore = -Infinity;
    for (const rwy of runways) {
      for (const [hdg, ident] of [[rwy.le_hdg, rwy.le_ident], [rwy.he_hdg, rwy.he_ident]]) {
        if (!hdg) continue;
        const a   = ((wdir - hdg) % 360 + 360) % 360;
        const rad = a * Math.PI / 180;
        const hw  = Math.round(wspd * Math.cos(rad));
        const xw  = Math.round(Math.abs(wspd * Math.sin(rad)));
        const score = hw - xw * 0.5;
        if (score > bestScore) {
          bestScore = score; bestHdg = hdg; bestRwyId = ident; xwind = xw; headwind = hw;
        }
      }
    }
  } else if (typeof wdir === 'number' && wspd) {
    // No runway data — just report raw wind, no crosswind analysis
  }

  // ── Density altitude ────────────────────────────────────────────────────────
  let da = null;
  if (airport?.elev != null && altimHpa && temp != null) {
    const aIhg = altimHpa / 33.8639;
    const pa   = airport.elev + (29.92 - aIhg) * 1000;
    const isa  = 15 - 2 * (pa / 1000);
    da = Math.round(pa + 118.8 * (temp - isa));
  }

  // ── Go/No-Go verdict ────────────────────────────────────────────────────────
  const xwindHigh = xwind !== null && xwind > 10;
  const gusty     = wgst && wgst > 20;
  let verdict, verdictClass, verdictReasons = [];
  if (cat === 'LIFR' || cat === 'IFR') {
    verdict = 'NO-GO'; verdictClass = 'nogo';
    verdictReasons.push(cat);
  } else if (cat === 'MVFR' || xwindHigh || gusty) {
    verdict = 'CAUTION'; verdictClass = 'caut';
    if (cat === 'MVFR')  verdictReasons.push('MVFR');
    if (xwindHigh)       verdictReasons.push(`${xwind} kt xwind`);
    if (gusty)           verdictReasons.push(`gust ${wgst} kt`);
  } else {
    verdict = 'GO'; verdictClass = 'go';
  }
  const verdictSub = verdictReasons.length ? `<span style="font-size:10px;font-weight:400;opacity:0.8;margin-left:4px">${verdictReasons.join(' · ')}</span>` : '';

  // ── Formatted strings ───────────────────────────────────────────────────────
  const windLine  = wdir === 'VRB'         ? `Variable ${wspd} kt`
                  : typeof wdir==='number' ? `${String(wdir).padStart(3,'0')}° at ${wspd} kt${wgst ? ` · gust ${wgst} kt` : ''}`
                  : wspd === 0             ? 'Calm' : '—';
  const xwindLine = xwind !== null
    ? `${xwind} kt crosswind${bestRwyId ? ` (rwy ${bestRwyId})` : ''} · ${Math.abs(headwind)} kt ${headwind>=0?'headwind':'tailwind'}`
    : '';
  const visLine    = vis ? (String(vis)==='10+'?'10+ SM':`${vis} SM`) : '—';
  const ceilLine   = ceil ? `${ceil.toLocaleString()} ft AGL` : cat === 'VFR' ? 'Clear / Unlimited' : '—';
  const spreadVal  = temp != null && dewp != null ? temp - dewp : null;
  const spreadLine = spreadVal != null
    ? `${temp}° / ${dewp}° C · ${spreadVal}° spread${spreadVal <= 3 ? ' · fog risk' : ''}` : '—';
  const altLine    = altimInhg ? `${altimInhg} inHg (${Math.round(altimHpa)} hPa)` : '—';
  const daLine     = da != null
    ? `${(da - (airport?.elev||0)) >= 0 ? '+' : ''}${(da - (airport?.elev||0)).toLocaleString()} ft above field (${da.toLocaleString()} ft)` : '—';
  const obsLine    = obsDate && !isNaN(obsDate)
    ? (() => {
        const d = obsDate;
        const dd = String(d.getUTCDate()).padStart(2,'0');
        const hh = String(d.getUTCHours()).padStart(2,'0');
        const mm = String(d.getUTCMinutes()).padStart(2,'0');
        const mon = d.toLocaleDateString('en-US',{month:'short',timeZone:'UTC'});
        return `${mon} ${dd} ${hh}:${mm}Z${ageStr?` · ${ageStr}`:''}`;
      })()
    : '—';

  // ── Runway summary for the airport column ───────────────────────────────────
  // Match by the specific favored END's identifier, not by heading — parallel
  // runways (e.g. 13L/31R and 13R/31L) share the same headings, so a
  // heading-equality check flagged every parallel runway as "best" even
  // though only one specific end is actually the wind-favored one.
  const rwyRows = runways.map(rwy => {
    const bestEnd = rwy.le_ident === bestRwyId ? rwy.le_ident : rwy.he_ident === bestRwyId ? rwy.he_ident : null;
    const isBest  = bestEnd != null;
    const rwyName = `${rwy.le_ident}/${rwy.he_ident}`;
    const rwyLen  = rwy.length_ft ? `${rwy.length_ft.toLocaleString()} ft` : '';
    const rwyInfo = [rwyLen, rwy.surface?.split('-')[0]].filter(Boolean).join(' · ');
    return `<div class="wx-row" style="${isBest?'color:oklch(68% 0.12 82)':''}">` +
      `<span class="wx-lbl" style="${isBest?'color:oklch(60% 0.12 82)':''}">Rwy ${esc(rwyName)}</span>` +
      `<span class="wx-val">${rwyInfo || '—'}${isBest?` <span style="color:oklch(62% 0.14 82);font-weight:600">← ${esc(bestEnd)} favored</span>`:''}</span></div>`;
  }).join('');

  // ── Radio frequencies (priority: ATIS/AWOS, then TWR/CTAF, then GND) ───────
  const freqOrder = ['ATIS','AWOS','ASOS','A/G','TWR','CTAF','GND','APP','DEP','CLD'];
  const shownFreqs = (detail?.frequencies || [])
    .filter(f => freqOrder.includes(f.type))
    .sort((a,b) => freqOrder.indexOf(a.type) - freqOrder.indexOf(b.type))
    .slice(0, 5);
  const freqRows = shownFreqs.map(f =>
    `<div class="wx-row"><span class="wx-lbl">${esc(f.type)}</span>` +
    `<span class="wx-val" style="font-size:12px;font-variant-numeric:tabular-nums">${esc(f.freq_mhz)} MHz</span></div>`
  ).join('');

  // ── NOTAM inline list ────────────────────────────────────────────────────────
  const nCount = notamData?.count || 0;
  const notams = notamData?.notams || [];
  const notamLoading = notamData?.loading === true;
  const notamUnavailable = notamData?.unavailable === true;

  // Categorical grouping onto the shared semantic tokens (danger/info/warning/neutral)
  // instead of one-off literal colors, so this badge themes correctly in light mode too.
  const NOTAM_TYPE_CAT = {
    TFR: 'danger', FDC: 'danger',
    IAP: 'info', ODP: 'info', NAV: 'info', COM: 'info', N: 'info',
    RWY: 'warning', TWY: 'warning', OBST: 'warning', D: 'warning',
    SVC: 'neutral', O: 'neutral',
  };
  const NOTAM_TYPE_LABEL = {
    IAP:'Approach', ODP:'Departure', TFR:'Flight Restriction', FDC:'Regulatory',
    RWY:'Runway', TWY:'Taxiway', OBST:'Obstacle', COM:'Communications',
    SVC:'Service', NAV:'Navaid', AD:'Aerodrome', PROCEDURE:'Procedure',
    STAR:'Arrival', D:'General', N:'Local', O:'Other',
  };
  function notamTypeClass(t) { return 'wx-notam-type--' + (NOTAM_TYPE_CAT[(t||'').toUpperCase()] || 'neutral'); }
  function notamTypeLabel(t) {
    const k = (t||'').toUpperCase();
    return NOTAM_TYPE_LABEL[k] || (k.slice(0,8) || '—');
  }

  // Extract E) free-text section from ICAO NOTAM body
  function notamESection(raw) {
    if (!raw) return '';
    const m = raw.match(/\bE\)\s+([\s\S]*?)(?=\n[A-GQ]\)|$)/);
    if (m) return m[1].trim();
    // No field codes found — strip any leading single-letter field lines
    return raw.replace(/^[QABCDEFG]\)[ \t].*\n?/gm, '').trim() || raw.trim();
  }

  // Expand the most impactful all-caps NOTAM abbreviations
  const _NR = [
    [/\bRWYS\b/g,'Runways'], [/\bRWY\b/g,'Runway'],
    [/\bTWYS\b/g,'Taxiways'], [/\bTWY\b/g,'Taxiway'],
    [/\bACFT\b/g,'aircraft'], [/\bACFTS\b/g,'aircraft'],
    [/\bCLSD\b/g,'CLOSED'], [/\bOBSTS?\b/g,'obstacle'],
    [/\bTEMP\b/g,'temporary'], [/\bPERM\b/g,'permanent'],
    [/\bLGT\b/g,'lighting'], [/\bLGTD\b/g,'lighted'],
    [/\bOPS\b/g,'operations'], [/\bSVC\b/g,'service'],
    [/\bUNAVBL\b/g,'unavailable'], [/\bAVBL\b/g,'available'],
    [/\bUNMON\b/g,'unmonitored'], [/\bFREQ\b/g,'frequency'],
    [/\bDER\b/g,'departure end of runway'], [/\bAMDT\b/g,'amendment'],
    [/\bORIG\b/g,'original'], [/\bCOMS?\b/g,'communications'],
    [/\bNOT AUTH\b/g,'not authorized'], [/\bEQPD\b/g,'equipped'],
    [/\bOUT OF SVC\b/g,'out of service'], [/\bWIP\b/g,'work in progress'],
    [/\bCATS\b/g,'categories'], [/\bINFO\b/g,'information'],
    [/\bPPR\b/g,'prior permission required'],
    [/\bAPCH\b/g,'approach'], [/\bDEP\b/g,'departure'],
    [/\bHDG\b/g,'heading'], [/\bALT\b/g,'altitude'],
    [/\bMINM\b/g,'minimum'], [/\bMAXM\b/g,'maximum'],
    [/\bAD\b/g,'aerodrome'], [/\bARP\b/g,'aerodrome reference point'],
    [/\bEXCPT\b/g,'except'], [/\bEXCEPT\b/g,'except'],
    [/\bAPPROX\b/g,'approximately'],
    // Standalone NA = not authorized (avoid matching NAV, NOTAM, etc.)
    [/(?<=[,.\s]|^)NA(?=[,.\s]|$)/gm,'not authorized'],
  ];
  function notamExpand(text) {
    let t = text;
    for (const [re, rep] of _NR) t = t.replace(re, rep);
    return t;
  }

  // Format "MM/DD/YYYY HHMM[tz]" → "Mon DD, YYYY HH:MMZ"
  function fmtNotamDate(s) {
    if (!s || s === 'PERM') return null;
    const est = /EST\s*$/i.test(s);
    const m = String(s).match(/^(\d{1,2})\/(\d{2})\/(\d{4})\s+(\d{2})(\d{2})/);
    if (!m) return String(s);
    const mo = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[+m[1]-1];
    return `${mo} ${+m[2]}, ${m[3]} ${m[4]}:${m[5]}Z${est ? ' (est.)' : ''}`;
  }

  const notamHtml = notamLoading
    ? `<div style="font-size:11px;color:var(--faint);padding:6px 0">Fetching NOTAMs…</div>`
    : notamUnavailable
    ? `<div style="font-size:11px;color:var(--faint);padding:6px 0">Unavailable — <a href="https://notams.aim.faa.gov/notamSearch/nsapp.html" target="_blank" rel="noopener" style="color:var(--muted)">Search ${esc(icao)} →</a></div>`
    : notams.length
      ? notams.map(n => {
          const body = notamExpand(notamESection(n.text));
          const exp  = fmtNotamDate(n.endDate);
          return `<div class="wx-notam-item">
            <div class="wx-notam-hdr">
              <span class="wx-notam-type ${notamTypeClass(n.type)}">${esc(notamTypeLabel(n.type))}</span>
              ${n.id ? `<span class="wx-notam-id">${esc(n.id)}</span>` : ''}
              ${exp ? `<span class="wx-notam-exp">expires ${esc(exp)}</span>` : ''}
            </div>
            <span class="wx-notam-txt">${esc(body)}</span>
          </div>`;
        }).join('')
      : `<div style="font-size:11px;color:var(--faint);padding:6px 0">No active NOTAMs</div>`;

  // ── TAF inline ───────────────────────────────────────────────────────────────
  function fmtTafTime(iso) {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit', hour12:true }).replace(',','');
    } catch { return iso; }
  }
  const tafFcstsHtml = taf?.fcsts?.length
    ? taf.fcsts.map(f => {
        const parts = [];
        if (f.wdir != null && f.wspd != null) parts.push(`Wind ${typeof f.wdir==='number'?String(f.wdir).padStart(3,'0'):f.wdir}° ${f.wspd}kt${f.wgst?` G${f.wgst}kt`:''}`);
        if (f.visib)  parts.push(`Vis ${f.visib} SM`);
        if (f.clouds) parts.push(f.clouds);
        if (f.wx)     parts.push(f.wx);
        if (f.fltcat) parts.push(f.fltcat);
        return `<div class="wx-taf-fcst">
          <span class="wx-taf-type">${esc(f.type||'FM')}</span>
          <span class="wx-taf-body">${esc(parts.join(' · ') || '—')}</span>
          <span class="wx-taf-time">${esc(fmtTafTime(f.from))}${f.to?` – ${esc(fmtTafTime(f.to))}`:''}</span>
        </div>`;
      }).join('')
    : (taf?.raw ? `<div class="wx-raw-taf">${esc(taf.raw)}</div>` : `<div class="chart-empty" style="height:auto;padding:6px 0;justify-content:flex-start">TAF not available</div>`);
  const tafCountBadge = taf?.fcsts?.length ? `<span class="wx-count-badge">${taf.fcsts.length}</span>` : '';

  // ── Compass SVG (multi-runway) ───────────────────────────────────────────────
  const compass = windCompassSvg(wdir, wspd, wgst, runways, bestRwyId);

  el.innerHTML = `
    <div class="ov-card-hd" style="display:flex;align-items:center">
      <span>Airport Brief</span>
      <button onclick="editHomeAirport()" style="font-size:11px;color:var(--faint);background:none;border:none;cursor:pointer;padding:0;font-family:inherit;margin-left:auto;letter-spacing:0;text-transform:none"><i class="ph-bold ph-pencil-simple"></i> ${esc(icao)}</button>
    </div>

    <div class="wx-header">
      <div class="wx-header-left">
        <div class="wx-airport">${esc(aptName)}</div>
        <div class="wx-airport-meta">${esc(aptMeta)}</div>
        <div class="wx-pills">
          <span class="wx-verdict ${verdictClass}"><i class="ph-bold ph-${verdict==='GO'?'check-circle':verdict==='CAUTION'?'warning-circle':'x-circle'}"></i> ${verdict}${verdictSub}</span>
          <span class="wx-cat-pill ${cat}">${cat}</span>
        </div>
      </div>
    </div>

    <div class="wx-body">
      <!-- Column 1: Multi-runway wind compass -->
      <div class="wx-col" style="display:flex;flex-direction:column;align-items:center;gap:12px">
        ${compass}
        <div style="text-align:center;line-height:1.6">
          <div style="font-size:13px;color:var(--body-text);font-weight:500">${windLine}</div>
          ${xwindLine?`<div class="wx-sub" style="font-size:12px;margin-top:2px">${xwindLine}</div>`:''}
        </div>
      </div>

      <!-- Column 2: Sky conditions -->
      <div class="wx-col">
        <div class="wx-col-title">Conditions</div>
        <div class="wx-row"><span class="wx-lbl">Observed</span><span class="wx-val">${obsLine}</span></div>
        <div class="wx-row"><span class="wx-lbl">Ceiling</span><span class="wx-val">${ceilLine}</span></div>
        <div class="wx-row"><span class="wx-lbl">Visibility</span><span class="wx-val">${visLine}</span></div>
        <div class="wx-row"><span class="wx-lbl">Temp / DP</span><span class="wx-val">${spreadLine}</span></div>
        <div class="wx-row"><span class="wx-lbl">Altimeter</span><span class="wx-val">${altLine}</span></div>
        <div class="wx-row"><span class="wx-lbl">Density Alt</span><span class="wx-val">${daLine}</span></div>
      </div>

      <!-- Column 3: Airport info (runways + frequencies) -->
      <div class="wx-col">
        <div class="wx-col-title">Airport</div>
        ${airport?.elev!=null?`<div class="wx-row"><span class="wx-lbl">Elevation</span><span class="wx-val">${airport.elev} ft MSL</span></div>`:''}
        ${rwyRows}
        ${freqRows ? `<div class="wx-col-title" style="margin-top:10px">Radio</div>${freqRows}` : ''}
        <div class="wx-links-row">
          <a class="wx-ext-link" href="https://www.airnav.com/airport/${esc(icao)}" target="_blank" rel="noopener"><i class="ph-bold ph-link-simple"></i> AirNav</a>
          <a class="wx-ext-link" href="https://skyvector.com/airport/${esc(icao)}" target="_blank" rel="noopener"><i class="ph-bold ph-link-simple"></i> SkyVector</a>
          <a class="wx-ext-link" href="https://tfr.faa.gov/tfr2/list.jsp" target="_blank" rel="noopener"><i class="ph-bold ph-link-simple"></i> TFRs</a>
        </div>
      </div>
    </div>

    <!-- Inline TAF -->
    <div style="margin-top:12px;border-top:1px solid var(--rule);padding-top:2px">
      <div class="wx-inline-hdr"><i class="ph-bold ph-cloud"></i> Forecast (TAF) ${tafCountBadge}</div>
      ${tafFcstsHtml}
    </div>

    <!-- Inline NOTAMs -->
    <div style="margin-top:4px">
      <div class="wx-inline-hdr"><i class="ph-bold ph-warning"></i> NOTAMs / TFRs <span class="wx-count-badge">${nCount > 0 ? nCount : 0}</span>${nCount > 30 ? `<span style="font-size:10px;color:var(--faint);letter-spacing:0;text-transform:none">(showing 30)</span>` : ''}</div>
      ${notamHtml}
    </div>

    ${raw?`<div class="wx-footer"><div class="wx-raw">${esc(raw)}</div></div>`:''}
  `;
}

function editHomeAirport() {
  const cur = localStorage.getItem('home-airport') || 'KRHV';
  const val = prompt('Home airport ICAO (3–4 characters):', cur);
  if (val && /^[A-Za-z0-9]{3,4}$/.test(val.trim())) {
    localStorage.setItem('home-airport', val.trim().toUpperCase());
    loadWeatherWidget();
  }
}
