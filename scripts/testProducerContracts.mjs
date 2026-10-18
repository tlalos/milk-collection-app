import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/contracts', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    let contracts = [{ contractId: 1, version: '0x0000000000000001', producerCode: 'p001', milkType: 'MILK-COW', contractNumber: '001/26', contractStartDate: '2026-08-01', contractEndDate: '2027-07-31', contractedKg: 15000 }]
    const producers = [{ producerCode: 'p001', producerName: 'Example Producer One' }, { producerCode: 'p002', producerName: 'Example Producer Two' }]
    let failSave = false, canEdit = true, saves = 0
    const errors = [], unexpected = []
    await context.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url())
      if (!pathname.startsWith('/api/')) return route.continue()
      if (pathname === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test', permissions: ['exports'], isAdmin: false } } })
      if (pathname === '/api/activity/page-open') return route.fulfill({ json: {} })
      if (pathname === '/api/ocr/reference-suppliers') return route.fulfill({ json: { producers, centers: [], fetchedAt: '2026-10-16' } })
      if (pathname === '/api/ocr/exports/apia-rows') return route.fulfill({ json: { rows: [{ month: '2026-09', milkType: 'MILK-COW', monthlyRows: [{ id: 'row1', producerCode: 'p001', producer: producers[0].producerName, liters: 500 }] }] } })
      if (pathname === '/api/ocr/exports/reception-factors') return route.fulfill({ json: { factors: [{ code: 'MILK-COW', densityFactor: 1.03 }] } })
      if (pathname === '/api/ocr/exports/producer-contracts') {
        if (route.request().method() === 'GET') return route.fulfill({ json: { contracts, canEdit } })
        if (failSave) return route.fulfill({ status: 409, json: { error: 'Contract changed. Refresh before saving.' } })
        const input = route.request().postDataJSON()
        if (input.contractId) assert.equal(input.expectedVersion, contracts.find(row => row.contractId === input.contractId).version)
        else assert.equal(input.expectedVersion, null)
        saves++
        const saved = { ...input, contractId: input.contractId || 2, version: `0x${String(saves + 1).padStart(16, '0')}` }
        contracts = [...contracts.filter(row => row.contractId !== saved.contractId), saved]
        return route.fulfill({ json: { saved } })
      }
      unexpected.push(pathname)
      return route.fulfill({ status: 400, json: { error: 'Unexpected request' } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/ocr/exports/apia?month=2026-09')
    await page.getByRole('button', { name: 'Contracts', exact: true }).click()
    await page.waitForURL('**/apia/contracts?month=2026-09')
    await page.getByRole('button', { name: 'Edit contract: Example Producer One', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Numar contract', { exact: true }).fill('002/26')
    await dialog.getByLabel('Data incheierii contractului', { exact: true }).fill('2026-07-01')
    await dialog.getByLabel('Data incetarii contractului', { exact: true }).fill('2027-08-31')
    await dialog.getByLabel('Cantitate de lapte contractata (total - kg)', { exact: true }).fill('17000,5')
    await page.screenshot({ path: `work/contracts/dialog-${width}.png`, fullPage: true })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(contracts[0].contractedKg, 17000.5)
    await page.reload()
    await page.getByText('002/26', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: /^Status/ }).selectOption('missing')
    await page.getByRole('button', { name: 'Edit contract: Example Producer Two', exact: true }).click()
    await dialog.getByLabel('Numar contract', { exact: true }).fill('003/26')
    await dialog.getByLabel('Data incheierii contractului', { exact: true }).fill('2026-09-01')
    await dialog.getByLabel('Data incetarii contractului', { exact: true }).fill('2027-08-31')
    await dialog.getByLabel('Cantitate de lapte contractata (total - kg)', { exact: true }).fill('20000')
    failSave = true
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.getByLabel('Numar contract', { exact: true }).inputValue(), '003/26')
    failSave = false
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(saves, 2)
    await page.getByRole('combobox', { name: /^Status/ }).selectOption('all')
    await page.screenshot({ path: `work/contracts/table-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.waitForURL('**/apia?month=2026-09')
    await page.getByText('002/26', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Contracts', exact: true }).click()
    canEdit = false
    await page.reload()
    await page.getByText('Saving is disabled in this read-only copy.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Add contract', exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Edit contract: Example Producer One', exact: true }).isDisabled(), true)
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
    console.log(`PASS contracts ${width}: entry button, four fields, edit, add missing, failed save, reload, APIA data, read-only, layout`)
    await context.close()
  }
} finally { await browser.close() }
