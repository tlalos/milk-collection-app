import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { defaultMilkDensitySettings } from '../server/milkDensitySettingsStore.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/manual-weights', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    let user = { username: 'admin-test', isAdmin: true }
    const records = {
      receptions: { receptionId: 'r1', receptionDate: '2026-10-31', vehicleRegistration: 'TEST', vehicleCategory: 'OTHER', routeId: '', driverName: 'Test', milkType: 'MILK-COW', densityFactor: 1.03, fullTruckWeightKg: 20000, emptyTruckWeightKg: 10000, fullTruckWeightSource: 'SCALE', emptyTruckWeightSource: 'SCALE', fullTruckWeighedAt: '2026-10-31T10:00:00', emptyTruckWeighedAt: '2026-10-31T10:05:00', qualityDetails: {}, comments: '' },
      deliveries: { id: 'd1', deliveryId: 'd1', deliveryDate: '2026-10-31', truckNumber: 'TEST', tractorNumber: '', aviz: '1', milkType: 'MILK-COW', densityFactor: 1.03, loadedWeightKg: 20000, emptyWeightKg: 10000, loadedWeightSource: 'SCALE', emptyWeightSource: 'SCALE', loadedWeighedAt: '2026-10-31T10:00:00', emptyWeighedAt: '2026-10-31T10:05:00', deliveryCategory: 'SALES', status: 'AWAITING_GREECE', greeceWeight: null, invoiceNumber: '', arrivalComments: '' },
    }
    const writes = [], errors = []
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (url.origin !== base) return route.abort()
      if (!path.startsWith('/api/')) return route.continue()
      const json = body => route.fulfill({ json: body })
      if (path === '/api/auth/session') return json({ user })
      if (path === '/api/activity/page-open') return json({})
      if (path === '/api/milk-factors') return json({ settings: defaultMilkDensitySettings, canEdit: false })
      for (const kind of ['receptions', 'deliveries']) {
        if (path === `/api/milk-${kind}` && request.method() === 'GET') return json({ records: [records[kind]] })
        if (path === `/api/milk-${kind}/${kind === 'receptions' ? 'r1' : 'd1'}` && request.method() === 'PATCH') {
          assert.equal(user.isAdmin, true)
          const body = request.postDataJSON()
          writes.push({ kind, body })
          records[kind] = { ...records[kind], ...body }
          return json({ record: records[kind] })
        }
      }
      assert.equal(request.method(), 'GET', `Unexpected write ${path}`)
      return json({ records: [], messages: [], drivers: [], vehicles: [], routes: [] })
    })
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'))
    for (const [kind, route, label, prefix] of [
      ['receptions', '/milk-reception', 'Full kg', 'fullTruck'],
      ['deliveries', '/milk-deliveries', 'Loaded kg', 'loaded'],
    ]) {
      await page.goto(base + route)
      const full = page.getByLabel(label, { exact: true })
      const empty = page.getByLabel('Empty kg', { exact: true })
      await full.fill('21000')
      await empty.fill('10500')
      await page.waitForFunction(() => [...document.querySelectorAll('.reception-save-state, .delivery-save-state')].some(el => el.textContent === 'Saved'))
      const saved = writes.filter(write => write.kind === kind).at(-1)?.body
      assert.equal(Number(saved[`${prefix}WeightKg`]), 21000)
      assert.equal(saved[`${prefix}WeightSource`], 'MANUAL')
      assert.equal(saved[`${prefix}WeighedAt`], '')
      assert.equal(saved[`${prefix}ScaleCaptureId`], '')
      const emptyPrefix = kind === 'receptions' ? 'emptyTruck' : 'empty'
      assert.equal(saved[`${emptyPrefix}WeightSource`], 'MANUAL')
      assert.equal(saved[`${emptyPrefix}WeighedAt`], '')
      assert.equal(saved.netQuantityKg, 10500)
      await full.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `work/manual-weights/${kind}-${width}.png` })
      user = { username: 'staff', isAdmin: false, permissions: ['milk_reception'], writePermissions: ['milk_reception'] }
      await page.reload()
      await full.waitFor()
      assert.equal(await full.getAttribute('readonly'), '')
      assert.equal(await empty.getAttribute('readonly'), '')
      assert.equal(await page.getByRole('button', { name: `Read scale into ${label}`, exact: true }).isEnabled(), true)
      user = { ...user, writePermissions: [] }
      await page.reload()
      await full.waitFor()
      assert.equal(await full.isDisabled(), true)
      assert.equal(await page.getByRole('button', { name: `Read scale into ${label}`, exact: true }).isDisabled(), true)
      user = { username: 'admin-test', isAdmin: true }
    }
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}: admin manual weight autosave, Manual provenance, net calculation, staff scale-only, viewer locked`)
    await context.close()
  }
} finally { await browser.close() }
