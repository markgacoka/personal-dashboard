// The papers behind a flight: what you carry as pilot (§61.3, §61.51) and what
// the airplane carries or keeps (§91.203, §91.417, ARROW). Uploaded once,
// pilot records without a tail, aircraft records per tail.

export type PilotRecordKind = 'student-cert' | 'pilot-cert' | 'medical' | 'id' | 'endorsement' | 'logbook'
export type AircraftRecordKind = 'airworthiness' | 'registration' | 'radio-license' | 'wb' | 'equipment-list' | 'airframe-log' | 'engine-log'
export type RecordKind = PilotRecordKind | AircraftRecordKind

export interface RecordDef<K extends RecordKind = RecordKind> {
  kind: K; label: string; rule: string; why: string
  many?: boolean // several files (endorsements, logbook pages)
  when?: 'student' | 'certificated' // only shown for that certificate (both when certificates aren't saved)
}

export const PILOT_RECORDS: RecordDef<PilotRecordKind>[] = [
  { kind: 'student-cert', label: 'Student pilot certificate', rule: '§61.3(a)', why: 'In your possession when you act as pilot in command.', when: 'student' },
  { kind: 'pilot-cert', label: 'Private pilot certificate', rule: '§61.3(a)', why: 'In your possession when you act as a required pilot.', when: 'certificated' },
  { kind: 'medical', label: 'Medical certificate', rule: '§61.3(c)', why: 'Or your BasicMed documents; carried with the pilot certificate.' },
  { kind: 'id', label: 'Government-issued photo ID', rule: '§61.3(a)(2)', why: 'Driver\'s license, passport or military ID, carried with the certificate.' },
  { kind: 'endorsement', label: 'Endorsements and additional ratings', rule: '§61.87, §61.93, §61.31', why: 'Solo, cross-country, Class B, complex, high performance, tailwheel; students carry the solo ones.', many: true },
  { kind: 'logbook', label: 'Personal flight logbook', rule: '§61.51(i)', why: 'A student on a solo cross-country carries the logbook with its endorsements.', many: true },
]

export const AIRCRAFT_RECORDS: RecordDef<AircraftRecordKind>[] = [
  { kind: 'airworthiness', label: 'Airworthiness certificate', rule: '§91.203(a)(1)', why: 'Displayed in the cabin, legible to passengers and crew (the A in ARROW).' },
  { kind: 'registration', label: 'Registration certificate', rule: '§91.203(a)(2)', why: 'On board; renewed every 7 years (the first R in ARROW).' },
  { kind: 'radio-license', label: 'Radio station license', rule: 'FCC, 47 CFR 87', why: 'Needed only for flights outside the US (the second R in ARROW).' },
  { kind: 'wb', label: 'Weight and balance', rule: '§91.9', why: 'This airplane\'s current empty weight and moment (the W in ARROW).' },
  { kind: 'equipment-list', label: 'Equipment list', rule: '§91.213, §91.205', why: 'What is installed, and what can be inoperative under §91.213(d).' },
  { kind: 'airframe-log', label: 'Airframe logbook', rule: '§91.417', why: 'Annual, 100-hour, ADs, transponder, pitot-static and ELT entries.', many: true },
  { kind: 'engine-log', label: 'Engine logbook', rule: '§91.417', why: 'Engine time since overhaul, inspections and ADs.', many: true },
]

export const RECORD_LABEL: Record<RecordKind, string> = Object.fromEntries([...PILOT_RECORDS, ...AIRCRAFT_RECORDS].map(r => [r.kind, r.label])) as Record<RecordKind, string>
export const isAircraftRecord = (k: string): k is AircraftRecordKind => AIRCRAFT_RECORDS.some(r => r.kind === k)
