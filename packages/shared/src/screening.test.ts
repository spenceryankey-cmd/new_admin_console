import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCREENING_CONFIG,
  STARTER_CHECKLIST,
  applyReferenceCall,
  evidenceFacts,
  evidenceVerdict,
  guarantorCountdown,
  referenceWarnings,
  skillVerificationNudgeDue,
  waitingFor,
} from './index'

const NOW = new Date('2026-10-20T12:00:00Z')
const ago = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

describe('evidenceVerdict', () => {
  const allTicked = Object.fromEntries(STARTER_CHECKLIST.items.map((i) => [i.id, true]))
  it('passes only when every checklist item is ticked and no automatic fail applies', () => {
    expect(evidenceVerdict({ checklist: STARTER_CHECKLIST, ticked: allTicked, autoFailHits: [] }).allowedOutcome).toBe('pass')
  })
  it('fails when an item is missing, with no partial score', () => {
    const r = evidenceVerdict({ checklist: STARTER_CHECKLIST, ticked: { ...allTicked, quality: false }, autoFailHits: [] })
    expect(r.allowedOutcome).toBe('fail')
    expect(r.reasons[0]).toMatch(/not ticked/)
  })
  it('an automatic fail condition forces a fail even if everything else is ticked', () => {
    const r = evidenceVerdict({ checklist: STARTER_CHECKLIST, ticked: allTicked, autoFailHits: ['not_theirs'] })
    expect(r.allowedOutcome).toBe('fail')
  })
  it('ignores automatic fail ids that are not on the checklist', () => {
    expect(evidenceVerdict({ checklist: STARTER_CHECKLIST, ticked: allTicked, autoFailHits: ['made_up'] }).allowedOutcome).toBe('pass')
  })
  it('cannot pass when there is no checklist for the task type', () => {
    expect(evidenceVerdict({ checklist: undefined, ticked: {}, autoFailHits: [] }).allowedOutcome).toBe('fail')
  })
  it('counts evidence by outcome', () => {
    expect(evidenceFacts([{ review_outcome: 'pass' }, { review_outcome: 'fail' }, { review_outcome: 'pending' }, { review_outcome: 'pass' }])).toEqual({ passed: 2, failed: 1, pending: 1 })
  })
})

describe('referenceWarnings', () => {
  const guarantor = { name: 'Ama Mensah', contact: '0244 123 456' }
  it('warns about family relationships', () => {
    for (const rel of ['My uncle', 'brother in law', 'Mother', 'cousin', 'step father']) {
      expect(referenceWarnings({ name: 'Kofi', contact: '0200000000', relationship: rel }, guarantor).length).toBeGreaterThan(0)
    }
  })
  it('does not warn about an ordinary reference', () => {
    expect(referenceWarnings({ name: 'Kofi Boateng', contact: '0200000000', relationship: 'Former site supervisor' }, guarantor)).toEqual([])
  })
  it('warns when the phone matches the guarantor in any format', () => {
    expect(referenceWarnings({ name: 'Someone', contact: '+233 244 123 456', relationship: 'Supervisor' }, guarantor)).toHaveLength(1)
  })
  it('warns when the name matches the guarantor', () => {
    expect(referenceWarnings({ name: ' ama  mensah ', contact: '0200000000', relationship: 'Supervisor' }, guarantor)).toHaveLength(1)
  })
})

describe('applyReferenceCall', () => {
  it('marks unreachable only after the configured number of failed attempts', () => {
    let s = { attempts: 0, outcome: 'pending' as const } as { attempts: number; outcome: 'pending' | 'unreachable' | 'confirmed' | 'inconclusive' }
    s = applyReferenceCall(s, 'not_reached')
    s = applyReferenceCall(s, 'not_reached')
    expect(s).toEqual({ attempts: 2, outcome: 'pending' })
    s = applyReferenceCall(s, 'not_reached')
    expect(s).toEqual({ attempts: 3, outcome: 'unreachable' })
  })
  it('follows a lower threshold when configured', () => {
    const cfg = { ...DEFAULT_SCREENING_CONFIG, referenceUnreachableAttempts: 2 }
    expect(applyReferenceCall({ attempts: 1, outcome: 'pending' }, 'not_reached', cfg).outcome).toBe('unreachable')
  })
  it('records confirmed and inconclusive calls', () => {
    expect(applyReferenceCall({ attempts: 0, outcome: 'pending' }, 'confirmed').outcome).toBe('confirmed')
    expect(applyReferenceCall({ attempts: 1, outcome: 'pending' }, 'inconclusive').outcome).toBe('inconclusive')
  })
})

describe('guarantorCountdown', () => {
  it('counts down two weeks from the day the guarantor was named', () => {
    expect(guarantorCountdown({ namedAt: ago(4) }, NOW)).toMatchObject({ daysLeft: 10, overdue: false, label: '10 days left' })
    expect(guarantorCountdown({ namedAt: ago(13) }, NOW)).toMatchObject({ daysLeft: 1, label: '1 day left' })
  })
  it('shows overdue at and after fourteen days', () => {
    expect(guarantorCountdown({ namedAt: ago(14) }, NOW)).toMatchObject({ overdue: true, label: 'Overdue' })
    expect(guarantorCountdown({ namedAt: ago(20) }, NOW)?.overdue).toBe(true)
  })
  it('is empty when no guarantor has been named', () => {
    expect(guarantorCountdown(null, NOW)).toBeNull()
  })
})

describe('waiting and nudges', () => {
  it('describes waiting time in plain words', () => {
    expect(waitingFor(ago(0.01), NOW)).toBe('less than an hour')
    expect(waitingFor(ago(0.25), NOW)).toBe('6 hours')
    expect(waitingFor(ago(3), NOW)).toBe('3 days')
  })
  it('nudges after two weeks in skill verification without changing status', () => {
    expect(skillVerificationNudgeDue(ago(13), NOW)).toBe(false)
    expect(skillVerificationNudgeDue(ago(15), NOW)).toBe(true)
  })
})
