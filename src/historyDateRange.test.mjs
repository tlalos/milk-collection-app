import assert from 'node:assert/strict'
import test from 'node:test'
import { historyDateRange } from './historyDateRange.ts'

test('optional inclusive local calendar dates become exclusive timestamp bounds', () => {
  assert.deepEqual(historyDateRange('', ''), { from: '', until: '' })
  const result = historyDateRange('2026-10-14', '2026-10-14')
  assert.equal(result.from, new Date(2026, 9, 14).toISOString())
  assert.equal(result.until, new Date(2026, 9, 15).toISOString())
  assert.equal(historyDateRange('', '2026-12-31').until, new Date(2027, 0, 1).toISOString())
  assert.throws(() => historyDateRange('2026-10-15', '2026-10-14'), /From date/)
  assert.throws(() => historyDateRange('invalid', ''), /Invalid/)
})

test('end boundary uses calendar days across daylight-saving changes', () => {
  for (const day of ['2026-03-29', '2026-10-25']) {
    const result = historyDateRange(day, day)
    const expected = new Date(`${day}T00:00:00`)
    expected.setDate(expected.getDate() + 1)
    assert.equal(result.until, expected.toISOString())
  }
})
