'use strict';

// ─── log flight form ──────────────────────────────────────────────────────────
async function showLogFlightView(editId) {
  const isEdit = !!editId;
  if (isEdit && !(window._flights || []).length && window._flightsReady) await window._flightsReady;
  const existingFlight = isEdit ? (window._flights || []).find(f => String(f.id) === String(editId)) : null;

  showView('log-flight', { back: 'logbook', title: isEdit ? 'Edit Flight' : 'Log Flight' });
  const content = document.getElementById('log-flight-content');
  content.innerHTML = '<div style="padding:40px;text-align:center"><div class="spinner"></div></div>';

  let aircraft = [], instructors = [];
  try {
    [aircraft, instructors] = await Promise.all([
      fetch('/api/aircraft').then(r => r.ok ? r.json() : []),
      fetch('/api/instructors').then(r => r.ok ? r.json() : []),
    ]);
  } catch(_) {}

  content.innerHTML = buildFlightFormHTML(aircraft, instructors, isEdit ? editId : null);
  document.getElementById('flight-form').addEventListener('submit', handleFlightSubmit);
  document.getElementById('add-approach-btn').addEventListener('click', addApproachRow);

  if (existingFlight) {
    populateFlightForm(existingFlight, instructors);
  } else {
    document.getElementById('ff-date').value = new Date().toISOString().slice(0, 10);
  }
}

function buildFlightFormHTML(aircraft, instructors, editId) {
  const acOpts = aircraft.map(a =>
    `<option value="${a.id}">${esc(a.tail_number)} — ${esc(a.make)} ${esc(a.model)}</option>`
  ).join('');
  const insOpts = instructors.map(i =>
    `<option value="${i.id}">${esc(i.name)}</option>`
  ).join('');
  const typeOpts = Object.entries(TYPE_CFG).map(([k,v]) =>
    `<option value="${k}">${esc(v.label)}</option>`
  ).join('');

  return `
  <div style="max-width:860px">
    <form id="flight-form" novalidate>
      <input type="hidden" name="edit_flight_id" value="${editId || ''}">

      <!-- Route & Identity -->
      <div class="form-section">
        <div class="section-label" style="margin-bottom:14px">Route &amp; Identity</div>
        <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
          <div class="form-field">
            <label class="form-label" for="ff-date">Date</label>
            <input class="form-input" type="date" id="ff-date" name="date" required>
          </div>
          <div class="form-field span2">
            <label class="form-label" for="ff-aircraft">Aircraft</label>
            <select class="form-select" id="ff-aircraft" name="aircraft_id" required>
              <option value="">Select aircraft…</option>
              ${acOpts}
            </select>
          </div>
        </div>
        <div class="form-grid" style="margin-top:12px;grid-template-columns:repeat(3,1fr)">
          <div class="form-field">
            <label class="form-label" for="ff-dep">Departure</label>
            <input class="form-input" type="text" id="ff-dep" name="departure_icao" placeholder="KSQL" maxlength="6" required style="text-transform:uppercase">
          </div>
          <div class="form-field">
            <label class="form-label" for="ff-via">Via (comma-sep)</label>
            <input class="form-input" type="text" id="ff-via" name="via" placeholder="KHAF, KPAO" style="text-transform:uppercase">
          </div>
          <div class="form-field">
            <label class="form-label" for="ff-arr">Arrival</label>
            <input class="form-input" type="text" id="ff-arr" name="arrival_icao" placeholder="KWVI" maxlength="6" required style="text-transform:uppercase">
          </div>
        </div>
        <div class="form-grid" style="margin-top:12px;grid-template-columns:1fr 2fr">
          <div class="form-field">
            <label class="form-label" for="ff-type">Training Type</label>
            <select class="form-select" id="ff-type" name="training_type">
              <option value="">Select type…</option>
              ${typeOpts}
            </select>
          </div>
          <div class="form-field">
            <label class="form-label" for="ff-ins">Instructor (optional)</label>
            <select class="form-select" id="ff-ins" name="instructor_id">
              <option value="">None / solo</option>
              ${insOpts}
            </select>
          </div>
        </div>
      </div>

      <!-- Flight Time -->
      <div class="form-section">
        <div class="section-label" style="margin-bottom:14px">Flight Time <span style="font-size:11px;color:var(--disabled);text-transform:none;letter-spacing:0">(hours)</span></div>
        <div class="form-grid" style="grid-template-columns:repeat(6,1fr)">
          ${numField('ff-total','total_duration','Total','required')}
          ${numField('ff-dual-rcvd','dual_received','Dual Rcvd')}
          ${numField('ff-dual-given','dual_given','Dual Given')}
          ${numField('ff-pic','pic','PIC')}
          ${numField('ff-solo','solo','Solo')}
          ${numField('ff-sic','sic','SIC')}
        </div>
        <div class="form-grid" style="margin-top:12px;grid-template-columns:repeat(4,1fr)">
          ${numField('ff-xc','cross_country','X-Country')}
          ${numField('ff-night','night','Night')}
          ${numField('ff-act-ifr','actual_instrument','Actual IFR')}
          ${numField('ff-sim-inst','instrument','Sim Inst')}
        </div>
      </div>

      <!-- Operations -->
      <div class="form-section">
        <div class="section-label" style="margin-bottom:14px">Operations</div>
        <div class="form-grid" style="grid-template-columns:repeat(6,1fr)">
          ${intField('ff-to','takeoffs','Takeoffs')}
          ${intField('ff-lnd','landings','Landings')}
          ${intField('ff-nto','night_takeoffs','Night T/O')}
          ${intField('ff-nlnd','night_landings','Night Ldg')}
          ${intField('ff-holds','holds','Holds')}
          ${numField('ff-dist','distance_nm','Distance (nm)')}
        </div>
      </div>

      <!-- Approaches -->
      <div class="form-section">
        <div class="section-label" style="margin-bottom:14px">Approaches</div>
        <div id="approach-rows"></div>
        <button type="button" id="add-approach-btn" class="btn-link" style="margin-top:4px">
          <i class="ph-bold ph-plus-circle"></i> Add approach
        </button>
      </div>

      <!-- Remarks -->
      <div class="form-section">
        <div class="section-label" style="margin-bottom:14px">Notes</div>
        <div class="form-field">
          <label class="form-label" for="ff-remarks">Remarks</label>
          <textarea class="form-textarea" id="ff-remarks" name="remarks" rows="3" placeholder="Route narrative, conditions, lessons…"></textarea>
        </div>
      </div>

      <!-- Hobbs / Tach (collapsible) -->
      <div class="form-section">
        <div class="section-label" style="margin-bottom:14px;cursor:pointer" id="hobbs-toggle">
          Hobbs &amp; Tach <span id="hobbs-toggle-icon" style="font-size:11px;color:var(--faint)">▸ expand</span>
        </div>
        <div id="hobbs-fields" style="display:none">
          <div class="form-grid" style="grid-template-columns:repeat(4,1fr)">
            ${numField('ff-hobbs-s','hobbs_start','Hobbs Start')}
            ${numField('ff-hobbs-e','hobbs_end','Hobbs End')}
            ${numField('ff-tach-s','tach_start','Tach Start')}
            ${numField('ff-tach-e','tach_end','Tach End')}
          </div>
        </div>
      </div>

      <div id="flight-form-error" class="form-error"></div>

      <div style="display:flex;gap:10px;align-items:center;margin-top:8px">
        <button type="submit" class="btn-primary" id="ff-submit">
          <i class="ph-bold ph-paper-plane-tilt"></i> ${editId ? 'Save Changes' : 'Log Flight'}
        </button>
        <button type="button" class="btn-ghost" onclick="navigate(${editId ? `'flight','${editId}'` : `'logbook'`})">Cancel</button>
      </div>
    </form>
  </div>`;
}

function numField(id, name, label, extra='') {
  return `<div class="form-field">
    <label class="form-label" for="${id}">${label}</label>
    <input class="form-input" type="number" id="${id}" name="${name}" step="0.1" min="0" placeholder="0.0" ${extra}>
  </div>`;
}
function intField(id, name, label) {
  return `<div class="form-field">
    <label class="form-label" for="${id}">${label}</label>
    <input class="form-input" type="number" id="${id}" name="${name}" step="1" min="0" placeholder="0">
  </div>`;
}

function addApproachRow() {
  const container = document.getElementById('approach-rows');
  const row = document.createElement('div');
  row.className = 'approach-row';
  row.innerHTML = `
    <select class="form-select ap-type">
      <option value="">Type…</option>
      <option value="ILS">ILS</option>
      <option value="RNAV (GPS)">RNAV (GPS)</option>
      <option value="VOR">VOR</option>
      <option value="NDB">NDB</option>
      <option value="LOC">LOC</option>
      <option value="LOC/BC">LOC/BC</option>
      <option value="LDA">LDA</option>
      <option value="SDF">SDF</option>
      <option value="Visual">Visual</option>
    </select>
    <input class="form-input ap-icao" type="text" placeholder="ICAO" maxlength="6" style="text-transform:uppercase">
    <input class="form-input ap-rwy" type="text" placeholder="Rwy" maxlength="4">
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);white-space:nowrap">
      <input type="checkbox" class="ap-ctl"> C/L
    </label>
    <button type="button" class="ap-rm" title="Remove"><i class="ph-bold ph-x"></i></button>
  `;
  row.querySelector('.ap-rm').addEventListener('click', () => row.remove());
  container.appendChild(row);
  return row;
}

function populateFlightForm(f, instructors) {
  const set = (name, val) => {
    const el = document.querySelector(`[name="${name}"]`);
    if (el && val != null && val !== '') el.value = val;
  };
  // Date comes as "2026-05-10", input[type=date] wants "YYYY-MM-DD"
  set('date', f.date);
  set('aircraft_id', f.aircraft?.id);
  set('departure_icao', f.departure?.icao || '');
  set('arrival_icao', f.arrival?.icao || '');
  set('via', (f.via || []).join(', '));
  set('training_type', f.training_type);

  // Match instructor by id (now returned by API)
  if (f.instructor_id) set('instructor_id', f.instructor_id);

  // Time fields
  ['total_duration','dual_received','dual_given','pic','sic','solo',
   'cross_country','night','actual_instrument','instrument'].forEach(name => {
    const v = f[name] || f['simulated_instrument' === name ? 'simulated_instrument' : name];
    // instrument column is returned as simulated_instrument in the API
    const apiKey = name === 'instrument' ? 'simulated_instrument' : name;
    if (f[apiKey] > 0) set(name, parseFloat(f[apiKey]).toFixed(1));
  });

  // Operations
  ['takeoffs','landings','night_takeoffs','night_landings','holds'].forEach(name => {
    if (f[name] > 0) set(name, f[name]);
  });
  if (f.distance_nm) set('distance_nm', f.distance_nm);

  // Hobbs/Tach — expand section if values present
  if (f.hobbs_start || f.hobbs_end || f.tach_start || f.tach_end) {
    const fields = document.getElementById('hobbs-fields');
    const icon = document.getElementById('hobbs-toggle-icon');
    if (fields) fields.style.display = 'grid';
    if (icon) icon.textContent = '▾ collapse';
    set('hobbs_start', f.hobbs_start);
    set('hobbs_end', f.hobbs_end);
    set('tach_start', f.tach_start);
    set('tach_end', f.tach_end);
  }

  // Remarks
  if (f.remarks) set('remarks', f.remarks);

  // Approaches
  for (const ap of f.approaches || []) {
    const row = addApproachRow();
    row.querySelector('.ap-type').value = ap.approach_type || '';
    row.querySelector('.ap-icao').value = ap.airport_icao || '';
    row.querySelector('.ap-rwy').value = ap.runway || '';
    row.querySelector('.ap-ctl').checked = !!ap.circle_to_land;
  }
}

async function handleFlightSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const submitBtn = document.getElementById('ff-submit');
  const errEl = document.getElementById('flight-form-error');
  errEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px;margin-right:6px"></div> Saving…';

  const viaRaw = form.via.value.trim();
  const via = viaRaw ? viaRaw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];

  const approaches = Array.from(document.querySelectorAll('.approach-row')).map(row => ({
    approach_type: row.querySelector('.ap-type').value,
    airport_icao: row.querySelector('.ap-icao').value.trim().toUpperCase(),
    runway: row.querySelector('.ap-rwy').value.trim(),
    circle_to_land: row.querySelector('.ap-ctl').checked,
  })).filter(a => a.approach_type && a.airport_icao);

  const g = name => {
    const el = form.querySelector(`[name="${name}"]`);
    return el ? el.value : '';
  };
  const fv = name => parseFloat(g(name)) || 0;
  const iv = name => parseInt(g(name)) || 0;
  const sv = name => { const v = g(name).trim(); return v || null; };

  const body = {
    date: g('date'),
    aircraft_id: parseInt(g('aircraft_id')),
    departure_icao: g('departure_icao').toUpperCase(),
    arrival_icao: g('arrival_icao').toUpperCase(),
    via,
    training_type: g('training_type') || null,
    total_duration: fv('total_duration'),
    dual_received: fv('dual_received'),
    dual_given: fv('dual_given'),
    pic: fv('pic'),
    sic: fv('sic'),
    solo: fv('solo'),
    cross_country: fv('cross_country'),
    night: fv('night'),
    actual_instrument: fv('actual_instrument'),
    instrument: fv('instrument'),
    takeoffs: iv('takeoffs'),
    landings: iv('landings'),
    night_takeoffs: iv('night_takeoffs'),
    night_landings: iv('night_landings'),
    holds: iv('holds'),
    distance_nm: sv('distance_nm') ? parseFloat(sv('distance_nm')) : null,
    hobbs_start: sv('hobbs_start') ? parseFloat(sv('hobbs_start')) : null,
    hobbs_end: sv('hobbs_end') ? parseFloat(sv('hobbs_end')) : null,
    tach_start: sv('tach_start') ? parseFloat(sv('tach_start')) : null,
    tach_end: sv('tach_end') ? parseFloat(sv('tach_end')) : null,
    instructor_id: sv('instructor_id') ? parseInt(sv('instructor_id')) : null,
    remarks: sv('remarks'),
    approaches,
  };

  const editFlightId = g('edit_flight_id');
  const isEdit = !!editFlightId;
  const url = isEdit ? `/api/flights/${editFlightId}` : '/api/flights';
  const method = isEdit ? 'PUT' : 'POST';
  const btnLabel = isEdit ? 'Save Changes' : 'Log Flight';

  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.error || `Server error ${res.status}`);
    }
    await loadFlights();
    if (isEdit) {
      navigate('flight', editFlightId);
    } else {
      navigate('logbook');
    }
  } catch(err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="ph-bold ph-paper-plane-tilt"></i> ${btnLabel}`;
  }
}

// Hobbs toggle
document.addEventListener('click', e => {
  if (e.target.closest('#hobbs-toggle')) {
    const fields = document.getElementById('hobbs-fields');
    const icon = document.getElementById('hobbs-toggle-icon');
    if (!fields) return;
    const open = fields.style.display !== 'none';
    fields.style.display = open ? 'none' : 'grid';
    if (icon) icon.textContent = open ? '▸ expand' : '▾ collapse';
  }
});

// ─── flight modal ─────────────────────────────────────────────────────────────
const _m = { step:0, editId:null, aircraft:null, date:null, dep:null, previewMap:null };

function openFlightModal(editId = null) {
  _m.editId = editId ? String(editId) : null;
  _m.aircraft = null; _m.date = null; _m.dep = null;
  if (_m.previewMap) { try{_m.previewMap.remove();}catch(_){} _m.previewMap=null; }
  document.getElementById('flight-modal-overlay').style.display = 'flex';
  document.getElementById('modal-title').textContent = editId ? 'Edit Flight' : 'Log Flight';
  if (editId) {
    const f = (window._flights||[]).find(f=>String(f.id)===String(editId));
    if (f) { _m.aircraft = f.aircraft; _m.date = f.date; _m.dep = f.departure?.icao||''; }
    showModalSteps(3);
    renderModalStep3(f || null);
  } else {
    showModalSteps(0);
    renderModalStep1();
  }
}

function closeFlightModal() {
  document.getElementById('flight-modal-overlay').style.display = 'none';
  if (_m.previewMap) { try{_m.previewMap.remove();}catch(_){} _m.previewMap=null; }
}

document.addEventListener('keydown', e => { if(e.key==='Escape') closeFlightModal(); });

function showModalSteps(active) {
  const el = document.getElementById('modal-steps');
  el.style.display = active > 0 ? 'flex' : 'none';
  [1,2,3].forEach(i => {
    const t = document.getElementById('mstab-'+i);
    if (!t) return;
    t.className = 'ms-tab' + (i===active?' active':i<active?' done':'');
  });
  if (active > 0) {
    document.getElementById('mstab-1').onclick = active>1 ? ()=>renderModalStep1() : null;
    document.getElementById('mstab-2').onclick = active>2 ? ()=>renderModalStep2FromCache() : null;
  }
}

// Step 1 ──────────────────────────────────────────────────────────────────────
function renderModalStep1() {
  _m.step = 1; showModalSteps(1);
  document.getElementById('modal-ft').style.display = 'none';
  const typeOpts = Object.entries(TYPE_CFG).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');
  document.getElementById('modal-bd').innerHTML = `
    <div class="section-label" style="margin-bottom:18px">Route &amp; Aircraft</div>
    <div class="form-grid" style="grid-template-columns:160px 1fr 120px;align-items:start">
      <div class="form-field">
        <label class="form-label" for="ms-date">Date</label>
        <input class="form-input" type="date" id="ms-date" value="${new Date().toISOString().slice(0,10)}">
      </div>
      <div class="form-field">
        <label class="form-label" for="ms-tail">
          Tail Number
          <span id="ms-tail-status" style="margin-left:6px;text-transform:none;letter-spacing:0;font-weight:400;font-size:11px;color:var(--faint)"></span>
        </label>
        <input class="form-input" type="text" id="ms-tail" placeholder="N5624H" maxlength="8"
          autocomplete="off" style="text-transform:uppercase">
      </div>
      <div class="form-field">
        <label class="form-label" for="ms-dep">Departure</label>
        <input class="form-input" type="text" id="ms-dep" placeholder="KSQL" maxlength="6"
          style="text-transform:uppercase">
      </div>
    </div>
    <div id="ms-ac-card" style="margin-top:14px"></div>
    <div style="margin-top:24px;display:flex;gap:10px;align-items:center">
      <button class="btn-primary" id="ms-continue" onclick="onStep1Continue()" disabled>
        Continue <i class="ph-bold ph-arrow-right"></i>
      </button>
      <button class="btn-ghost" onclick="closeFlightModal()">Cancel</button>
    </div>`;

  let tailTimer;
  document.getElementById('ms-tail').addEventListener('input', e => {
    clearTimeout(tailTimer);
    tailTimer = setTimeout(()=>onTailLookup(e.target.value.trim().toUpperCase()), 450);
    updateStep1Btn();
  });
  ['ms-dep','ms-date'].forEach(id => document.getElementById(id)?.addEventListener('input', updateStep1Btn));
}

function updateStep1Btn() {
  const tail = document.getElementById('ms-tail')?.value?.trim();
  const dep  = document.getElementById('ms-dep')?.value?.trim();
  const date = document.getElementById('ms-date')?.value;
  const btn  = document.getElementById('ms-continue');
  if (btn) btn.disabled = !(tail && dep && date && _m.aircraft);
}

let _tailCache = {};
async function onTailLookup(tail) {
  if (!tail || tail.length < 3) {
    _m.aircraft = null;
    document.getElementById('ms-ac-card').innerHTML = '';
    updateStep1Btn();
    return;
  }
  const status = document.getElementById('ms-tail-status');
  if (!status) return;
  status.innerHTML = '<span class="spinner" style="width:10px;height:10px;vertical-align:middle;display:inline-block"></span>';

  if (_tailCache[tail]) {
    _m.aircraft = _tailCache[tail];
    status.textContent = '✓'; status.style.color = 'var(--run)';
    renderAircraftEnrichCard(_m.aircraft);
    updateStep1Btn(); return;
  }

  // 1. Internal DB
  const allAc = await fetch('/api/aircraft').then(r=>r.ok?r.json():[]).catch(()=>[]);
  const found = allAc.find(a=>a.tail_number.toUpperCase()===tail);
  if (found) {
    _m.aircraft = _tailCache[tail] = found;
    status.textContent = '✓ in logbook'; status.style.color = 'var(--run)';
    renderAircraftEnrichCard(found);
    updateStep1Btn();
    // Background: enrich with mode_s_hex + performance if not already stored
    if (!found.mode_s_hex) {
      fetch('/api/external/aircraft/'+encodeURIComponent(tail))
        .then(r=>r.ok?r.json():null).then(reg => {
          if (!reg?.mode_s_hex) return;
          _m.aircraft.mode_s_hex = reg.mode_s_hex;
          _m.aircraft.performance = reg.performance || null;
          _m.aircraft.photo_url   = _m.aircraft.photo_url || reg.photo_url || null;
          _tailCache[tail] = _m.aircraft;
        }).catch(()=>{});
    }
    return;
  }

  // 2. FAA registry + adsbdb via proxy
  status.textContent = 'Searching FAA registry…'; status.style.color = 'var(--faint)';
  try {
    const reg = await fetch('/api/external/aircraft/'+encodeURIComponent(tail)).then(r=>r.ok?r.json():null).catch(()=>null);
    if (reg && reg.make) {
      const ac = {
        id: null, tail_number: tail, _fromReg: true,
        make: reg.make,
        model: reg.model,
        year: reg.year || null,
        engine_type: reg.engine_type || null,
        engine_hp: null,
        seats: reg.seats || null,
        ifr_equipped: null,
        glass_cockpit: null,
        type_code: reg.type_code || null,
        category: reg.category || 'Airplane',
        aircraft_class: reg.aircraft_class || 'ASEL',
        gear_type: reg.gear_type || 'fixed_tricycle',
        is_complex: reg.is_complex || false,
        is_high_performance: reg.is_high_performance || false,
        is_pressurized: false,
        mode_s_hex: reg.mode_s_hex || null,
        owner: reg.owner || null,
        photo_url: reg.photo_url || null,
        status: reg.status || null,
        _sources: reg.sources || [],
      };
      _m.aircraft = _tailCache[tail] = ac;
      const srcLabel = ac._sources.includes('faa_html') ? '✓ FAA registry' : '✓ found';
      status.textContent = srcLabel; status.style.color = 'oklch(65% 0.16 145)';
      renderAircraftEnrichCard(ac, true);
    } else {
      status.textContent = 'Not found in registry'; status.style.color = 'var(--faint)';
      document.getElementById('ms-ac-card').innerHTML =
        `<div style="font-size:12px;color:var(--faint);padding:10px 0">Not found. You can still continue and fill all fields manually.</div>`;
      _m.aircraft = { id:null, tail_number:tail, make:'', model:'', _unknown:true };
    }
  } catch(_) {
    status.textContent = ''; _m.aircraft = null;
  }
  updateStep1Btn();
}

function renderAircraftEnrichCard(ac, fromReg = false) {
  const card = document.getElementById('ms-ac-card');
  if (!card) return;
  const specs = [
    ac.engine_type && ['Engine', ac.engine_type + (ac.engine_hp ? ' · ' + ac.engine_hp + ' HP' : '')],
    ac.seats       && ['Seats',  ac.seats],
    ac.type_code   && ['ICAO Type', ac.type_code],
    ac.aircraft_class && ['Class', ac.aircraft_class],
    ac.gear_type   && ['Gear', ac.gear_type.replace(/_/g,' ')],
    ac.is_complex  && ['Complex', 'Yes'],
    ac.ifr_equipped != null && ['IFR', ac.ifr_equipped ? 'Equipped' : 'VFR only'],
    ac.glass_cockpit && ['Avionics', 'Glass cockpit'],
    ac.owner       && ['Owner', ac.owner],
    ac.status      && ac.status !== 'Valid' && ['Status', ac.status],
  ].filter(Boolean);

  const srcBadge = fromReg
    ? `<span style="font-size:10px;font-weight:400;color:var(--faint);margin-left:6px">
         ${(ac._sources||[]).join(' + ') || 'FAA registry'}
       </span>`
    : '';
  const unknownBadge = ac._unknown
    ? `<span style="font-size:10px;font-weight:400;color:var(--warn);margin-left:6px">specs unknown</span>`
    : '';

  const photoHtml = ac.photo_url
    ? `<img src="${esc(ac.photo_url)}" alt="Aircraft photo" style="max-width:100%;border-radius:4px;margin-top:8px;opacity:0.85">`
    : '';

  card.innerHTML = `
    <div class="ac-enrich">
      <div class="ac-enrich-title">
        <i class="ph-bold ph-airplane-tilt" style="color:var(--patina-text)"></i>
        ${esc(ac.tail_number)}${ac.make && ac.model ? ' — ' + esc(ac.make) + ' ' + esc(ac.model) : ''}${ac.year ? ' ' + ac.year : ''}
        ${srcBadge}${unknownBadge}
      </div>
      ${specs.length ? `<div class="ac-enrich-specs">${specs.map(([k,v]) => `<div><span class="ac-spec-k">${k}</span> <span class="ac-spec-v">${esc(String(v))}</span></div>`).join('')}</div>` : ''}
      ${photoHtml}
      ${fromReg && !ac.id ? `<div style="margin-top:10px">
        <button class="btn-link" onclick="addAircraftToDB()">
          <i class="ph-bold ph-plus-circle"></i> Add to my aircraft list
        </button>
        <span style="font-size:11px;color:var(--faint);margin-left:8px">HP, IFR, glass cockpit — fill in the form</span>
      </div>` : ''}
    </div>`;
}

async function addAircraftToDB() {
  if (!_m.aircraft || _m.aircraft.id) return;
  const ac = _m.aircraft;
  try {
    const res = await fetch('/api/aircraft', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tail_number:       ac.tail_number,
        make:              ac.make || 'Unknown',
        model:             ac.model || 'Unknown',
        year:              ac.year || null,
        engine_type:       ac.engine_type || null,
        engine_hp:         ac.engine_hp || null,
        seats:             ac.seats || null,
        ifr_equipped:      ac.ifr_equipped || false,
        glass_cockpit:     ac.glass_cockpit || false,
        type_code:         ac.type_code || null,
        category:          ac.category || 'Airplane',
        aircraft_class:    ac.aircraft_class || 'ASEL',
        gear_type:         ac.gear_type || 'fixed_tricycle',
        is_complex:        ac.is_complex || false,
        is_high_performance: ac.is_high_performance || false,
        mode_s_hex:        ac.mode_s_hex || null,
        notes: ac.owner ? `Owner: ${ac.owner}` : null,
      }),
    });
    if (!res.ok) throw new Error();
    const created = await res.json();
    _m.aircraft = _tailCache[ac.tail_number] = created;
    const status = document.getElementById('ms-tail-status');
    if (status) { status.textContent = '✓ added to logbook'; status.style.color = 'var(--run)'; }
    renderAircraftEnrichCard(created);
    updateStep1Btn();
  } catch(_) {}
}

async function onStep1Continue() {
  _m.date = document.getElementById('ms-date').value;
  _m.dep  = document.getElementById('ms-dep').value.trim().toUpperCase();
  const tail     = (_m.aircraft?.tail_number||'').toUpperCase();
  const modeS    = _m.aircraft?.mode_s_hex || null;

  // Fetch logbook entries + OpenSky detected flights in parallel
  const dbPromise = (tail && _m.date && _m.dep)
    ? fetch('/api/flights?'+new URLSearchParams({ date:_m.date, departure:_m.dep, tail })).then(r=>r.ok?r.json():[]).catch(()=>[])
    : Promise.resolve([]);

  const oskyPromise = (modeS && _m.date && _m.dep)
    ? fetch('/api/external/flights-detected?'+new URLSearchParams({ departure:_m.dep, date:_m.date, icao24:modeS })).then(r=>r.ok?r.json():{flights:[]}).catch(()=>({flights:[]}))
    : Promise.resolve({flights:[]});

  const [dbFlights, oskyResult] = await Promise.all([dbPromise, oskyPromise]);

  _m._matches   = Array.isArray(dbFlights) ? dbFlights : [];
  _m._detected  = oskyResult.flights || [];
  _m._oskyAuth  = oskyResult.needs_auth || false;

  renderModalStep2(_m._matches, _m._detected);
}

// Step 2 ──────────────────────────────────────────────────────────────────────
function renderModalStep2FromCache() { renderModalStep2(_m._matches||[], _m._detected||[]); }

function renderModalStep2(flights, detected = []) {
  _m.step = 2; showModalSteps(2);
  document.getElementById('modal-ft').style.display = 'none';
  if (_m.previewMap) { try{_m.previewMap.remove();}catch(_){} _m.previewMap=null; }

  const dateLabel = fmtCalDate(_m.date, {weekday:'long',month:'long',day:'numeric'});
  const tail = _m.aircraft?.tail_number || '';

  // Logbook entries (already in DB)
  const dbHTML = flights.map(f => {
    const col = typeColor(f.training_type);
    return `<div class="fpl-item" data-fid="${f.id}" data-src="db">
      <span class="fl-type-dot" style="background:${col}"></span>
      <div style="flex:1;min-width:0">
        <div class="fpl-route">${esc(routeLabel(f))}</div>
        <div class="fpl-meta">${esc(typeLabel(f.training_type))} · ${fmtHrs(f.total_duration)} · ${f.takeoffs||0} T/O · ${f.landings||0} Lnd</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:13px;font-weight:500;color:var(--body-text)">${fmtHrs(f.total_duration)}</div>
        <div style="font-size:11px;color:var(--faint)">in logbook</div>
      </div>
    </div>`;
  }).join('');

  // OpenSky-detected flights not already in DB (filter by arrival icao to avoid dupes)
  const dbArrivals = new Set(flights.map(f=>f.arrival_icao));
  const newDetected = detected.filter(d => !dbArrivals.has(d.arrival_icao));
  const detectedHTML = newDetected.map((d, i) => {
    const dep = d.departure_time ? new Date(d.departure_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/Los_Angeles'}) : '';
    const dur = d.duration_min != null ? `${Math.floor(d.duration_min/60)}h ${d.duration_min%60}m` : '';
    const arr = d.arrival_icao || 'Unknown arrival';
    return `<div class="fpl-item fpl-detected" data-did="${i}" data-src="osky"
              onclick="onOskyFlightSelected(${JSON.stringify(JSON.stringify(d)).slice(1,-1)})">
      <span class="fl-type-dot" style="background:var(--patina-text)"></span>
      <div style="flex:1;min-width:0">
        <div class="fpl-route">${esc(_m.dep)} → ${esc(arr)}</div>
        <div class="fpl-meta">ADS-B detected${dep?' · '+dep+' local':''} ${dur?'· '+dur:''}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:11px;color:var(--patina-text);font-weight:500">Import</div>
        <div style="font-size:10px;color:var(--faint)">OpenSky</div>
      </div>
    </div>`;
  }).join('');

  const hasAny = flights.length > 0 || newDetected.length > 0;
  const oskyNote = _m._oskyAuth
    ? `<div style="margin-top:12px;padding:10px 12px;background:var(--graphite);border-radius:6px;font-size:11px;color:var(--faint)">
         <i class="ph-bold ph-info"></i>
         Add <code>OPENSKY_CLIENT_ID</code> and <code>OPENSKY_CLIENT_SECRET</code> to your .env for historical ADS-B flight detection.
         Get credentials at <a href="https://opensky-network.org" target="_blank" style="color:var(--patina-text)">opensky-network.org</a> → My OpenSky → API Access
       </div>`
    : (newDetected.length > 0 ? `<div style="font-size:11px;color:var(--faint);margin-top:8px;padding:0 4px"><i class="ph-bold ph-broadcast"></i> ADS-B routes detected via OpenSky Network — click to import</div>` : '');

  document.getElementById('modal-bd').innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:18px">
      <button class="btn-link" onclick="renderModalStep1()" style="font-size:13px">
        <i class="ph-bold ph-caret-left"></i> Back
      </button>
      <div style="font-size:13px;color:var(--muted)">
        ${esc(tail)} from <strong style="color:var(--champagne)">${esc(_m.dep)}</strong>
        on <strong style="color:var(--champagne)">${esc(dateLabel)}</strong>
      </div>
    </div>
    ${hasAny ? `
      ${flights.length ? `<div id="modal-preview-map"></div>` : ''}
      <div class="fpl">
        ${dbHTML}
        ${detectedHTML}
        <div class="fpl-new" onclick="onModalNewFlight()">
          <i class="ph-bold ph-plus-circle"></i> Log a new flight on this date
        </div>
      </div>
      ${oskyNote}` :
    `<div style="padding:24px 0 16px;text-align:center">
       <i class="ph-bold ph-airplane-landing" style="font-size:36px;color:var(--faint);display:block;margin-bottom:12px"></i>
       <div style="color:var(--muted);font-size:13px">No existing entries found for this aircraft on ${esc(dateLabel)}.</div>
     </div>
     ${oskyNote}
     <button class="btn-primary" style="margin-top:16px" onclick="onModalNewFlight()">
       <i class="ph-bold ph-plus"></i> Log this flight
     </button>`
    }`;

  if (flights.length) {
    requestAnimationFrame(() => initPreviewMap(flights));
    document.querySelectorAll('.fpl-item[data-src="db"]').forEach(item => {
      item.addEventListener('click', () => {
        document.querySelectorAll('.fpl-item').forEach(i=>i.classList.remove('sel'));
        item.classList.add('sel');
        const fid = item.dataset.fid;
        const f = flights.find(x=>String(x.id)===fid);
        if (f) { highlightRoute(String(f.id)); onModalFlightSelected(f); }
      });
      item.addEventListener('mouseenter', () => highlightRoute(item.dataset.fid));
      item.addEventListener('mouseleave', () => highlightRoute(null));
    });
  }
}

async function onOskyFlightSelected(detectedJson) {
  const d = JSON.parse(detectedJson);
  document.querySelectorAll('.fpl-item').forEach(i=>i.classList.remove('sel'));
  document.querySelector(`.fpl-detected[data-did="${d._idx||0}"]`)?.classList.add('sel');

  // Fetch GPS track in background
  if (d.icao24 && d.first_seen_unix) {
    fetch(`/api/external/flight-track?icao24=${encodeURIComponent(d.icao24)}&time=${d.first_seen_unix}`)
      .then(r=>r.ok?r.json():null)
      .then(tr => { if (tr?.track?.path?.length) _m._oskyTrack = tr.track; })
      .catch(()=>{});
  }

  // Pre-populate Step 3 as a new flight with detected values
  _m.editId = null;
  _m._oskyDetected = d;
  document.getElementById('modal-title').textContent = 'Log Detected Flight';
  renderModalStep3(null, d);
}

function initPreviewMap(flights) {
  const container = document.getElementById('modal-preview-map');
  if (!container || _m.previewMap) return;
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  _m.previewMap = new maplibregl.Map({
    container: 'modal-preview-map', zoom: 8, attributionControl: false,
    style: dark
      ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
      : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
    center: [flights[0]?.departure?.lon||-122, flights[0]?.departure?.lat||37.5],
  });
  _m.previewMap.addControl(new maplibregl.AttributionControl({compact:true}), 'bottom-right');
  _m.previewMap.on('load', () => {
    const allCoords = [];
    flights.forEach(f => {
      const coords = flightCoords(f);
      if (coords.length < 2) return;
      allCoords.push(...coords);
      const col = typeColor(f.training_type);
      _m.previewMap.addSource('fl'+f.id, { type:'geojson', data:{type:'Feature',geometry:{type:'LineString',coordinates:coords}} });
      _m.previewMap.addLayer({ id:'fl'+f.id+'g', type:'line', source:'fl'+f.id, paint:{'line-color':col,'line-width':6,'line-opacity':0.15,'line-blur':4} });
      _m.previewMap.addLayer({ id:'fl'+f.id, type:'line', source:'fl'+f.id, paint:{'line-color':col,'line-width':2,'line-opacity':0.75,'line-dasharray':[2,0]} });
    });
    const aptSet = {}, aptFeats = [];
    flights.forEach(f => {
      [f.departure,...(f.via_airports||[]),f.arrival].forEach(a => {
        if (a?.lon && !aptSet[a.icao]) { aptSet[a.icao]=1; aptFeats.push({type:'Feature',properties:{icao:a.icao},geometry:{type:'Point',coordinates:[a.lon,a.lat]}}); }
      });
    });
    if (aptFeats.length) {
      _m.previewMap.addSource('pmapts',{type:'geojson',data:{type:'FeatureCollection',features:aptFeats}});
      _m.previewMap.addLayer({id:'pmapts',type:'circle',source:'pmapts',paint:{'circle-radius':5,'circle-color':'#d4a520','circle-stroke-width':1.5,'circle-stroke-color':'#0a0909'}});
    }
    if (allCoords.length) {
      const b = allCoords.reduce((b,c)=>b.extend(c), new maplibregl.LngLatBounds(allCoords[0],allCoords[0]));
      _m.previewMap.fitBounds(b, {padding:40,duration:400});
    }
  });
}

function flightCoords(f) {
  const c = [];
  if (f.departure?.lon) c.push([f.departure.lon, f.departure.lat]);
  (f.via_airports||[]).forEach(a => { if(a?.lon) c.push([a.lon,a.lat]); });
  if (f.arrival?.lon) c.push([f.arrival.lon, f.arrival.lat]);
  return c;
}

function highlightRoute(activeId) {
  if (!_m.previewMap || !_m._matches) return;
  _m._matches.forEach(f => {
    const lid = 'fl'+f.id, gid = lid+'g';
    if (!_m.previewMap.getLayer(lid)) return;
    const isActive = activeId === null || String(f.id) === String(activeId);
    _m.previewMap.setPaintProperty(lid,'line-width', isActive ? 3 : 1.5);
    _m.previewMap.setPaintProperty(lid,'line-opacity', isActive ? 1 : 0.3);
    _m.previewMap.setPaintProperty(gid,'line-opacity', isActive ? 0.25 : 0.05);
  });
}

function onModalNewFlight() { _m.editId = null; document.getElementById('modal-title').textContent='Log Flight'; renderModalStep3(null); }
function onModalFlightSelected(f) { _m.editId = String(f.id); document.getElementById('modal-title').textContent='Edit Flight'; renderModalStep3(f); }

// Step 3 ──────────────────────────────────────────────────────────────────────
async function renderModalStep3(existing, detected = null) {
  _m.step = 3; showModalSteps(3);
  if (_m.previewMap) { try{_m.previewMap.remove();}catch(_){} _m.previewMap=null; }

  const allAc = await fetch('/api/aircraft').then(r=>r.ok?r.json():[]).catch(()=>[]);
  const allIns = await fetch('/api/instructors').then(r=>r.ok?r.json():[]).catch(()=>[]);

  const acOpts = allAc.map(a=>`<option value="${a.id}">${esc(a.tail_number)} — ${esc(a.make)} ${esc(a.model)}</option>`).join('');
  const insOpts = allIns.map(i=>`<option value="${i.id}">${esc(i.name)}</option>`).join('');
  const typeOpts = Object.entries(TYPE_CFG).map(([k,v])=>`<option value="${k}">${esc(v.label)}</option>`).join('');

  const editId = _m.editId || (existing?.id ? String(existing.id) : '');

  document.getElementById('modal-bd').innerHTML = `
  <form id="mf-form" novalidate>
    <input type="hidden" name="mf_edit_id" value="${editId}">

    <!-- ROUTE -->
    <div class="section-label" style="margin-bottom:14px">Route</div>
    <div class="form-grid" style="grid-template-columns:120px 1fr 120px 120px;gap:12px;margin-bottom:12px">
      <div class="form-field">
        <label class="form-label">Date</label>
        <input class="form-input" type="date" name="date" value="${existing?.date||_m.date||new Date().toISOString().slice(0,10)}" required>
      </div>
      <div class="form-field">
        <label class="form-label">Aircraft</label>
        <select class="form-select" name="aircraft_id" required>
          <option value="">Select…</option>${acOpts}
        </select>
      </div>
      <div class="form-field">
        <label class="form-label">Departure</label>
        <input class="form-input" type="text" name="departure_icao" placeholder="KSQL"
          value="${existing?.departure?.icao||detected?.departure_icao||_m.dep||''}" maxlength="6" style="text-transform:uppercase"
          id="mf-dep" oninput="onMFRouteChange()">
      </div>
      <div class="form-field">
        <label class="form-label">Training Type</label>
        <select class="form-select" name="training_type"><option value="">—</option>${typeOpts}</select>
      </div>
    </div>
    <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:12px;margin-bottom:0">
      <div class="form-field">
        <label class="form-label">Via Airports <span style="font-weight:400;text-transform:none;letter-spacing:0">(comma-sep)</span></label>
        <input class="form-input" type="text" name="via" placeholder="KHAF, KPAO"
          value="${existing?.via?.join(', ')||''}" style="text-transform:uppercase">
      </div>
      <div class="form-field">
        <label class="form-label">Arrival</label>
        <input class="form-input" type="text" name="arrival_icao" placeholder="KWVI"
          value="${existing?.arrival?.icao||(detected?.arrival_icao||'')}" maxlength="6" style="text-transform:uppercase"
          id="mf-arr" oninput="onMFRouteChange()">
      </div>
    </div>
    ${detected ? `<div style="margin-top:8px;padding:8px 12px;background:var(--graphite);border-radius:6px;font-size:11px;color:var(--patina-text)">
      <i class="ph-bold ph-broadcast"></i>
      ADS-B detected via OpenSky · Dep ${detected.departure_time ? new Date(detected.departure_time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'America/Los_Angeles'})+' local' : ''}${detected.duration_min?' · '+Math.floor(detected.duration_min/60)+'h '+detected.duration_min%60+'m':''}
      — verify and complete the fields below
    </div>` : ''}

    <!-- Airport info cards (async) -->
    <div id="mf-airport-strip" class="info-strip" style="margin-bottom:20px"></div>

    <!-- AIRCRAFT enrichment (from step 1 or existing flight) -->
    <div id="mf-ac-enrich" style="margin-bottom:20px"></div>
    <div class="form-grid" style="grid-template-columns:1fr;margin-bottom:20px">
      <div class="form-field">
        <label class="form-label">Instructor (optional)</label>
        <select class="form-select" name="instructor_id">
          <option value="">None / solo</option>${insOpts}
        </select>
      </div>
    </div>

    <hr class="detail-rule" style="margin:20px 0">

    <!-- FLIGHT TIME -->
    <div class="section-label" style="margin-bottom:14px">
      Flight Time <span style="font-weight:400;text-transform:none;letter-spacing:0;font-size:11px">(hours)</span>
    </div>
    <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-bottom:12px">
      ${mfNum('total_duration','Total',true)}
      ${mfNum('dual_received','Dual Rcvd')}
      ${mfNum('dual_given','Dual Given')}
      ${mfNum('pic','PIC')}
      ${mfNum('solo','Solo')}
      ${mfNum('sic','SIC')}
    </div>
    <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:10px;margin-bottom:0">
      ${mfNum('cross_country','X-Country')}
      ${mfNum('night','Night')}
      ${mfNum('actual_instrument','Actual IFR')}
      ${mfNum('instrument','Sim Inst')}
    </div>

    <!-- Weather cards (async, keyed to departure time) -->
    <div id="mf-weather-strip" class="info-strip" style="margin-bottom:0"></div>

    <hr class="detail-rule" style="margin:20px 0">

    <!-- OPERATIONS -->
    <div class="section-label" style="margin-bottom:14px">Operations</div>
    <div class="form-grid" style="grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:10px;margin-bottom:20px">
      ${mfInt('takeoffs','Takeoffs')}
      ${mfInt('landings','Landings')}
      ${mfInt('night_takeoffs','Night T/O')}
      ${mfInt('night_landings','Night Ldg')}
      ${mfInt('holds','Holds')}
      ${mfNum('distance_nm','Distance nm')}
    </div>

    <!-- APPROACHES -->
    <div class="section-label" style="margin-bottom:12px">Approaches</div>
    <div id="mf-approach-rows"></div>
    <button type="button" class="btn-link" onclick="addMFApproach()" style="margin-bottom:20px">
      <i class="ph-bold ph-plus-circle"></i> Add approach
    </button>

    <hr class="detail-rule" style="margin:20px 0">

    <!-- REMARKS -->
    <div class="section-label" style="margin-bottom:12px">Remarks</div>
    <div class="form-field" style="margin-bottom:20px">
      <textarea class="form-textarea" name="remarks" rows="3"
        placeholder="Route narrative, conditions, lessons…">${esc(existing?.remarks||'')}</textarea>
    </div>

    <!-- HOBBS / TACH (collapsible) -->
    <div class="section-label" style="margin-bottom:12px;cursor:pointer" id="mf-hobbs-toggle" onclick="toggleMFHobbs()">
      Hobbs &amp; Tach <span id="mf-hobbs-icon" style="font-size:11px;color:var(--faint)">▸ expand</span>
    </div>
    <div id="mf-hobbs-fields" style="display:none;margin-bottom:20px">
      <div class="form-grid" style="grid-template-columns:repeat(4,1fr);gap:10px">
        ${mfNum('hobbs_start','Hobbs Start')}
        ${mfNum('hobbs_end','Hobbs End')}
        ${mfNum('tach_start','Tach Start')}
        ${mfNum('tach_end','Tach End')}
      </div>
    </div>

    <div id="mf-error" class="form-error"></div>
  </form>`;

  document.getElementById('modal-ft').style.display = 'flex';
  document.getElementById('modal-ft').innerHTML = `
    <button class="btn-primary" id="mf-submit" onclick="handleMFSubmit(event)">
      <i class="ph-bold ph-paper-plane-tilt"></i> ${editId ? 'Save Changes' : 'Log Flight'}
    </button>
    <button class="btn-ghost" onclick="closeFlightModal()">Cancel</button>
    <div id="mf-save-status" style="margin-left:auto;font-size:12px;color:var(--faint)"></div>`;

  // Pre-populate existing flight data or detected flight data
  if (existing) {
    populateMFForm(existing, allAc, allIns);
  } else {
    // Pre-fill aircraft from step 1
    if (_m.aircraft?.id) {
      const sel = document.querySelector('[name="aircraft_id"]');
      if (sel) sel.value = _m.aircraft.id;
    }
    // Pre-fill duration from detected flight
    if (detected?.duration_min) {
      const hrs = (detected.duration_min / 60).toFixed(1);
      const dur = document.querySelector('[name="total_duration"]');
      if (dur) dur.value = hrs;
    }
    // Pre-fill times from detected flight
    if (detected?.departure_time) {
      const tout = document.querySelector('[name="time_out"]');
      if (tout) tout.value = detected.departure_time;
    }
    if (detected?.arrival_time) {
      const tin = document.querySelector('[name="time_in"]');
      if (tin) tin.value = detected.arrival_time;
    }
  }

  // Show aircraft card with performance data from step 1 registry lookup
  const acToShow = existing?.aircraft || (_m.aircraft?.id ? _m.aircraft : null);
  if (acToShow) {
    document.getElementById('mf-ac-enrich').innerHTML = buildSmallAircraftCard(acToShow, _m.aircraft?.performance);
  } else {
    document.getElementById('mf-ac-enrich').remove?.();
  }

  // Load enrichment asynchronously
  loadMFEnrichment(existing || (detected ? { departure: { icao: _m.dep }, arrival: { icao: detected.arrival_icao }, date: _m.date, time_out: detected.departure_time } : null));
}

function mfNum(name, label, req='') {
  return `<div class="form-field">
    <label class="form-label">${label}</label>
    <input class="form-input" type="number" name="${name}" step="0.1" min="0" placeholder="0.0" ${req?'required':''}>
  </div>`;
}
function mfInt(name, label) {
  return `<div class="form-field">
    <label class="form-label">${label}</label>
    <input class="form-input" type="number" name="${name}" step="1" min="0" placeholder="0">
  </div>`;
}

function toggleMFHobbs() {
  const f = document.getElementById('mf-hobbs-fields');
  const i = document.getElementById('mf-hobbs-icon');
  const open = f.style.display !== 'none';
  f.style.display = open ? 'none' : 'grid';
  if (i) i.textContent = open ? '▸ expand' : '▾ collapse';
}

function addMFApproach(data={}) {
  const container = document.getElementById('mf-approach-rows');
  if (!container) return;
  const row = document.createElement('div');
  row.className = 'approach-row';
  row.innerHTML = `
    <select class="form-select ap-type">
      <option value="">Type…</option>
      ${['ILS','RNAV (GPS)','VOR','NDB','LOC','LOC/BC','LDA','SDF','Visual'].map(t=>`<option value="${t}" ${data.approach_type===t?'selected':''}>${t}</option>`).join('')}
    </select>
    <input class="form-input ap-icao" type="text" placeholder="ICAO" maxlength="6"
      style="text-transform:uppercase" value="${esc(data.airport_icao||'')}">
    <input class="form-input ap-rwy" type="text" placeholder="Rwy" maxlength="4"
      value="${esc(data.runway||'')}">
    <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--muted);white-space:nowrap">
      <input type="checkbox" class="ap-ctl" ${data.circle_to_land?'checked':''}> C/L
    </label>
    <button type="button" class="ap-rm" title="Remove" onclick="this.closest('.approach-row').remove()">
      <i class="ph-bold ph-x"></i>
    </button>`;
  container.appendChild(row);
}

function buildSmallAircraftCard(ac, perf) {
  if (!ac) return '';
  const p = perf || ac._perf || null;
  const specs = [
    ac.engine_type && `<span class="ac-spec-k">Engine</span> <span class="ac-spec-v">${esc(ac.engine_type)}${ac.engine_hp?' · '+ac.engine_hp+' HP':p?.engine_hp?' · '+p.engine_hp+' HP':''}</span>`,
    (ac.seats||p) && `<span class="ac-spec-k">Seats</span> <span class="ac-spec-v">${ac.seats||'—'}</span>`,
    ac.aircraft_class && `<span class="ac-spec-k">Class</span> <span class="ac-spec-v">${esc(ac.aircraft_class)}</span>`,
    ac.type_code && `<span class="ac-spec-k">ICAO</span> <span class="ac-spec-v">${esc(ac.type_code)}</span>`,
    ac.gear_type && `<span class="ac-spec-k">Gear</span> <span class="ac-spec-v">${esc(ac.gear_type.replace(/_/g,' '))}</span>`,
    p?.mtow_lbs && `<span class="ac-spec-k">MTOW</span> <span class="ac-spec-v">${p.mtow_lbs.toLocaleString()} lbs</span>`,
    p?.cruise_ktas && `<span class="ac-spec-k">Cruise</span> <span class="ac-spec-v">${p.cruise_ktas} KTAS</span>`,
    p?.service_ceiling_ft && `<span class="ac-spec-k">Ceiling</span> <span class="ac-spec-v">${p.service_ceiling_ft.toLocaleString()} ft</span>`,
    p?.range_nm && `<span class="ac-spec-k">Range</span> <span class="ac-spec-v">${p.range_nm} nm</span>`,
    p?.fuel_gal && `<span class="ac-spec-k">Fuel</span> <span class="ac-spec-v">${p.fuel_gal} gal · ~${p.fuel_burn_gph} GPH</span>`,
    ac.ifr_equipped!=null && `<span class="ac-spec-k">IFR</span> <span class="ac-spec-v">${ac.ifr_equipped?'Equipped':'VFR only'}</span>`,
    ac.is_complex && `<span class="ac-spec-k">Complex</span> <span class="ac-spec-v">Yes</span>`,
  ].filter(Boolean);

  // V-speeds table (from POH reference)
  const vSpeeds = p ? [
    p.vs0_kts && `Vs0: ${p.vs0_kts}`,
    p.vs1_kts && `Vs1: ${p.vs1_kts}`,
    p.vx_kts  && `Vx: ${p.vx_kts}`,
    p.vy_kts  && `Vy: ${p.vy_kts}`,
    p.va_kts  && `Va: ${p.va_kts}`,
    p.vno_kts && `Vno: ${p.vno_kts}`,
    p.vne_kts && `Vne: ${p.vne_kts}`,
  ].filter(Boolean) : [];

  const photoUrl = ac.photo_url || ac._photoUrl || null;

  return `<div class="ac-enrich">
    <div style="display:flex;gap:12px;align-items:flex-start">
      ${photoUrl ? `<img src="${esc(photoUrl)}" alt="${esc(ac.tail_number)}" style="width:80px;height:52px;object-fit:cover;border-radius:4px;flex-shrink:0;opacity:0.9">` : ''}
      <div style="flex:1;min-width:0">
        <div class="ac-enrich-title">
          <i class="ph-bold ph-airplane-tilt" style="color:var(--patina-text)"></i>
          ${esc(ac.tail_number)}${ac.make&&ac.model?' — '+esc(ac.make)+' '+esc(ac.model):''}${ac.year?' '+ac.year:''}
        </div>
        ${specs.length?`<div class="ac-enrich-specs" style="display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:6px">${specs.map(s=>`<div>${s}</div>`).join('')}</div>`:''}
      </div>
    </div>
    ${vSpeeds.length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--rule);display:flex;flex-wrap:wrap;gap:4px 16px">
      <span style="font-size:10px;color:var(--faint);text-transform:uppercase;letter-spacing:0.05em;align-self:center">V-speeds (kts)</span>
      ${vSpeeds.map(v=>`<span style="font-size:11px;font-family:var(--mono);color:var(--muted)">${v}</span>`).join('')}
    </div>` : ''}
    ${ac.notes?`<div style="font-size:12px;color:var(--muted);margin-top:6px">${esc(ac.notes)}</div>`:''}
  </div>`;
}

function populateMFForm(f, allAc, allIns) {
  const form = document.getElementById('mf-form');
  if (!form) return;
  const set = (name, val) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el && val != null && val !== '') el.value = val;
  };
  set('date', f.date);
  set('aircraft_id', f.aircraft?.id);
  set('departure_icao', f.departure?.icao||'');
  set('arrival_icao', f.arrival?.icao||'');
  set('via', (f.via||[]).join(', '));
  set('training_type', f.training_type);
  if (f.instructor_id) set('instructor_id', f.instructor_id);

  const nums = ['total_duration','dual_received','dual_given','pic','sic','solo','cross_country','night','actual_instrument','holds','distance_nm','hobbs_start','hobbs_end','tach_start','tach_end'];
  nums.forEach(n => { const v = n==='instrument'?f.simulated_instrument:f[n]; if(v>0) set(n, parseFloat(v).toFixed(1)); });
  set('instrument', f.simulated_instrument > 0 ? parseFloat(f.simulated_instrument).toFixed(1) : '');
  ['takeoffs','landings','night_takeoffs','night_landings','holds'].forEach(n=>{if(f[n]>0)set(n,f[n]);});
  set('remarks', f.remarks||'');

  // Hobbs/Tach
  if (f.hobbs_start||f.hobbs_end||f.tach_start||f.tach_end) {
    document.getElementById('mf-hobbs-fields').style.display = 'grid';
    const icon = document.getElementById('mf-hobbs-icon');
    if (icon) icon.textContent = '▾ collapse';
    ['hobbs_start','hobbs_end','tach_start','tach_end'].forEach(n=>{if(f[n])set(n,f[n]);});
  }

  // Approaches
  for (const ap of f.approaches||[]) addMFApproach(ap);
}

let _mfRouteTimer;
function onMFRouteChange() {
  clearTimeout(_mfRouteTimer);
  _mfRouteTimer = setTimeout(loadMFEnrichment, 800);
}

async function loadMFEnrichment(existing) {
  const form = document.getElementById('mf-form');
  if (!form) return;
  const g = n => (form.querySelector(`[name="${n}"]`)?.value||'').trim().toUpperCase();
  const dep = g('departure_icao') || existing?.departure?.icao || _m.dep || '';
  const arr = g('arrival_icao')   || existing?.arrival?.icao  || '';
  const date = form.querySelector('[name="date"]')?.value || existing?.date || _m.date || '';
  const timeOut = existing?.time_out || (date ? date+'T14:00:00Z' : null);

  // Airport strip
  const aptStrip = document.getElementById('mf-airport-strip');
  if (aptStrip && (dep||arr)) {
    const icaos = [dep, arr].filter(Boolean);
    aptStrip.innerHTML = icaos.map(ic=>`
      <div class="info-card" id="apt-card-${ic}">
        <div class="info-card-hd"><i class="ph-bold ph-map-pin"></i> ${ic}</div>
        <div class="spinner" style="width:12px;height:12px"></div>
      </div>`).join('');
    icaos.forEach(async ic => {
      const card = document.getElementById('apt-card-'+ic);
      if (!card) return;
      try {
        // Try our local DB first
        const local = await fetch('/api/airports/'+ic).then(r=>r.ok?r.json():null).catch(()=>null);
        if (local) {
          card.innerHTML = buildAptCard(local, ic);
        } else {
          const ext = await fetch('/api/external/airport/'+ic).then(r=>r.ok?r.json():null).catch(()=>null);
          card.innerHTML = ext ? buildAptCardExt(ext, ic) : buildAptCardUnknown(ic);
        }
      } catch(_) { card.innerHTML = buildAptCardUnknown(ic); }
    });
  }

  // Weather strip
  const wxStrip = document.getElementById('mf-weather-strip');
  if (wxStrip && (dep||arr) && date) {
    const icaos = [dep, arr].filter(Boolean);
    wxStrip.innerHTML = `<div style="grid-column:1/-1;font-size:11px;color:var(--faint);margin-top:4px;margin-bottom:2px"><i class="ph-bold ph-cloud"></i> Weather near ${date}</div>`
      + icaos.map(ic=>`
      <div class="info-card" id="wx-card-${ic}">
        <div class="info-card-hd"><i class="ph-bold ph-cloud-sun"></i> METAR · ${ic}</div>
        <div class="spinner" style="width:12px;height:12px"></div>
      </div>`).join('');
    icaos.forEach(async ic => {
      const card = document.getElementById('wx-card-'+ic);
      if (!card) return;
      try {
        const qs = timeOut ? `?time=${encodeURIComponent(timeOut)}` : '';
        const wx = await fetch(`/api/external/metar/${ic}${qs}`).then(r=>r.ok?r.json():null).catch(()=>null);
        card.innerHTML = buildWeatherCard(wx, ic);
      } catch(_) { card.innerHTML = buildWeatherCardEmpty(ic); }
    });
  }
}

function buildAptCard(a, icao) {
  return `<div class="info-card-hd"><i class="ph-bold ph-map-pin"></i> ${icao}</div>
    <div class="info-card-icao">${esc(a.icao||icao)}</div>
    <div class="info-card-name">${esc(a.name||'')}</div>
    <div class="info-card-meta">${[a.city,a.state].filter(Boolean).join(', ')}${a.elevation_ft?' · '+a.elevation_ft+' ft MSL':''}</div>`;
}
function buildAptCardExt(a, icao) {
  return `<div class="info-card-hd"><i class="ph-bold ph-map-pin"></i> ${icao}</div>
    <div class="info-card-icao">${esc(a.icaoId||icao)}</div>
    <div class="info-card-name">${esc(a.name||a.stnName||'')}</div>
    <div class="info-card-meta">${[a.state,a.country].filter(Boolean).join(', ')}${a.elev?' · '+a.elev+' ft':''}</div>`;
}
function buildAptCardUnknown(icao) {
  return `<div class="info-card-hd"><i class="ph-bold ph-map-pin"></i> ${icao}</div>
    <div class="info-card-icao">${esc(icao)}</div>
    <div class="info-card-meta" style="color:var(--faint)">No data available</div>`;
}

function buildWeatherCard(wx, icao) {
  if (!wx?.metar) return buildWeatherCardEmpty(icao);
  const m = wx.metar;
  const raw = m.rawOb || m.rawObservation || '';
  const time = m.obsTime || m.reportTime || '';
  const timeStr = time ? new Date(time).toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC' : '';
  // Decode key fields
  const decoded = [
    m.temp!=null && `${m.temp}°C`,
    m.dewpoint!=null && `Dew ${m.dewpoint}°C`,
    m.wspd!=null && `Wind ${m.wdir||'VRB'}°/${m.wspd}kt${m.wgst?' G'+m.wgst:''}`,
    m.visib!=null && `Vis ${m.visib} SM`,
    m.altim!=null && `Alt ${m.altim.toFixed(2)} inHg`,
    m.wxString && m.wxString,
    m.skyCondition && m.skyCondition.map(s=>`${s.skyCover}@${s.cloudBase||0}`).join(' '),
    m.flightCategory && `<span style="color:${m.flightCategory==='VFR'?'var(--run)':m.flightCategory==='MVFR'?'oklch(80% 0.17 85)':m.flightCategory==='IFR'?'var(--warn)':'oklch(68% 0.15 235)'}">${m.flightCategory}</span>`,
  ].filter(Boolean);

  return `<div class="info-card-hd"><i class="ph-bold ph-cloud-sun"></i> METAR · ${icao}${timeStr?' · '+timeStr:''}</div>
    ${raw ? `<div class="metar-raw">${esc(raw)}</div>` : ''}
    ${decoded.length ? `<div class="metar-decoded">${decoded.join(' · ')}</div>` : ''}
    <div style="font-size:10px;color:var(--faint);margin-top:4px">Source: ${wx.source==='mesonet'?'Iowa State Mesonet':'NOAA/AWC'}</div>`;
}
function buildWeatherCardEmpty(icao) {
  return `<div class="info-card-hd"><i class="ph-bold ph-cloud"></i> METAR · ${icao}</div>
    <div style="font-size:12px;color:var(--faint)">No METAR available</div>`;
}

async function handleMFSubmit(e) {
  e.preventDefault();
  const form = document.getElementById('mf-form');
  const submitBtn = document.getElementById('mf-submit');
  const errEl = document.getElementById('mf-error');
  const status = document.getElementById('mf-save-status');
  if (!form) return;
  errEl.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<div class="spinner" style="width:14px;height:14px"></div>';

  const g = n => { const el = form.querySelector(`[name="${n}"]`); return el ? el.value : ''; };
  const fv = n => parseFloat(g(n))||0;
  const iv = n => parseInt(g(n))||0;
  const sv = n => g(n).trim()||null;
  const editId = g('mf_edit_id');

  const viaRaw = g('via').trim();
  const via = viaRaw ? viaRaw.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean) : [];

  const approaches = Array.from(document.querySelectorAll('#mf-approach-rows .approach-row')).map(row=>({
    approach_type: row.querySelector('.ap-type')?.value||'',
    airport_icao: (row.querySelector('.ap-icao')?.value||'').trim().toUpperCase(),
    runway: (row.querySelector('.ap-rwy')?.value||'').trim(),
    circle_to_land: row.querySelector('.ap-ctl')?.checked||false,
  })).filter(a=>a.approach_type&&a.airport_icao);

  const body = {
    date: g('date'), aircraft_id: parseInt(g('aircraft_id'))||null,
    departure_icao: g('departure_icao').toUpperCase(),
    arrival_icao: g('arrival_icao').toUpperCase(),
    via, training_type: sv('training_type'),
    total_duration: fv('total_duration'),
    dual_received: fv('dual_received'), dual_given: fv('dual_given'),
    pic: fv('pic'), sic: fv('sic'), solo: fv('solo'),
    cross_country: fv('cross_country'), night: fv('night'),
    actual_instrument: fv('actual_instrument'), instrument: fv('instrument'),
    takeoffs: iv('takeoffs'), landings: iv('landings'),
    night_takeoffs: iv('night_takeoffs'), night_landings: iv('night_landings'),
    holds: iv('holds'),
    distance_nm: sv('distance_nm') ? parseFloat(sv('distance_nm')) : null,
    hobbs_start: sv('hobbs_start') ? parseFloat(sv('hobbs_start')) : null,
    hobbs_end: sv('hobbs_end') ? parseFloat(sv('hobbs_end')) : null,
    tach_start: sv('tach_start') ? parseFloat(sv('tach_start')) : null,
    tach_end: sv('tach_end') ? parseFloat(sv('tach_end')) : null,
    instructor_id: sv('instructor_id') ? parseInt(sv('instructor_id')) : null,
    remarks: sv('remarks'), approaches,
  };

  const isEdit = !!editId;
  const url = isEdit ? '/api/flights/'+editId : '/api/flights';
  try {
    const res = await fetch(url, {
      method: isEdit ? 'PUT' : 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(()=>({}));
      throw new Error(d.error || `Error ${res.status}`);
    }
    if (status) status.textContent = 'Saved ✓';
    await loadFlights();
    closeFlightModal();
    if (isEdit) navigate('flight', editId);
  } catch(err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<i class="ph-bold ph-paper-plane-tilt"></i> ${isEdit?'Save Changes':'Log Flight'}`;
  }
}
