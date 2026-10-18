import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/cmr', { recursive: true })
const image = await readFile('test-documents/romanian-monthly-settlement-ocr-test.png')
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    let connected = false, writes = 0, needsReview = false, readonly = false
    const errors = []
    const doc = (id, day, patch = {}) => ({ id, documentDate: `2026-09-${day}`, createdAt: '2026-09-01T12:00:00Z', vehicleRegistration: `TRUCK-${id}`,
      sourceFile: `${id}.jpeg`, supplier: 'Supplier', driver: 'Driver', avizNumber: '001', quantity: 1990, quantityUnit: 'L', jobStatus: 'completed', reviewStatus: 'reviewed', ...patch })
    const rec = (id, day, patch = {}) => ({ receptionId: id, receptionDate: `2026-09-${day}`, vehicleRegistration: `TRUCK-${id}`, vehicleCategory: 'OTHER', routeId: '',
      fullTruckWeightKg: 4060, emptyTruckWeightKg: 2000, netQuantityKg: 2060, calculatedLiters: 2000, milkTypeLabel: 'Cow', updatedAt: '2026-09-23T12:00:00.000Z', ...patch })
    const documents = [doc('match', '23'), doc('alone', '24'), doc('kg', '25', { quantityUnit: 'kg', quantity: 2000 }), doc('waiting', '26')]
    const receptions = [rec('match', '23'), rec('scale', '24'), rec('kg', '25'), rec('waiting', '26', { emptyTruckWeightKg: null, netQuantityKg: null, calculatedLiters: null })]
    const getLinks = () => [{ jobId: 'kg', receptionId: 'kg', status: 'CONFIRMED' }, { jobId: 'waiting', receptionId: 'waiting', status: 'CONFIRMED' },
      ...(connected ? [{ jobId: 'match', receptionId: 'match', status: needsReview ? 'NEEDS_REVIEW' : 'CONFIRMED' }] : [])]
    const matchState = () => ({ documentVersion: '0x0000000000000001', updatedAt: 'v1', candidates: [receptions[0]], linkedReception: connected ? receptions[0] : null,
      link: connected ? { receptionId: 'match', status: needsReview ? 'NEEDS_REVIEW' : 'CONFIRMED', version: '0x0000000000000002' } : null })
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test', permissions: readonly ? ['daily_reconciliation'] : ['daily_reconciliation', 'ocr_documents'], isAdmin: false } } })
      if (url.pathname === '/api/activity/page-open') return route.fulfill({ json: {} })
      if (url.pathname === '/api/daily-reconciliation/month') return route.fulfill({ json: { receptions, documents: [{ id: 'aviz-only', documentDate: '2026-09-24', createdAt: '2026-09-24T12:00:00Z', vehicleRegistration: 'AVIZ-TRUCK', route: 'R1', jobStatus: 'completed', reviewStatus: 'reviewed', rows: [{ rowIndex: 0, liters: 100 }] }], links: [], cmrDocuments: documents, cmrLinks: getLinks() } })
      if (url.pathname === '/api/ocr/cmr') return route.fulfill({ json: { jobs: [{ id: 'match', sourceFile: 'match.jpeg', mimeType: 'image/png', fileUrl: '/api/ocr/jobs/match/file', reviewStatus: 'reviewed', updatedAt: 'v1',
        data: { documentType: 'cmr', supplier: 'Supplier', transport: '', kilos: null, quantity: 1990, quantityUnit: 'L', truckNumber: 'TRUCK-match', driver: 'Driver', date: '2026-09-23', avizNumber: '001' } }] } })
      if (url.pathname === '/api/ocr/cmr/truck-options') return route.fulfill({ json: { trucks: ['TRUCK-match'], drivers: ['Driver'] } })
      if (url.pathname === '/api/ocr/jobs/match/file') return route.fulfill({ body: image, contentType: 'image/png' })
      if (url.pathname === '/api/ocr/cmr/match/reception-match') {
        if (route.request().method() === 'PUT') {
          assert.equal(route.request().postDataJSON().receptionId, 'match')
          connected = true; needsReview = false; writes++
        }
        return route.fulfill({ json: matchState() })
      }
      errors.push(`Unexpected ${route.request().method()} ${url.pathname}`)
      return route.fulfill({ status: 400, json: {} })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/daily-reconciliation')
    await page.getByLabel('Month', { exact: true }).fill('2026-09')
    await page.locator('[data-cmr-status="match_available"]').first().waitFor()
    assert.equal(writes, 0)
    assert.equal(await page.locator('[data-cmr-status="match_available"]').count(), 2)
    assert.equal(await page.locator('[data-cmr-status="only_cmr"]').count(), 1)
    const cmrOnly = page.locator('[data-cmr-status="only_cmr"]')
    assert.match(await cmrOnly.innerText(), /24\/09\/2026/)
    assert.match(await cmrOnly.innerText(), /No scale reception/)
    const avizOnly = page.locator('.daily-recon-presence.aviz-only').filter({ hasText: 'Only aviz' })
    const badgeStyle = locator => locator.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, color: getComputedStyle(element).color }))
    assert.deepEqual(await badgeStyle(cmrOnly.locator('.daily-recon-presence')), await badgeStyle(avizOnly))
    const rowStyle = locator => locator.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderLeftWidth }))
    assert.deepEqual(await rowStyle(cmrOnly), await rowStyle(avizOnly.locator('xpath=ancestor::div[@role="row"]')))
    await cmrOnly.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `work/cmr/only-cmr-style-${width}.png` })
    assert.equal(await page.locator('[data-cmr-status="only_scale"]').count(), 1)
    assert.equal(await page.locator('[data-cmr-status="awaiting_weight"]').count(), 1)
    assert.equal(await page.locator('[data-cmr-status="match_available"] [data-label="Difference"]').allTextContents().then(values => values.every(value => value === '-')), true)
    assert.match(await page.locator('[data-cmr-status="difference"]').innerText(), /60 kg/)
    await page.getByRole('combobox', { name: /^Show/ }).selectOption('match_available')
    assert.equal(await page.locator('.daily-recon-other-row').count(), 2)
    const popupPromise = page.waitForEvent('popup')
    await page.getByRole('link', { name: 'Review match', exact: true }).first().click()
    const cmr = await popupPromise
    cmr.on('pageerror', error => errors.push(error.message))
    await cmr.getByText('Reception detected. Connect this CMR?', { exact: true }).waitFor()
    assert.equal(writes, 0)
    await cmr.getByRole('button', { name: 'Confirm match', exact: true }).click()
    await cmr.getByText('Reception linked', { exact: true }).waitFor()
    assert.equal(writes, 1)
    await page.bringToFront()
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.getByText('No records match this month and filters.', { exact: true }).waitFor()
    await page.getByRole('combobox', { name: /^Show/ }).selectOption('others')
    assert.equal(await page.locator('[data-cmr-status="match_available"]').count(), 0)
    assert.equal(await page.locator('.daily-recon-other-row').count(), 5)
    assert.match(await page.getByLabel('Filtered Other receptions liter totals').innerText(), /60 kg \/ 10 L/)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `work/cmr/reconciliation-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    needsReview = true
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.locator('[data-cmr-status="needs_review"]').first().waitFor()
    assert.equal(await page.locator('[data-cmr-status="needs_review"]').count(), 2)
    assert.equal(await page.locator('[data-cmr-status="needs_review"] [data-label="Difference"]').allTextContents().then(values => values.every(value => value === '-')), true)
    await page.getByRole('combobox', { name: /^Show/ }).selectOption('collection')
    assert.equal(await page.locator('.daily-recon-other-row').count(), 0)
    readonly = true
    await page.reload()
    await page.getByLabel('Month', { exact: true }).fill('2026-09')
    await page.getByText('OCR documents access required to review', { exact: true }).first().waitFor()
    assert.equal(await page.getByRole('link', { name: 'Review match', exact: true }).count(), 0)
    assert.deepEqual(errors, [])
    console.log(`PASS CMR reconciliation ${width}: unpaired records, explicit confirmation, return refresh, units, stale links, filters, permissions`)
    await context.close()
  }
} finally { await browser.close() }
