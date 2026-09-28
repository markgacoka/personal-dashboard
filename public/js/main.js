'use strict';

// ─── bootstrap ────────────────────────────────────────────────────────────────
// Each area loads independently, so a slow or failing Garmin sync can't hold
// up the logbook, finances, or chess. The router runs immediately; views that
// need a loaded list (flight/activity detail, edit flight) await these promises.

async function loadFitness() {
  try {
    const [athlete, activities, daily] = await Promise.all([
      fetch('/api/athlete').then(r => r.json()),
      fetch('/api/activities?limit=200').then(r => r.json()),
      fetch('/api/stats/daily').then(r => r.json()).catch(() => ({})),
    ]);

    document.getElementById('nav-name').textContent = athlete.fullName || 'Athlete';
    if (athlete.profileImageUrlSmall) {
      document.getElementById('nav-avatar').innerHTML =
        `<img src="${esc(athlete.profileImageUrlSmall)}" alt="avatar">`;
    }

    window._actsArr = Array.isArray(activities) ? activities : [];
    renderReadiness(window._actsArr, daily || {});
    renderActivities(window._actsArr);
    buildVolumeChart(window._actsArr);
    buildLoadChart(window._actsArr);
    buildHRChart(window._actsArr);
    buildZonesChart(window._actsArr);
  } catch (err) {
    console.error(err);
    document.getElementById('act-list').innerHTML =
      `<div style="padding:40px;text-align:center;color:var(--warn);font-size:13px">Failed to load: ${esc(err.message)}</div>`;
  }
}

window._activitiesReady = loadFitness();

window._flightsReady = loadFlights().catch(() => {
  const lbEl = document.getElementById('logbook-stats');
  lbEl.classList.remove('skel'); lbEl.style.height = '';
  lbEl.innerHTML =
    '<div style="color:var(--muted);font-size:13px;padding:14px">Flight data unavailable — DB not connected</div>';
  document.getElementById('fl-list').innerHTML =
    '<div style="padding:40px;text-align:center;color:var(--muted);font-size:13px">No flight data</div>';
  window._flights = [];
});

loadWeatherWidget();
loadFinanceOverview().catch(() => {});
loadChessData().catch(() => {});

route();
