import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
await mkdir('work/delivery-arrival', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' })
    let record = {
      id: 'arrival-test', deliveryDate: '2020-01-01', truckNumber: 'TEST', tractorNumber: '', aviz: 'TEST-1',
      milkType: 'MILK-COW', milkTypeLabel: 'Cow', densityFactor: 1.03, loadedWeightKg: 20000,
      emptyWeightKg: 10000, netQuantityKg: 10000, calculatedLiters: 9708.738,
      deliveryCategory: 'SALES', status: 'AWAITING_GREECE', greeceWeight: null, invoiceNumber: '', arrivalComments: '',
    }
    const patches = []
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      const method = route.request().method()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'staff-test', isAdmin: false, permissions: ['milk_reception'] } } })
      if (path === '/api/milk-deliveries' && method === 'GET') return route.fulfill({ json: { records: [record] } })
      if (method === 'PATCH') {
        assert.equal(path, '/api/milk-deliveries/arrival-test/arrival')
        const patch = route.request().postDataJSON()
        assert.deepEqual(Object.keys(patch).sort(), ['arrivalComments', 'greeceWeight', 'invoiceNumber', 'status'])
        patches.push(patch)
        record = { ...record, ...patch, differenceAmount: Number(patch.greeceWeight) - record.netQuantityKg }
        return route.fulfill({ json: { record } })
      }
      return route.fulfill({ json: {} })
    })
    const page = await context.newPage()
    await page.goto(`${process.env.APP_TEST_URL || 'http://127.0.0.1:5173'}/milk-deliveries`)
    await page.getByRole('button', { name: 'Show all dates', exact: true }).click()
    const row = page.locator('.delivery-register-row')
    await row.waitFor()
    assert.ok(await row.getByLabel('Delivery date', { exact: true }).isDisabled())
    assert.ok(await row.getByPlaceholder('Truck', { exact: true }).isDisabled())
    assert.ok(await page.getByRole('button', { name: 'Delete delivery row' }).isDisabled())
    assert.ok(await page.getByRole('button', { name: 'Read scale into Loaded kg' }).isDisabled())
    await page.getByRole('button', { name: 'Expand delivery' }).click()
    const arrival = page.locator('.arrival-stage')
    await arrival.getByLabel('Weight from Greece *', { exact: true }).fill('9980')
    await arrival.getByPlaceholder('Invoice number', { exact: true }).fill('INV-1')
    await arrival.getByRole('textbox', { name: 'Comments / destination' }).fill('Arrived')
    await page.waitForFunction(() => document.querySelector('.delivery-save-state')?.textContent === 'Saved')
    assert.equal(record.arrivalComments, 'Arrived')
    assert.equal(record.status, 'AWAITING_GREECE')
    assert.equal(await arrival.locator('output').innerText(), '-20')
    await page.getByRole('button', { name: 'Mark complete', exact: true }).click()
    await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor()
    assert.equal(record.status, 'COMPLETE')
    await arrival.getByRole('textbox', { name: 'Comments / destination' }).fill('Arrival corrected')
    await page.waitForFunction(() => document.querySelector('.delivery-save-state')?.textContent === 'Saved')
    assert.equal(record.arrivalComments, 'Arrival corrected')
    assert.ok(patches.length >= 2)
    await page.screenshot({ path: `work/delivery-arrival/arrival-${width}.png`, fullPage: true })
    record = { ...record, status: 'DRAFT' }
    await page.reload()
    await page.getByRole('button', { name: 'Show all dates', exact: true }).click()
    await page.getByRole('button', { name: 'Expand delivery' }).click()
    assert.ok(await page.getByLabel('Weight from Greece *', { exact: true }).isDisabled())
    assert.ok(await page.getByRole('button', { name: 'Save delivery row' }).isDisabled())
    console.log(`PASS ${width}: non-admin arrival autosave, completion, corrections; past departures and drafts stay locked`)
    await context.close()
  }
} finally {
  await browser.close()
}
