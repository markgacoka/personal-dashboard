'use strict';

// ─── session ──────────────────────────────────────────────────────────────────
// A 401 from the app's API means the session expired or was signed out on
// another device: go to sign-in, and come back to this view afterwards.
// Sign-in's own endpoints (/api/auth) report failures with 401 as well, so
// they're left to their callers.
const _fetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const res = await _fetch(input, init);
  const url = new URL(typeof input === 'string' ? input : input.url, location.href);
  if (res.status === 401 && url.origin === location.origin && url.pathname.startsWith('/api/') && !url.pathname.startsWith('/api/auth/')) {
    location.assign('/login?next=' + encodeURIComponent(location.pathname + location.hash));
  }
  return res;
};

// ─── lazy init flags ──────────────────────────────────────────────────────────
let _fdMap = null;
let _actMap = null;
let _currentView = null;
let _currentFlightId = null;
let _currentActivityId = null;

// ─── theme ────────────────────────────────────────────────────────────────────
let theme = localStorage.getItem('dash-theme') || 'light';
applyTheme(theme);
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.className = 'ph-bold ' + (t === 'dark' ? 'ph-sun' : 'ph-moon');
  // MapLibre base styles (dark-matter / positron) are chosen once at map
  // creation time and don't follow CSS variables, so a theme switch has to
  // explicitly rebuild any map that's currently on screen.
  if (_currentView === 'flight-detail' && _currentFlightId != null) {
    const f = (window._flights||[]).find(fl => String(fl.id) === String(_currentFlightId));
    if (f) { if (_fdMap) { try { _fdMap.remove(); } catch(_) {} _fdMap = null; } requestAnimationFrame(() => initFlightDetailMap(f)); }
  } else if (_currentView === 'activity-detail' && _currentActivityId != null) {
    showActivityDetail(_currentActivityId);
  }
}
document.getElementById('theme-btn').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('dash-theme', theme);
  applyTheme(theme);
  rebuildCharts();
});

// ─── date ─────────────────────────────────────────────────────────────────────
document.getElementById('nav-date').textContent =
  new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

// ─── Chart.js shared config (theme-aware) ────────────────────────────────────
const CJ_FONT = { family: 'Albert Sans, sans-serif', size: 10 };

function getChartCfg() {
  const light = document.documentElement.getAttribute('data-theme') === 'light';
  const gridColor   = light ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.05)';
  const tickColor   = light ? 'rgba(0,0,0,0.42)'   : '#787870';
  const ttBg        = light ? '#f5f2ec'             : '#18180f';
  const ttBorder    = light ? 'rgba(0,0,0,0.10)'   : '#2e2e28';
  const ttTitleClr  = light ? 'rgba(0,0,0,0.40)'   : '#787870';
  const ttBodyClr   = light ? 'rgba(0,0,0,0.75)'   : '#ccccbb';
  const legendClr   = light ? 'rgba(0,0,0,0.48)'   : '#787870';
  return {
    tickColor, legendClr,
    tt: {
      backgroundColor: ttBg, borderColor: ttBorder, borderWidth: 1,
      titleColor: ttTitleClr, bodyColor: ttBodyClr, padding: 8,
      titleFont: CJ_FONT, bodyFont: { ...CJ_FONT, size: 11 },
    },
    scaleX: {
      grid: { display: false },
      ticks: { color: tickColor, font: CJ_FONT, maxRotation: 0, maxTicksLimit: 6 },
      border: { display: false },
    },
    scaleY: {
      grid: { color: gridColor, drawBorder: false, tickLength: 0 },
      ticks: { color: tickColor, font: CJ_FONT, padding: 4 },
      border: { display: false },
    },
  };
}

function _cjsRender(el, config, height = 175) {
  if (!el || !window.Chart) return;
  if (el._cjs) { el._cjs.destroy(); el._cjs = null; }
  el.innerHTML = '';
  el.style.height = height + 'px';
  el.style.position = 'relative';
  const canvas = document.createElement('canvas');
  el.appendChild(canvas);
  el._cjs = new Chart(canvas, config);
}

function rebuildCharts() {
  if (window._actsArr) {
    buildVolumeChart(window._actsArr);
    buildLoadChart(window._actsArr);
    buildHRChart(window._actsArr);
    buildZonesChart(window._actsArr);
  }
  if (_chessData && document.getElementById('chess-rating-chart')) {
    buildChessRatingChart(_chessData[_chessTC]?.recent || []);
  }
  if (window._sleepLatest && document.getElementById('sleep-hypnogram')) {
    buildSleepHypnogram(window._sleepLatest);
  }
  if (window._sleepTrend?.length && document.getElementById('sleep-duration-chart')) {
    buildSleepDurationTrend(window._sleepTrend);
    buildSleepScoreTrend(window._sleepTrend);
    buildSleepStageTrend(window._sleepTrend);
  }
}
