import { describe, expect, it } from 'vitest'
import { findOrphans } from './integrity.service'

describe('findOrphans', () => {
  it('reports ids that no Xpert owns and leaves good ids alone', () => {
    const refs = new Map([
      ['assignment', ['a', 'b', 'a']],
      ['flag', ['b', 'ghost']],
    ])
    const r = findOrphans(refs, new Set(['a', 'b']))
    expect(r.orphans).toEqual([{ table: 'flag', xpertId: 'ghost' }])
    expect(r.checked).toBe(4) // a and b once each under assignment, b and ghost under flag
  })
  it('catches a mistyped id the same way', () => {
    const r = findOrphans(new Map([['price_band', ['3f2b8c1e-5a77-4c0e-9a41-0d3b6f1e2a1O']]]), new Set(['3f2b8c1e-5a77-4c0e-9a41-0d3b6f1e2a10']))
    expect(r.orphans).toHaveLength(1)
  })
  it('reports nothing when there are no references', () => {
    expect(findOrphans(new Map(), new Set())).toEqual({ checked: 0, orphans: [] })
  })
})
