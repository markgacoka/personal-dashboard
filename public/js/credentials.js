'use strict';

// ─── Pilot Credentials ────────────────────────────────────────────────────────
const CERTS = {
  studentPilot: {
    name:        'GACOKA MBUI',
    address:     '1750 Stokes St Apt 58\nSan Jose CA 95126-4784',
    nationality: 'Kenya',
    dob:         'Sep 25, 2000',
    sex:         'Male',
    height:      "5'7\" (67 in)",
    weight:      '168 lbs',
    hair:        'Black',
    eyes:        'Brown',
    certNumber:  '5197811',
    issueDate:   new Date('2025-07-31'),
    // Under 40: valid 60 calendar months from month of issue (14 CFR 61.19)
    expiryDate:  new Date('2030-07-31'),
    limitations: ['Carrying passengers is prohibited'],
    ratings:     [],
    administrator: 'Bryan Bedford',
    issuedBy:    'Federal Aviation Administration',
  },
  medical: {
    name:        'GACOKA MBUI',
    address:     '1750 Stokes St Apt 58\nSan Jose CA 95126 USA',
    dob:         'September 25, 2000',
    height:      "5'7\" (67 in)",
    weight:      '149 lbs',
    hair:        'Black',
    eyes:        'Brown',
    sex:         'Male',
    certClass:   'Third Class',
    examDate:    new Date('2025-08-22'),
    // Under 40: valid 60 calendar months from month of examination (14 CFR 61.23)
    expiryDate:  new Date('2030-08-31'),
    limitations: ['None'],
    examDesig:   '000003574',
    examiner:    'Tiffany Davies, MD',
    applicantId: '2002643954',
    controlNo:   '200011744502',
    formNo:      'FAA Form 8500-9',
    issuedBy:    'Federal Aviation Administration',
  },
}

function certValidityClass(daysLeft) {
  if (daysLeft > 365) return 'good'
  if (daysLeft > 90)  return 'warn'
  return 'crit'
}

function certDaysLeft(expiryDate) {
  return Math.max(0, Math.floor((expiryDate - Date.now()) / 86400000))
}

function certBarPct(issueDate, expiryDate) {
  const total = expiryDate - issueDate
  const elapsed = Date.now() - issueDate
  return Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)))
}

function fmtCertDate(d) {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

function renderCertificates() {
  const container = document.getElementById('credentials-content')
  if (!container) return

  const sp = CERTS.studentPilot
  const med = CERTS.medical

  const spDays  = certDaysLeft(sp.expiryDate)
  const medDays = certDaysLeft(med.expiryDate)
  const spCls   = certValidityClass(spDays)
  const medCls  = certValidityClass(medDays)

  function mrow(k, v) {
    return `<div class="cdoc-mrow"><span class="cdoc-mk">${k}</span><span class="cdoc-mv">${v}</span></div>`
  }

  function phys(k, v) {
    return `<div class="cdoc-phys-item"><span class="cdoc-phys-k">${k}</span><span class="cdoc-phys-v">${v}</span></div>`
  }

  container.innerHTML = `
    <div style="margin-bottom:28px;padding-bottom:18px;border-bottom:1px solid var(--rule)">
      <div class="view-subhdr" style="margin-bottom:3px">Pilot Credentials</div>
      <div style="font-size:11px;color:var(--faint)">U.S. Department of Transportation &middot; Federal Aviation Administration</div>
    </div>

    <div class="cdoc-list">

      <!-- Student Pilot Certificate -->
      <div class="cdoc">
        <div class="cdoc-head">
          <div class="cdoc-head-l">
            <span class="cdoc-type pilot">Student Pilot Certificate</span>
            <span class="cdoc-authority">U.S. Dept. of Transportation &middot; Federal Aviation Administration</span>
          </div>
          <span class="cdoc-docnum">№&thinsp;${esc(sp.certNumber)}</span>
        </div>
        <div class="cdoc-body">
          <div>
            <div class="cdoc-name">${esc(sp.name)}</div>
            <div class="cdoc-meta">
              ${mrow('Date of Birth', 'September 25, 2000')}
              ${mrow('Nationality', esc(sp.nationality))}
              ${mrow('Sex', esc(sp.sex))}
            </div>
            <div class="cdoc-phys">
              ${phys('Height', esc(sp.height))}
              ${phys('Weight', esc(sp.weight))}
              ${phys('Hair', esc(sp.hair))}
              ${phys('Eyes', esc(sp.eyes))}
            </div>
          </div>
          <div class="cdoc-right">
            <div class="cdoc-countdown ${spCls}">${spDays.toLocaleString()}</div>
            <div class="cdoc-countdown-sub">days remaining</div>
            <div class="cdoc-dates">
              <div class="cdoc-date">
                <span class="cdoc-dk">Valid through</span>
                <span class="cdoc-dv">${fmtCertDate(sp.expiryDate)}</span>
              </div>
              <div class="cdoc-date">
                <span class="cdoc-dk">Issued</span>
                <span class="cdoc-dv">${fmtCertDate(sp.issueDate)}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="cdoc-foot">
          <span class="cdoc-foot-lim">* ${esc(sp.limitations[0])}</span>
          <span class="cdoc-foot-sig">Signed: ${esc(sp.administrator)}, Administrator</span>
        </div>
      </div>

      <!-- Third Class Medical Certificate -->
      <div class="cdoc">
        <div class="cdoc-head">
          <div class="cdoc-head-l">
            <span class="cdoc-type medical">Airman Medical Certificate &middot; Third Class</span>
            <span class="cdoc-authority">U.S. Dept. of Transportation &middot; Federal Aviation Administration &middot; ${esc(med.formNo)}</span>
          </div>
          <span class="cdoc-docnum">ID&thinsp;${esc(med.applicantId)}</span>
        </div>
        <div class="cdoc-body">
          <div>
            <div class="cdoc-name">${esc(med.name)}</div>
            <div class="cdoc-meta">
              ${mrow('Date of Birth', esc(med.dob))}
              ${mrow('Sex', esc(med.sex))}
            </div>
            <div class="cdoc-phys">
              ${phys('Height', esc(med.height))}
              ${phys('Weight', esc(med.weight))}
              ${phys('Hair', esc(med.hair))}
              ${phys('Eyes', esc(med.eyes))}
            </div>
            <div class="cdoc-ame">
              <span class="cdoc-ame-name">${esc(med.examiner)}</span>
              <span class="cdoc-ame-role">Aviation Medical Examiner</span>
              <span class="cdoc-ame-ids">Designee ${esc(med.examDesig)} &middot; Control ${esc(med.controlNo)}</span>
            </div>
          </div>
          <div class="cdoc-right">
            <div class="cdoc-countdown ${medCls}">${medDays.toLocaleString()}</div>
            <div class="cdoc-countdown-sub">days remaining</div>
            <div class="cdoc-dates">
              <div class="cdoc-date">
                <span class="cdoc-dk">Valid through</span>
                <span class="cdoc-dv">${fmtCertDate(med.expiryDate)}</span>
              </div>
              <div class="cdoc-date">
                <span class="cdoc-dk">Examined</span>
                <span class="cdoc-dv">${fmtCertDate(med.examDate)}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="cdoc-foot">
          <span class="cdoc-foot-lim">* No limitations — standard privileges apply</span>
          <span class="cdoc-foot-sig">${esc(med.formNo)} &middot; Control ${esc(med.controlNo)}</span>
        </div>
      </div>

    </div>

    <!-- Regulatory Notes -->
    <div class="section-label" style="margin-bottom:12px">Regulatory Notes</div>
    <div class="cdoc-regs" style="margin-bottom:32px">
      <div class="cdoc-reg">
        <div class="cdoc-reg-head">
          <span class="cdoc-reg-title">Student Pilot</span>
          <span class="cdoc-reg-cfr">14 CFR 61.19</span>
        </div>
        <ul>
          <li>Valid 60 calendar months from month of issue (under age 40)</li>
          <li>Solo flight requires current medical + instructor endorsement</li>
          <li>Cannot carry passengers &mdash; solo only</li>
          <li>Solo XC requires separate endorsements per 14 CFR 61.93</li>
          <li>Night solo requires 14 CFR 61.87(o) endorsement</li>
        </ul>
      </div>
      <div class="cdoc-reg">
        <div class="cdoc-reg-head">
          <span class="cdoc-reg-title">Third Class Medical</span>
          <span class="cdoc-reg-cfr">14 CFR 61.23</span>
        </div>
        <ul>
          <li>Valid 60 calendar months from examination date (under age 40)</li>
          <li>Required for student, recreational &amp; private pilot operations</li>
          <li>Must be current before any solo flight</li>
          <li>BasicMed (14 CFR 61.113(i)) available as alternative after PPL</li>
          <li>Next exam due: <strong>${fmtCertDate(med.expiryDate)}</strong></li>
        </ul>
      </div>
    </div>
  `
}
