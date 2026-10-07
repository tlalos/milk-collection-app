import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile } from 'node:fs/promises'

const built = await build({ entryPoints: ['src/pageAccess.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { requiresMilkCollectionAccess } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`)

test('one collection grant covers the full collection area including alternate login/settings paths', () => {
  assert.equal(requiresMilkCollectionAccess('home', 'milkCollection'), true)
  for (const screen of ['login', 'settings', 'customers', 'dataSync', 'journal', 'transport', 'suppliers', 'entry']) {
    assert.equal(requiresMilkCollectionAccess(screen, null), true, screen)
  }
  for (const screen of ['startup', 'main', 'home', 'exports', 'monthClosure', 'milkReception']) {
    assert.equal(requiresMilkCollectionAccess(screen, null), false, screen)
  }
  assert.equal(requiresMilkCollectionAccess('home', 'ocr'), false)
})

test('export menu and report URLs share one guarded screen and navigation entry', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  assert.ok(app.includes("if (['/ocr/exports', '/ocr/exports/apia', '/ocr/exports/veterinary', '/ocr/exports/veterinary/animal-counts'].includes(routePathname())) return 'exports'"))
  const navigation = await readFile(new URL('./components/OcrNavigation.tsx', import.meta.url), 'utf8')
  assert.ok(navigation.includes("permission: 'exports', icon: FileOutput, children: ['/ocr/exports/apia', '/ocr/exports/veterinary', '/ocr/exports/veterinary/animal-counts']"))
})

test('direct page gates match the separate navigation permissions', async () => {
  const app = await readFile(new URL('./App.tsx', import.meta.url), 'utf8')
  for (const [screen, permission] of [
    ['milkReception', 'milk_reception'], ['milkDeliveries', 'milk_reception'],
    ['milkFactors', 'milk_reception'], ['bankNote', 'month_closure'],
    ['ocrArchiveHistory', 'backup_history'], ['webUserHistory', 'audit_log'],
    ['webUsers', 'app_admin'], ['exports', 'exports'],
  ]) {
    const section = app.slice(app.indexOf(`{screen === '${screen}' && (`))
    assert.ok(section.slice(0, section.indexOf('</OcrAuthGate>')).includes(`requiredPermission="${permission}"`), screen)
  }
})
