import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
await mkdir('work/daily-reconciliation', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const errors = []
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test', permissions: ['daily_reconciliation'], isAdmin: false } } })
      if (url.pathname === '/api/activity/page-open') return route.fulfill({ json: {} })
      if (url.pathname === '/api/daily-reconciliation/month') {
        const date = `${url.searchParams.get('month')}-09`
        return route.fulfill({ json: {
          receptions: [
            { receptionId: 'collection', receptionDate: date, vehicleRegistration: 'CJ 10 COL', routeId: 'R1', vehicleCategory: 'COLLECTION', netQuantityKg: 1030, calculatedLiters: 1000, fullTruckWeightKg: 3030, emptyTruckWeightKg: 2000 },
            { receptionId: 'other', receptionDate: date, vehicleRegistration: 'CJ 20 OTH', routeId: '', vehicleCategory: 'OTHER', netQuantityKg: 2060, calculatedLiters: 2000, fullTruckWeightKg: 4060, emptyTruckWeightKg: 2000 },
          ],
          documents: [{ id: 'aviz', documentDate: date, createdAt: date, vehicleRegistration: 'CJ 10 COL', route: 'R1', jobStatus: 'completed', reviewStatus: 'reviewed', rows: [{ rowIndex: 0, liters: 1010 }] }], links: [],
        } })
      }
      errors.push(`Unexpected request: ${url.pathname}`)
      return route.fulfill({ status: 400, json: {} })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto((process.env.APP_TEST_URL || 'http://127.0.0.1:5173') + '/daily-reconciliation')
    const header = page.locator('.daily-recon-day-header')
    await header.waitFor()
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click()
    assert.equal(await header.getAttribute('aria-expanded'), 'false')
    assert.equal(await page.locator('.daily-recon-day-grid').isVisible(), false)
    const totals = header.locator('.daily-recon-day-totals')
    assert.match(await totals.innerText(), /Collection kilos: 1,030 kg/)
    assert.match(await totals.innerText(), /Collection diff: -10 L/)
    assert.match(await totals.innerText(), /Others kilos: 2,060 kg/)
    assert.match(await totals.innerText(), /Others diff: -/)
    await header.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `work/daily-reconciliation/collapsed-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.getByRole('combobox', { name: /^Show/ }).selectOption('others')
    assert.match(await totals.innerText(), /Collection kilos: -/)
    assert.match(await totals.innerText(), /Others kilos: 2,060 kg/)
    await page.getByRole('combobox', { name: /^Show/ }).selectOption('collection')
    assert.match(await totals.innerText(), /Collection kilos: 1,030 kg/)
    assert.match(await totals.innerText(), /Others kilos: -/)
    await page.getByRole('button', { name: 'Expand all', exact: true }).click()
    assert.equal(await page.locator('.daily-recon-day-grid').isVisible(), true)
    assert.deepEqual(errors, [])
    console.log(`PASS daily headers ${width}: four summaries, units, filters, collapse/expand, layout`)
    await context.close()
  }
} finally { await browser.close() }
