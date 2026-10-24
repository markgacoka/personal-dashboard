import { describe, expect, it } from 'vitest'
import { metarCategory } from './weather'

describe('metarCategory', () => {
  it('reads the ceiling and visibility the way the FAA categories do', () => {
    expect(metarCategory('KRHV 262347Z 32009KT 10SM SKC 32/04 A2992')).toBe('VFR')
    expect(metarCategory('KRHV 270147Z 31008KT 10SM FEW040 29/08 A2991')).toBe('VFR')
    expect(metarCategory('KSJC 121553Z 00000KT 10SM BKN025 14/10 A3001')).toBe('MVFR')
    expect(metarCategory('KMRY 121554Z 00000KT 2 1/2SM BR OVC008 13/12 A3002')).toBe('IFR')
    expect(metarCategory('KMRY 121454Z 00000KT 1/4SM FG VV002 12/12 A3002')).toBe('LIFR')
    expect(metarCategory('KSFO 121556Z AUTO 28012KT M1/4SM FG OVC001 12/12 A3001')).toBe('LIFR')
  })
  it('says nothing when the report has neither', () => {
    expect(metarCategory('KXYZ 121556Z AUTO 28012KT 12/12 A3001')).toBeNull()
  })
})
