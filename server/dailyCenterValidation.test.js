import test from 'node:test'
import assert from 'node:assert/strict'
import { correctedCenterMatch, validateDailyCenterMatches } from './dailyCenterValidation.js'

const centers = [{ code: 'c51', name: 'SITA' }, { code: 'c52', name: 'OSORHEL' }]
const row = { rowNumber: 5, collectionCenter: 'OSORHEL' }
const oldMatch = { selectedCode: 'c51', selectedName: 'SITA', originalName: 'Sita', status: 'confirmed', suggestions: [{ code: 'c51', name: 'SITA' }] }
test('monthly correction resolves the new code from ERP rather than old suggestions', () => {
  const match = correctedCenterMatch(oldMatch, 5, 'SITA', 'OSORHEL', centers)
  assert.equal(match.selectedCode, 'c52')
  assert.equal(match.selectedName, 'OSORHEL')
  assert.equal(match.originalName, 'Sita')
  assert.equal(validateDailyCenterMatches([row], [match], centers), null)
  assert.equal(oldMatch.selectedCode, 'c51')
})
test('unknown, unavailable or ambiguous ERP center clears the previous match', () => {
  for (const refs of [[], null, [...centers, { code: 'c53', name: 'OSORHEL' }]]) {
    const match = correctedCenterMatch(oldMatch, 5, 'SITA', 'OSORHEL', refs)
    assert.equal(match.selectedCode, null)
    assert.equal(match.selectedName, null)
    assert.equal(match.status, 'unmatched')
  }
})
test('rejects stale SITA code with edited OSORHEL name', () => {
  assert.match(validateDailyCenterMatches([row], [{ rowNumber: 5, selectedCode: 'c51', selectedName: 'OSORHEL' }], centers), /Row 5/)
})
test('allows unmatched drafts and consistent explicit selections', () => {
  assert.equal(validateDailyCenterMatches([row], [], centers), null)
  assert.equal(validateDailyCenterMatches([row], [{ rowNumber: 5, selectedCode: null }], centers), null)
  assert.equal(validateDailyCenterMatches([row], [{ rowNumber: 5, selectedCode: 'c52', selectedName: 'OSORHEL' }], centers), null)
})
test('rejects missing references, unknown codes and conflicting selected names', () => {
  for (const [selectedCode, selectedName, refs] of [['c52', 'SITA', centers], ['c99', 'OSORHEL', centers], ['c52', 'OSORHEL', null]]) {
    assert.ok(validateDailyCenterMatches([row], [{ rowNumber: 5, selectedCode, selectedName }], refs))
  }
})
