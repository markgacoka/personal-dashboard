'use strict';

// ─── finance privacy mask ─────────────────────────────────────────────────────
let _finMasked = localStorage.getItem('fin-masked') !== '0'; // hidden by default

function fd(formatted) {
  return `<span class="fin-real">${formatted}</span><span class="fin-mask-txt" aria-hidden="true">•••••</span>`;
}

function applyFinMask() {
  const ids = ['fin-dashboard-content', 'fin-overview-content'];
  ids.forEach(id => document.getElementById(id)?.classList.toggle('fin-view-masked', _finMasked));
  document.querySelectorAll('.fin-eye-icon').forEach(icon => {
    icon.className = `ph-bold fin-eye-icon ${_finMasked ? 'ph-eye-slash' : 'ph-eye'}`;
  });
}

function toggleFinMask() {
  _finMasked = !_finMasked;
  localStorage.setItem('fin-masked', _finMasked ? '1' : '0');
  applyFinMask();
}

// ─── finance ──────────────────────────────────────────────────────────────────
function fmtDollars(n) {
  if (n == null) return '—';
  const abs = Math.abs(n);
  const s = abs >= 1000000 ? '$' + (abs/1000000).toFixed(2) + 'M'
          : abs >= 1000    ? '$' + (abs/1000).toFixed(1) + 'k'
          : '$' + Math.round(abs);
  return n < 0 ? '-' + s : s;
}

function fmtDollarsExact(n) {
  if (n == null) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (n < 0 ? '-' : '') + '$' + abs;
}

const ACCT_COLORS = { depository:'#5a88c0', investment:'#5db87c', credit:'#c04040', loan:'#c07030', other:'#7a8a98' };
function acctDot(type, subtype) {
  const retire = ['401k','ira','roth','403b','pension','457b'];
  return retire.includes(subtype) ? '#b07cc0' : (ACCT_COLORS[type] || ACCT_COLORS.other);
}

async function loadFinanceOverview() {
  const sect = document.getElementById('fin-overview-section');
  const el   = document.getElementById('fin-overview-content');
  if (!sect || !el) return;
  try {
    const d = await fetch('/api/finance/net-worth').then(r => r.ok ? r.json() : null);
    if (!d || !d.total) return;
    sect.style.display = 'block';
    const delta = d.delta || 0;
    const dSign = delta >= 0 ? '+' : '';
    const dCls  = delta >= 0 ? 'pos' : 'neg';
    el.innerHTML = `
      <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:10px;flex-wrap:wrap">
        <span class="fin-nw-amt">${fd(fmtDollarsExact(d.total))}</span>
        <span class="fin-nw-delta ${dCls}">${dSign}${fd(fmtDollars(delta))} / 30d</span>
      </div>
      <div class="fin-strip">
        <div class="fin-strip-tile">
          <div class="fin-strip-amt" style="color:#5a88c0">${fd(fmtDollars(d.byType.liquid))}</div>
          <div class="fin-strip-lbl">Cash &amp; Checking</div>
        </div>
        <div class="fin-strip-tile">
          <div class="fin-strip-amt" style="color:#5db87c">${fd(fmtDollars(d.byType.invested))}</div>
          <div class="fin-strip-lbl">Brokerage &amp; Investing</div>
        </div>
        <div class="fin-strip-tile">
          <div class="fin-strip-amt" style="color:#b07cc0">${fd(fmtDollars(d.byType.retirement))}</div>
          <div class="fin-strip-lbl">Retirement</div>
        </div>
      </div>`;
    applyFinMask();
  } catch(_) {}
}

async function loadFinanceDashboard() {
  const el = document.getElementById('fin-dashboard-content');
  if (!el) return;
  try {
    const [nw, holdings] = await Promise.all([
      fetch('/api/finance/net-worth?days=30').then(r => r.ok ? r.json() : null),
      fetch('/api/finance/holdings').then(r => r.ok ? r.json() : []),
    ]);
    if (!nw) {
      el.innerHTML = `<div style="text-align:center;padding:48px 20px;color:var(--muted)">
        No financial data. <a href="#fin-accounts" onclick="navigate('fin-accounts');return false" style="color:var(--patina-text)">Link an account</a> to get started.</div>`;
      return;
    }
    const delta = nw.delta || 0;
    const dSign = delta >= 0 ? '+' : '';
    const dCls  = delta >= 0 ? 'pos' : 'neg';
    const totalRetire = nw.byType.retirement || 0;
    const totalAssets = nw.total || 0;
    const retirePct   = Math.min(100, totalAssets / 1500000 * 100);
    el.innerHTML = `
      <div style="margin-bottom:10px">
        <div class="fin-nw-hero">
          <span class="fin-nw-amt">${fd(fmtDollarsExact(nw.total))}</span>
          <button class="fin-eye-toggle" onclick="toggleFinMask()" title="Show/hide balances" style="font-size:18px;align-self:center">
            <i class="ph-bold fin-eye-icon ${_finMasked ? 'ph-eye-slash' : 'ph-eye'}"></i>
          </button>
          <span class="fin-nw-delta ${dCls}" style="margin-left:auto">${dSign}${fd(fmtDollars(delta))} / 30d</span>
        </div>
        <div class="fin-strip" style="margin-top:0">
          <div class="fin-strip-tile">
            <div class="fin-strip-amt" style="color:#5a88c0">${fd(fmtDollars(nw.byType.liquid))}</div>
            <div class="fin-strip-lbl">Cash &amp; Checking</div>
          </div>
          <div class="fin-strip-tile">
            <div class="fin-strip-amt" style="color:#5db87c">${fd(fmtDollars(nw.byType.invested))}</div>
            <div class="fin-strip-lbl">Brokerage</div>
          </div>
          <div class="fin-strip-tile">
            <div class="fin-strip-amt" style="color:#b07cc0">${fd(fmtDollars(nw.byType.retirement))}</div>
            <div class="fin-strip-lbl">Retirement</div>
          </div>
        </div>
        <div class="chart-card" style="margin-top:14px;padding:10px 12px 8px">
          <div class="chart-label">30-day net worth trend</div>
          <div id="fin-nw-chart"></div>
        </div>
      </div>

      <div style="margin-bottom:10px">
        <div class="section-label" style="margin-bottom:10px">Accounts</div>
        <div class="fin-acct-list">${renderAccountRows(nw.accounts)}</div>
      </div>

      ${holdings.length ? `
      <div style="margin-bottom:10px">
        <div class="section-label" style="margin-bottom:10px">Holdings</div>
        ${renderHoldingsTable(holdings)}
      </div>` : ''}

      <div>
        <div class="section-label" style="margin-bottom:10px">Retirement Progress</div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
            <span style="font-size:13px;color:var(--muted)">Toward $1.5M target</span>
            <span style="font-size:13px;font-weight:600;color:var(--champagne)">${retirePct.toFixed(1)}%</span>
          </div>
          <div class="fin-ret-bar"><div class="fin-ret-fill" style="width:${retirePct}%"></div></div>
          <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--faint);margin-top:4px">
            <span>${fd(fmtDollarsExact(totalAssets))} total assets</span>
            <span>${fd(fmtDollars(totalRetire))} in retirement · $1.5M goal</span>
          </div>
        </div>
      </div>`;
    applyFinMask();
    buildNetWorthChart(nw.history);
    if (holdings.length) fetchHoldingsYTD(holdings);
  } catch(err) {
    el.innerHTML = `<div style="color:var(--warn);padding:16px">${esc(err.message)}</div>`;
  }
}

function renderAccountRows(accounts) {
  if (!accounts || !accounts.length) return '<div style="padding:16px;color:var(--faint);font-size:13px">No accounts</div>';
  return accounts.map(a => {
    const dot = acctDot(a.type, a.subtype);
    const sub = a.subtype ? a.subtype.replace(/_/g,' ') : a.type;
    const hasAvail = a.available != null;
    return `<div class="fin-acct-row">
      <div class="fin-acct-dot" style="background:${dot}"></div>
      <div style="flex:1;min-width:0">
        <div class="fin-acct-name">${esc(a.name)}</div>
        <div class="fin-acct-inst">${esc(a.institution||'')} · ${esc(sub)}</div>
      </div>
      <div style="text-align:right">
        <div class="fin-acct-bal">${fd(fmtDollarsExact(a.balance))}</div>
        ${hasAvail ? `<div class="fin-acct-sub">${fd(fmtDollarsExact(a.available))} avail</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function retColor(pct) { return pct == null ? 'var(--faint)' : pct >= 0 ? '#4aaa80' : '#cc5050'; }
function retStr(pct)  { return pct == null ? '—' : (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'; }
function retDollar(h) {
  if (!h.cost_basis || !h.value) return '';
  const g = h.value - h.cost_basis;
  return (g >= 0 ? '+' : '') + fmtDollars(g);
}

function renderHoldingsTable(holdings) {
  const hdrStyle = 'font-size:10px;color:var(--faint);letter-spacing:.05em;text-transform:uppercase;background:var(--graphite);border-bottom:1px solid var(--rule)';
  const header = `<div class="fin-hold-row" style="${hdrStyle}">
    <div>Ticker</div>
    <div>Name</div>
    <div class="fin-hold-platform">Platform</div>
    <div style="text-align:right">Value</div>
    <div class="fin-hold-ret" style="font-weight:500">All-time</div>
    <div class="fin-hold-ytd" style="font-weight:500">YTD</div>
  </div>`;
  const rows = holdings.map((h, i) => {
    const allTimePct = (h.cost_basis && h.value) ? ((h.value - h.cost_basis) / h.cost_basis * 100) : null;
    const dollar     = retDollar(h);
    const platform   = h.institution || h.account_name || '—';
    const ticker     = h.ticker || '';
    const validTicker = ticker && !ticker.startsWith('CUR:') && ticker !== '';
    return `<div class="fin-hold-row" data-ticker="${esc(ticker)}" data-row="${i}">
      <div class="fin-hold-ticker">${esc(ticker || '—')}</div>
      <div class="fin-hold-name" title="${esc(h.name || '')}">${esc(h.name || '—')}</div>
      <div class="fin-hold-platform">${esc(platform)}</div>
      <div class="fin-hold-val">
        ${fd(fmtDollarsExact(h.value))}
        ${dollar ? `<div style="font-size:10px;color:${retColor(allTimePct)};margin-top:1px">${fd(dollar)}</div>` : ''}
      </div>
      <div class="fin-hold-ret" style="color:${retColor(allTimePct)}">${retStr(allTimePct)}</div>
      <div class="fin-hold-ytd" id="ytd-${i}" style="color:var(--faint)">${validTicker ? '<span class="spinner" style="width:10px;height:10px;border-width:1.5px"></span>' : '—'}</div>
    </div>`;
  }).join('');
  return `<div class="fin-acct-list">${header}${rows}</div>`;
}

async function fetchHoldingsYTD(holdings) {
  const indexed = holdings.map((h, i) => ({ ticker: h.ticker, i }))
    .filter(({ ticker }) => ticker && !ticker.startsWith('CUR:'));
  if (!indexed.length) return;
  const tickers = [...new Set(indexed.map(x => x.ticker))];
  try {
    const res = await fetch('/api/finance/ytd-prices?tickers=' + encodeURIComponent(tickers.join(',')));
    if (!res.ok) return;
    const data = await res.json();
    indexed.forEach(({ ticker, i }) => {
      const el = document.getElementById('ytd-' + i);
      if (!el) return;
      const d = data[ticker];
      if (d?.ytd != null) {
        el.style.color = retColor(d.ytd * 100);
        el.textContent = retStr(d.ytd * 100);
      } else {
        el.style.color = 'var(--faint)';
        el.textContent = '—';
      }
    });
  } catch(_) {
    indexed.forEach(({ i }) => {
      const el = document.getElementById('ytd-' + i);
      if (el) { el.textContent = '—'; el.style.color = 'var(--faint)'; }
    });
  }
}

function buildNetWorthChart(history) {
  if (!history || history.length < 2) return;
  const cfg = getChartCfg();
  const labels = history.map(h => fmtCalDate(h.date, {month:'short',day:'numeric'}));
  const data   = history.map(h => parseFloat(h.total));
  _cjsRender(document.getElementById('fin-nw-chart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Net Worth', data,
      borderColor: '#5db87c', backgroundColor: 'rgba(93,184,124,0.10)',
      pointRadius: 2, pointHoverRadius: 4, tension: 0.3, fill: true, borderWidth: 2,
    }]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { display: false }, tooltip: { ...cfg.tt, callbacks: { label: c => fmtDollarsExact(c.raw) }}},
      scales: { x: cfg.scaleX, y: { ...cfg.scaleY, ticks: { ...cfg.scaleY.ticks, callback: v => fmtDollars(v) }}},
    }
  }, 160);
}

const INST_META = {
  'wealthfront':                    { color: '#00a0dc', bg: '#003d54', domain: 'wealthfront.com',      type: 'Automated Investing' },
  'fidelity':                       { color: '#82bc00', bg: '#2a3d00', domain: 'fidelity.com',         type: 'Brokerage · 401k'    },
  'fidelity investments':           { color: '#82bc00', bg: '#2a3d00', domain: 'fidelity.com',         type: 'Brokerage · 401k'    },
  'sofi':                           { color: '#5c6ce8', bg: '#1a1f50', domain: 'sofi.com',             type: 'Banking · Investing'  },
  'sofi bank':                      { color: '#5c6ce8', bg: '#1a1f50', domain: 'sofi.com',             type: 'Banking'              },
  'e*trade':                        { color: '#b44aee', bg: '#32104a', domain: 'etrade.com',           type: 'Brokerage'            },
  'e*trade from morgan stanley':    { color: '#b44aee', bg: '#32104a', domain: 'etrade.com',           type: 'Brokerage'            },
  'morgan stanley':                 { color: '#1c3c6e', bg: '#0d1e38', domain: 'morganstanley.com',    type: 'Wealth Management'    },
  'chase':                          { color: '#117aca', bg: '#0a2f4a', domain: 'chase.com',            type: 'Banking'              },
  'bank of america':                { color: '#e31837', bg: '#4a0610', domain: 'bankofamerica.com',    type: 'Banking'              },
  'wells fargo':                    { color: '#d71e28', bg: '#4a0a0a', domain: 'wellsfargo.com',       type: 'Banking'              },
  'vanguard':                       { color: '#ac1931', bg: '#3d0a12', domain: 'vanguard.com',        type: 'Brokerage · Retirement'},
  'schwab':                         { color: '#00a9ce', bg: '#003d4a', domain: 'schwab.com',           type: 'Brokerage'            },
  'charles schwab':                 { color: '#00a9ce', bg: '#003d4a', domain: 'schwab.com',           type: 'Brokerage'            },
  'robinhood':                      { color: '#00c805', bg: '#004a02', domain: 'robinhood.com',        type: 'Brokerage'            },
  'betterment':                     { color: '#0a7ec2', bg: '#03243d', domain: 'betterment.com',       type: 'Robo Advisor'         },
  'ally':                           { color: '#8a2be2', bg: '#2a0a4a', domain: 'ally.com',             type: 'Banking'              },
  'ally bank':                      { color: '#8a2be2', bg: '#2a0a4a', domain: 'ally.com',             type: 'Banking'              },
  'american express':               { color: '#2e77bc', bg: '#0a1e38', domain: 'americanexpress.com',  type: 'Credit Card'          },
  'usaa':                           { color: '#002d70', bg: '#001a42', domain: 'usaa.com',             type: 'Banking'              },
};

function instMeta(name) {
  const key = (name||'').toLowerCase().trim();
  return Object.entries(INST_META).find(([k]) => key.includes(k))?.[1]
    || { color: '#5a6a7a', bg: '#1a2030', domain: null, type: 'Financial Institution' };
}

function instAvatarEl(name) {
  const meta   = instMeta(name);
  const letter = (name||'?')[0].toUpperCase();
  const favicon = meta.domain
    ? `https://www.google.com/s2/favicons?domain_url=https://${meta.domain}&sz=64`
    : null;
  const bg = `background:${meta.bg}`;
  if (favicon) {
    return `<div class="fin-inst-avatar" style="${bg}">
      <img src="${favicon}" alt=""
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span class="fin-inst-avatar-letter" style="display:none;color:#fff">${esc(letter)}</span>
    </div>`;
  }
  return `<div class="fin-inst-avatar" style="${bg}">
    <span class="fin-inst-avatar-letter">${esc(letter)}</span>
  </div>`;
}

async function loadFinanceAccounts() {
  const el = document.getElementById('fin-items-content');
  if (!el) return;
  try {
    const items = await fetch('/api/finance/items').then(r => r.ok ? r.json() : []);
    if (!items.length) {
      el.innerHTML = `<div class="fin-inst-grid">
        <button class="fin-add-card" onclick="openPlaidLink()">
          <div class="fin-add-icon"><i class="ph-bold ph-plus"></i></div>
          <div>
            <div style="font-size:13px;font-weight:500">Link your first account</div>
            <div style="font-size:11px;margin-top:2px">Connect banks, brokerages &amp; 401k</div>
          </div>
        </button>
      </div>`;
      return;
    }
    const cards = items.map(item => {
      const name = item.institution || item.item_id;
      const meta = instMeta(name);
      const date = new Date(item.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      return `<div class="fin-inst-card">
        ${instAvatarEl(name)}
        <div class="fin-inst-body">
          <div class="fin-inst-name">${esc(name)}</div>
          <div class="fin-inst-type">${esc(meta.type)}</div>
          <div class="fin-inst-connected">Connected · ${date}</div>
        </div>
        <button class="fin-inst-rm" title="Unlink ${esc(name)}" onclick="finUnlink('${esc(item.item_id)}',this)">
          <i class="ph-bold ph-dots-three-vertical"></i>
        </button>
      </div>`;
    }).join('');
    el.innerHTML = `<div class="fin-inst-grid">
      ${cards}
      <button class="fin-add-card" onclick="openPlaidLink()">
        <div class="fin-add-icon"><i class="ph-bold ph-plus"></i></div>
        <div>
          <div style="font-size:13px;font-weight:500">Add account</div>
          <div style="font-size:11px;margin-top:2px">Connect another institution</div>
        </div>
      </button>
    </div>`;
  } catch(err) {
    el.innerHTML = `<div style="color:var(--warn);padding:16px">${esc(err.message)}</div>`;
  }
}

async function finUnlink(itemId, btn) {
  if (!confirm('Unlink this institution? Balance history will be removed.')) return;
  btn.disabled = true;
  try {
    await fetch(`/api/finance/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
    loadFinanceAccounts();
  } catch(err) { alert(err.message); btn.disabled = false; }
}

async function finSync() {
  const btn    = document.getElementById('fin-sync-btn');
  const status = document.getElementById('fin-sync-status');
  btn.disabled = true;
  if (status) status.textContent = 'Syncing…';
  try {
    const r = await fetch('/api/finance/sync', { method: 'POST' }).then(r => r.json());
    if (status) status.textContent = `Synced ${r.synced} item${r.synced !== 1 ? 's' : ''}`;
    window._finLoaded = false;
    loadFinanceDashboard();
    loadFinanceOverview();
  } catch(_) { if (status) status.textContent = 'Sync failed'; }
  btn.disabled = false;
}

function openPlaidLink() {
  if (!window.Plaid) { alert('Plaid Link not available'); return; }
  fetch('/api/finance/link/token', { method: 'POST' })
    .then(r => r.json())
    .then(({ link_token }) => {
      const handler = Plaid.create({
        token: link_token,
        onSuccess: async (public_token) => {
          await fetch('/api/finance/link/exchange', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ public_token }),
          });
          window._finLoaded = false;
          loadFinanceAccounts();
          loadFinanceDashboard();
          loadFinanceOverview();
        },
        onExit: () => {},
      });
      handler.open();
    })
    .catch(err => alert('Could not open Plaid Link: ' + err.message));
}
