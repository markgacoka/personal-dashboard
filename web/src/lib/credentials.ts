// The pilot's FAA documents, as printed on the certificates (moved unchanged
// from the classic UI's credentials view).
export const STUDENT_PILOT = {
  title: 'Student Pilot Certificate',
  name: 'GACOKA MBUI',
  number: '5197811',
  dob: 'September 25, 2000',
  nationality: 'Kenya',
  sex: 'Male',
  height: '5′7″ (67 in)',
  weight: '168 lb',
  hair: 'Black',
  eyes: 'Brown',
  issued: '2025-07-31',
  // Under 40: valid 60 calendar months from the month of issue (14 CFR 61.19).
  expires: '2030-07-31',
  limitation: 'Carrying passengers is prohibited',
  signedBy: 'Bryan Bedford, Administrator',
}

export const MEDICAL = {
  title: 'Airman Medical Certificate',
  cls: 'Third Class',
  name: 'GACOKA MBUI',
  applicantId: '2002643954',
  dob: 'September 25, 2000',
  sex: 'Male',
  height: '5′7″ (67 in)',
  weight: '149 lb',
  hair: 'Black',
  eyes: 'Brown',
  examined: '2025-08-22',
  // Under 40: valid 60 calendar months from the month of examination (14 CFR 61.23).
  expires: '2030-08-31',
  limitation: 'None — standard privileges apply',
  examiner: 'Tiffany Davies, MD',
  designee: '000003574',
  control: '200011744502',
  form: 'FAA Form 8500-9',
}

export const REG_NOTES = [
  { title: 'Student pilot', cfr: '14 CFR 61.19', items: [
    'Valid 60 calendar months from the month of issue (under age 40)',
    'Solo flight requires a current medical and an instructor endorsement',
    'No passengers — solo only',
    'Solo cross-country needs separate endorsements under 14 CFR 61.93',
    'Night solo needs a 14 CFR 61.87(o) endorsement',
  ] },
  { title: 'Third-class medical', cfr: '14 CFR 61.23', items: [
    'Valid 60 calendar months from the examination (under age 40)',
    'Required for student, recreational and private pilot operations',
    'Must be current before any solo flight',
    'BasicMed (14 CFR 61.113(i)) is an alternative after the private certificate',
  ] },
]
