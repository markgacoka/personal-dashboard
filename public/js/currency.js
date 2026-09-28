'use strict';

// ─── medical helpers ──────────────────────────────────────────────────────────
// Pre-seed medical certificate data from actual certificates (Third Class, exam 2025-08-22, under 40)
// Only set if the user hasn't already overridden via the currency card UI
if (!localStorage.getItem('med-seeded')) {
  localStorage.setItem('med-cls',     '3');
  localStorage.setItem('med-under40', 'true');
  localStorage.setItem('med-date',    '2025-08-22');
  localStorage.setItem('med-seeded',  '1');
}

function medCalExpiry(dateStr, months) {
  const d = new Date(dateStr + 'T12:00:00');
  const y = d.getFullYear() + Math.floor((d.getMonth() + months) / 12);
  const m = (d.getMonth() + months) % 12;
  return new Date(y, m + 1, 0); // last day of that calendar month
}
function getMedExpiry(cls, under40, dateStr) {
  const mo = cls === '1' ? (under40 ? 12 : 6)
           : cls === '2' ? 12
           : cls === '3' ? (under40 ? 60 : 24)
           : cls === 'basicmed' ? 48 : null;
  return mo ? medCalExpiry(dateStr, mo) : null;
}
const MED_LABEL = { '1': 'First Class', '2': 'Second Class', '3': 'Third Class', basicmed: 'BasicMed' };
function getMedData() {
  return {
    cls:     localStorage.getItem('med-cls')     || '3',
    under40: localStorage.getItem('med-under40') !== 'false',
    date:    localStorage.getItem('med-date')    || '',
  };
}

// ─── flight currency ──────────────────────────────────────────────────────────
function renderFlightCurrency(flights) {
  const el = document.getElementById('currency-card');
  if (!flights || !flights.length) {
    el.innerHTML = `<div class="ov-card-hd">FAA Currency</div><div style="color:var(--faint);font-size:13px;padding:8px 0">No flight data</div>`;
    return;
  }

  const cur = computeCurrency(flights, Date.now());
  const { to: dayTO, lnd: dayLnd, current: dayCur, daysLeft: dayDays } = cur.day;
  const { to: ngtTO, lnd: ngtLnd, current: ngtCur } = cur.night;
  const { apps6: ifrApps6, apps12: ifrApps12, total: ifrTotal, current: ifrCur, grace: ifrGrace } = cur.ifr;
  const { current: bfrCur, daysLeft: bfrDays } = cur.bfr;

  // Badge styles per status type — CSS classes bound to theme-aware tokens,
  // not inline styles computed once at render time (those went stale on a
  // theme toggle since the HTML isn't re-rendered when the theme changes).
  function bs(type) {
    if (type === 'expiring') return 'cur-badge-warning';
    if (type === 'current')  return 'cur-badge-success';
    if (type === 'grace')    return 'cur-badge-warning';
    if (type === 'na')       return 'cur-badge-neutral';
    return 'cur-badge-danger';
  }

  // Icon per status
  function icon(type) {
    if (type === 'current')  return '<i class="ph-bold ph-check-circle" style="font-size:11px"></i>';
    if (type === 'expiring') return '<i class="ph-bold ph-warning" style="font-size:11px"></i>';
    if (type === 'grace')    return '<i class="ph-bold ph-clock-countdown" style="font-size:11px"></i>';
    if (type === 'na')       return '<i class="ph-bold ph-minus" style="font-size:11px"></i>';
    return '<i class="ph-bold ph-x-circle" style="font-size:11px"></i>';
  }

  function row(name, reg, sub, current, daysLeft, detail, type) {
    let crClass, badge, btext, itype;
    if (type === 'na') {
      crClass='cr-na'; itype='na'; badge=bs('na'); btext='N/A';
    } else if (type === 'grace') {
      crClass='cr-grace'; itype='grace'; badge=bs('grace'); btext='Grace';
    } else if (current && daysLeft !== null && daysLeft <= 30) {
      crClass='cr-expiring'; itype='expiring'; badge=bs('expiring'); btext='Expiring';
    } else if (current) {
      crClass='cr-current'; itype='current'; badge=bs('current'); btext='Current';
    } else {
      crClass='cr-lapsed'; itype='lapsed'; badge=bs('lapsed'); btext='Lapsed';
    }
    return `<div class="cur-row ${crClass}">
      <div>
        <div class="cur-name">${esc(name)}<span class="cur-reg">${reg ? esc(reg) : ''}</span></div>
        ${sub?`<div class="cur-sub">${esc(sub)}</div>`:''}
      </div>
      <div class="cur-status">
        <span class="cur-badge ${badge}">${icon(itype)} ${btext}</span>
        ${detail?`<div class="cur-days">${esc(detail)}</div>`:''}
      </div>
    </div>`;
  }

  // Medical section
  const med = getMedData();
  let medHtml = '';
  if (med.date) {
    const expiry = getMedExpiry(med.cls, med.under40, med.date);
    const dLeft  = expiry ? Math.floor((expiry - Date.now()) / 86400000) : null;
    const expired = dLeft !== null && dLeft < 0;
    const expStr  = expiry ? expiry.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '—';
    const privilege = med.cls === '1' ? (med.under40 ? '12 mo · first-class privileges' : '6 mo · first-class privileges')
                    : med.cls === '2' ? '12 months · second-class privileges'
                    : med.cls === 'basicmed' ? '48 months'
                    : (med.under40 ? '60 months · third-class privileges' : '24 months · third-class privileges');
    const crClass = expired ? 'cr-lapsed' : dLeft < 60 ? 'cr-expiring' : 'cr-current';
    const icoType = expired ? 'lapsed' : dLeft < 60 ? 'expiring' : 'current';
    const badge = bs(icoType);
    const btext = expired ? `Expired ${-dLeft}d ago` : dLeft < 30 ? `${dLeft}d left` : 'Current';
    const detail = expired ? '' : `Expires ${expStr}`;
    medHtml = `<div class="cur-row ${crClass}">
      <div>
        <div class="cur-name">${esc(MED_LABEL[med.cls])} Medical</div>
        <div class="cur-sub">${esc(privilege)}</div>
      </div>
      <div class="cur-status">
        <span class="cur-badge ${badge}">${icon(icoType)} ${esc(btext)}</span>
        ${detail?`<div class="cur-days">${esc(detail)}</div>`:''}
      </div>
    </div>`;
  } else {
    medHtml = `<div class="cur-row cr-na">
      <div>
        <div class="cur-name">Medical Certificate</div>
        <div class="cur-sub">No exam date recorded</div>
      </div>
      <div class="cur-status">
        <span class="cur-badge ${bs('na')}">${icon('na')} N/A</span>
      </div>
    </div>`;
  }

  const dayDetail = dayCur ? (dayDays!==null?`${dayDays}d until lapse`:'') : `${dayTO} T/O · ${dayLnd} lnd`;
  const ngtDetail = ngtCur ? '' : `${ngtTO} T/O · ${ngtLnd} lnd`;
  const bfrDetail = bfrDays!==null ? (bfrCur?`${bfrDays}d until lapse`:`${-bfrDays}d overdue`) : 'none logged';
  const ifrDetail = ifrTotal === 0 ? 'none logged' : `${ifrApps6} approaches in 6mo`;

  el.innerHTML = `
    <div class="ov-card-hd">FAA Currency
      <span style="font-size:10px;color:var(--faint);font-weight:400;letter-spacing:0;text-transform:none;margin-left:4px">§61.57</span>
      <span style="font-size:11px;color:var(--faint);font-weight:400;letter-spacing:0;text-transform:none;margin-left:auto">${flights.length} flights</span>
    </div>

    <div class="cur-section-hdr">
      <span>Medical</span>
      <button class="cur-edit-btn" title="Edit medical" onclick="this.closest('.ov-card').querySelector('.cur-med-form').classList.toggle('open')" style="margin-left:4px">
        <i class="ph-bold ph-pencil-simple"></i>
      </button>
    </div>
    <div class="cur-rows">${medHtml}</div>
    <div class="cur-med-form" id="cur-med-form">
      <select class="cur-med-sel" id="med-cls-sel" onchange="saveMed()">
        <option value="1" ${med.cls==='1'?'selected':''}>First Class</option>
        <option value="2" ${med.cls==='2'?'selected':''}>Second Class</option>
        <option value="3" ${med.cls==='3'?'selected':''}>Third Class</option>
        <option value="basicmed" ${med.cls==='basicmed'?'selected':''}>BasicMed</option>
      </select>
      <label class="cur-med-toggle">
        <input type="checkbox" id="med-u40" onchange="saveMed()" ${med.under40?'checked':''}> Under 40
      </label>
      <input type="date" class="cur-med-date" id="med-date-inp" value="${med.date}" onchange="saveMed()">
    </div>

    <div class="cur-section-hdr" style="margin-top:10px"><span>Pilot Currency</span></div>
    <div class="cur-rows">
      ${row('Day VFR', '§61.57(a)', '3 T/O + full-stop landings in 90 days', dayCur, dayDays, dayDetail)}
      ${row('Night VFR', '§61.57(b)', '3 night T/O + full-stop landings in 90 days', ngtCur, null, ngtDetail)}
      ${ifrTotal > 0 || ifrApps12 > 0
        ? row('Instrument', '§61.57(c)', '6 approaches + holds/intercepting in 6 months', ifrCur, null, ifrDetail, ifrGrace?'grace':undefined)
        : row('Instrument', '§61.57(c)', '6 approaches + holds/intercepting in 6 months', false, null, ifrDetail, 'na')}
      ${row('Flight Review', '§61.56', 'Every 24 calendar months', bfrCur, bfrDays!==null&&bfrDays<60?bfrDays:null, bfrDetail)}
    </div>
  `;
}

function saveMed() {
  const cls    = document.getElementById('med-cls-sel')?.value || '3';
  const under40= document.getElementById('med-u40')?.checked !== false;
  const date   = document.getElementById('med-date-inp')?.value || '';
  localStorage.setItem('med-cls', cls);
  localStorage.setItem('med-under40', String(under40));
  localStorage.setItem('med-date', date);
  renderFlightCurrency(window._flights || []);
  document.getElementById('cur-med-form')?.classList.add('open');
}
