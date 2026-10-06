import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const built = await build({ entryPoints: ['src/monthClosurePagination.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { pageBounds, selectPage } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

test('pagination covers every filtered row once and clamps after filtering', () => {
  const rows = Array.from({ length: 321 }, (_, i) => i)
  const visited = []
  for (let page = 1; page <= 13; page++) {
    const bounds = pageBounds(rows.length, page, 25)
    visited.push(...rows.slice(bounds.start, bounds.end))
  }
  assert.deepEqual(visited, rows)
  assert.deepEqual(pageBounds(321, 13, 25), { page: 13, pages: 13, start: 300, end: 321 })
  assert.deepEqual(pageBounds(3, 13, 25), { page: 1, pages: 1, start: 0, end: 3 })
  assert.deepEqual(pageBounds(0, 13, 25), { page: 1, pages: 1, start: 0, end: 0 })
  assert.deepEqual(pageBounds(100, 2, 50), { page: 2, pages: 2, start: 50, end: 100 })
})

test('selecting and clearing a page preserves other-page selections without duplicates', () => {
  assert.deepEqual(selectPage(['a', 'b'], ['b', 'c'], true), ['a', 'b', 'c'])
  assert.deepEqual(selectPage(['a', 'b', 'c'], ['b', 'c'], false), ['a'])
  assert.deepEqual(selectPage(['a'], [], false), ['a'])
})
