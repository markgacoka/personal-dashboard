'use strict';

// ─── Chess ───────────────────────────────────────────────────────────────────
let _chessData = null
let _chessTC   = 'rapid'

async function loadChessData() {
  try {
    const data = await fetch('/api/chess/stats').then(r => r.ok ? r.json() : Promise.reject(r))
    _chessData = data
    renderChessOverview(data)
  } catch (_) {
    const el = document.getElementById('chess-overview-card')
    el.innerHTML = `<div class="ov-card-hd">Chess</div><div style="font-size:12px;color:var(--faint);padding:4px 0">Stats unavailable</div>`
    el.classList.remove('skel')
  }
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

function renderChessOverview(d) {
  const el = document.getElementById('chess-overview-card')
  if (!el) return
  el.classList.remove('skel')

  const now = new Date()
  const monthLabel = MONTH_NAMES[now.getMonth()].slice(0, 3)
  const tm = d.rapid.thisMonth
  const delta = (tm.ratingEnd != null && tm.ratingStart != null) ? tm.ratingEnd - tm.ratingStart : null
  const deltaStr = delta === null ? '' : delta >= 0 ? `↑${delta}` : `↓${Math.abs(delta)}`
  const deltaCol = delta === null ? 'var(--faint)' : delta >= 0 ? 'var(--patina-text)' : 'oklch(58% 0.20 15)'
  const winPct = tm.count > 0 ? Math.round((tm.win / tm.count) * 100) : 0

  el.innerHTML = `
    <div class="ov-card-hd">Chess
      <button onclick="navigate('chess')">Full view →</button>
    </div>
    <div class="ch-ov">
      <div class="ch-ov-left">
        <div class="ch-ov-num">${d.rapid.current ?? '—'}</div>
        <div class="ch-ov-lbl">Rapid</div>
        <div class="ch-ov-delta" style="color:${deltaCol}">${deltaStr} ${monthLabel} &middot; Tactics best ${d.tactics.highest ?? '—'}</div>
      </div>
      <div class="ch-ov-right">
        <div class="ch-ov-month">${monthLabel} &middot; ${tm.count} games</div>
        <div class="ch-ov-wld">
          <span class="ch-w">W ${tm.win}</span>
          <span class="ch-l">L ${tm.loss}</span>
          <span class="ch-d">D ${tm.draw}</span>
        </div>
        <div class="ch-ov-sub">${winPct}% win rate &middot; ${esc(d.league ?? '')} league</div>
      </div>
    </div>
  `
}

function setChessTC(tc) {
  _chessTC = tc
  if (_chessData) buildChessTCContent(_chessData, tc)
}

function buildChessRatingChart(recent) {
  const el = document.getElementById('chess-rating-chart')
  if (!el || !window.Chart) return
  const games = (recent || []).filter(g => g.rating)
  if (games.length < 2) {
    el.innerHTML = '<div style="padding:20px;color:var(--faint);font-size:12px">Not enough games to plot trend</div>'
    return
  }
  const cfg = getChartCfg()
  const labels = games.map(g => new Date(g.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  const ratings = games.map(g => g.rating)
  // patina-text (teal) matches the Rapid chip; oklch alpha syntax avoids the hex-append bug
  const lineClr = 'oklch(76% 0.088 190)'
  const fillClr = 'oklch(76% 0.088 190 / 0.12)'
  _cjsRender(el, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Rating',
        data: ratings,
        borderColor: lineClr,
        backgroundColor: fillClr,
        pointBackgroundColor: lineClr,
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.3,
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: { ...cfg.tt,
          callbacks: {
            label: c => `Rating: ${c.raw}`,
            title: items => labels[items[0]?.dataIndex] || '',
          }
        },
      },
      scales: {
        x: { ...cfg.scaleX, ticks: { ...cfg.scaleX.ticks, maxTicksLimit: 8, maxRotation: 0 } },
        y: { ...cfg.scaleY, ticks: { ...cfg.scaleY.ticks, callback: v => v } },
      }
    }
  }, 200)
}

function buildChessTCContent(d, tc) {
  const container = document.getElementById('chess-tc-content')
  if (!container) return

  const tc_d = d[tc]
  const now   = new Date()

  function monthName(offset) {
    const dt = new Date(now.getFullYear(), now.getMonth() - offset, 1)
    return MONTH_NAMES[dt.getMonth()].slice(0, 3) + ' ' + dt.getFullYear()
  }
  function deltaHtml(m) {
    const v = (m.ratingEnd != null && m.ratingStart != null) ? m.ratingEnd - m.ratingStart : null
    if (v === null) return '<span style="color:var(--faint)">—</span>'
    return v >= 0
      ? `<span style="color:var(--patina-text)">↑ ${v}</span>`
      : `<span style="color:oklch(58% 0.20 15)">↓ ${Math.abs(v)}</span>`
  }
  function winPct(m) { return m.count > 0 ? Math.round((m.win / m.count) * 100) : 0 }

  const tm = tc_d.thisMonth, lm = tc_d.lastMonth
  const tcLabel = tc === 'rapid' ? 'Rapid' : 'Blitz'

  const heroDelta = (tm.ratingEnd != null && tm.ratingStart != null) ? tm.ratingEnd - tm.ratingStart : null
  const heroDeltaStr = heroDelta === null ? '—' : heroDelta >= 0 ? `↑ ${heroDelta}` : `↓ ${Math.abs(heroDelta)}`
  const heroDeltaCol = heroDelta === null ? 'var(--faint)' : heroDelta >= 0 ? 'var(--patina-text)' : 'oklch(58% 0.20 15)'

  const recentHtml = !(tc_d.recent?.length)
    ? '<div class="act-summary" style="color:var(--faint);font-size:12px">No games this month</div>'
    : tc_d.recent.slice().reverse().map(g => {
        const dt = new Date(g.ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const colorPiece = g.color === 'w' ? '♔' : '♚'
        const lcol = g.result === 'W' ? 'var(--patina-text)' : g.result === 'L' ? 'oklch(58% 0.20 15)' : 'var(--rule-strong)'
        const iconBg = g.result === 'W' ? 'oklch(76% 0.088 190 / 0.15)' : g.result === 'L' ? 'oklch(58% 0.20 15 / 0.12)' : 'var(--graphite)'
        const iconClr = g.result === 'W' ? 'var(--patina-text)' : g.result === 'L' ? 'oklch(58% 0.20 15)' : 'var(--muted)'
        return `<a class="act-row" href="${esc(g.url)}" target="_blank" rel="noopener"
          style="text-decoration:none;border-left-color:${lcol}">
          <div class="act-summary">
            <div class="act-icon" style="background:${iconBg};color:${iconClr};font-size:13px;font-weight:800;letter-spacing:0.04em">${g.result}</div>
            <div class="act-body">
              <div class="act-name">${esc(g.opponent)}</div>
              <div class="act-meta">${colorPiece} opp ${g.oppRating ?? '?'} &middot; my ${g.rating ?? '?'}</div>
            </div>
            <span class="ch-game-meta" style="flex-shrink:0">${dt}</span>
          </div>
        </a>`
      }).join('')

  container.innerHTML = `
    <div class="ch-hero">
      <div class="ch-hero-top">
        <div style="display:flex;gap:6px">
          <button class="act-chip ${tc === 'rapid' ? 'active' : ''}" data-tc="rapid" onclick="setChessTC('rapid')">Rapid</button>
          <button class="act-chip ${tc === 'blitz' ? 'active' : ''}" data-tc="blitz" onclick="setChessTC('blitz')">Blitz</button>
        </div>
        <div class="ch-hero-month">${monthName(0)} &middot; ${tm.count} games</div>
      </div>
      <div class="ch-hero-main">
        <div class="ch-hero-rating">${tc_d.current ?? '—'}</div>
        <div>
          <span class="ch-hero-delta" style="color:${heroDeltaCol}">${heroDeltaStr}</span>
          <span class="ch-hero-delta-lbl">this month</span>
        </div>
      </div>
      <div class="chart-label ch-hero-chart-lbl">Rating trend <span class="chart-sublabel">${tc_d.recent?.length ?? 0} recent games</span></div>
      <div id="chess-rating-chart" class="ch-hero-chart"></div>
    </div>

    <div class="ch-stat-strip">
      <div class="dp">
        <span class="dp-n">${tc_d.best ?? '—'}</span>
        <span class="dp-u">${tcLabel} Best</span>
      </div>
      <div class="dp-div"></div>
      <div class="dp">
        <span class="dp-n">${d.tactics.highest ?? '—'}</span>
        <span class="dp-u">Tactics Best</span>
      </div>
      <div class="dp-div"></div>
      <div class="dp">
        <span class="dp-n">${winPct(tm)}%</span>
        <span class="dp-u">Win Rate</span>
        <span class="dp-s">${monthName(0)}</span>
      </div>
      <div class="dp-div"></div>
      <div class="dp">
        <span class="dp-n">${tm.win}-${tm.loss}-${tm.draw}</span>
        <span class="dp-u">Record</span>
        <span class="dp-s">W-L-D</span>
      </div>
    </div>

    <div class="section-label" style="margin-bottom:10px">Monthly Comparison</div>
    <div class="ch-month-table">
      <div class="ch-month-row ch-month-hdr">
        <div>Month</div><div>Rating</div><div>Record</div><div>Win %</div>
      </div>
      <div class="ch-month-row">
        <div class="ch-month-name">${monthName(0)}<span class="ch-month-sub">${tm.count} games</span></div>
        <div>${tm.ratingStart ?? '—'} → ${tm.ratingEnd ?? '—'} ${deltaHtml(tm)}</div>
        <div><span class="ch-w">W ${tm.win}</span> <span class="ch-l">L ${tm.loss}</span> <span class="ch-d">D ${tm.draw}</span></div>
        <div>${winPct(tm)}%</div>
      </div>
      <div class="ch-month-row">
        <div class="ch-month-name">${monthName(1)}<span class="ch-month-sub">${lm.count} games</span></div>
        <div>${lm.ratingStart ?? '—'} → ${lm.ratingEnd ?? '—'} ${deltaHtml(lm)}</div>
        <div><span class="ch-w">W ${lm.win}</span> <span class="ch-l">L ${lm.loss}</span> <span class="ch-d">D ${lm.draw}</span></div>
        <div>${winPct(lm)}%</div>
      </div>
    </div>

    <div class="section-label" style="margin-bottom:10px">Recent Games</div>
    <div class="act-list" style="margin-bottom:28px">
      ${recentHtml}
    </div>

    <div style="text-align:center;margin-bottom:8px">
      <a href="https://www.chess.com/member/${esc(d.username)}" target="_blank" rel="noopener"
         style="font-size:12px;color:var(--faint);text-decoration:none">
        View full profile on chess.com →
      </a>
    </div>
  `

  buildChessRatingChart(tc_d.recent)
}

function renderChessView() {
  const el = document.getElementById('chess-content')
  if (!el) return
  if (!_chessData) {
    el.innerHTML = '<div style="padding:40px;text-align:center"><div class="spinner"></div></div>'
    fetch('/api/chess/stats').then(r => r.json()).then(d => { _chessData = d; renderChessOverview(d); renderChessView() }).catch(() => {
      el.innerHTML = '<div style="padding:40px;text-align:center;color:var(--faint);font-size:13px">Chess stats unavailable</div>'
    })
    return
  }

  const d = _chessData
  const joined = d.joined ? new Date(d.joined * 1000).getFullYear() : null
  const lastOn  = d.lastOnline ? new Date(d.lastOnline * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null

  el.innerHTML = `
    <div class="detail-header" style="display:flex;gap:18px;align-items:flex-start">
      ${d.avatar ? `<img class="ch-profile-avatar" src="${esc(d.avatar)}" alt="avatar">` : ''}
      <div style="flex:1;min-width:0">
        <div class="detail-sport-chip">
          <svg viewBox="0 0 256 256" fill="currentColor" style="width:12px;height:12px;flex-shrink:0" aria-hidden="true"><circle cx="128" cy="76" r="36"/><polygon points="104,112 152,112 176,196 80,196"/><rect x="64" y="196" width="128" height="26" rx="8"/></svg>
          chess.com &middot; ${esc(d.league ?? '')} league
        </div>
        <div class="ch-profile-name">${esc(d.username)}</div>
        <div style="font-size:12px;color:var(--faint);margin-top:4px">
          ${joined ? `Member since ${joined}` : ''}${lastOn ? ` &middot; Last online ${lastOn}` : ''}
        </div>
      </div>
    </div>

    <div id="chess-tc-content"></div>
  `

  buildChessTCContent(d, _chessTC)
}
