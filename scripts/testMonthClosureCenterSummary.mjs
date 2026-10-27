import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const rows = Array.from({ length: 30 }, (_, i) => ({ id: `row-${i}`, month: '2026-09', center: 'Test center',
  producer: `Producer ${i}`, producerCode: `p${i}`, milkType: 'MILK-COW', liters: 10, readyForPricing: true, pricingStatus: 'needs_price',
  sourceRowCount: 1, previousMonthLiters: null, previousMonthRowCount: 0, reconciliationStatus: 'ok',
  reconciliationDifferenceLiters: 0, centerAvizLiters: 350, centerMonthlyLiters: 350, centerJournalRows: 31, centerAvizLines: 31,
}))
rows.push({ ...rows[1], id: 'other-milk', milkType: 'MILK-SHEEP', liters: 50, readyForPricing: false, pricingStatus: 'blocked' })
await mkdir('work/month-closure-center-summary', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const errors = [], writes = []
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (route.request().method() !== 'GET' && path !== '/api/activity/page-open') writes.push(path)
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      if (path === '/api/month-closure/pricing-rows') return route.fulfill({ json: { rows, selectedMonth: '2026-09', monthOptions: ['2026-09'],
        journalProducers: rows.slice(0, 29), receptionFactors: [{ code: 'MILK-COW', densityFactor: 1.03 }, { code: 'MILK-SHEEP', densityFactor: 1.036 }],
        summary: { rowCount: 31, centerCount: 1, producerCount: 30, totalLiters: 350, readyLiters: 300, blockedLiters: 50, readyRowCount: 30, blockedRowCount: 1 } } })
      return route.fulfill({ json: { invoices: [], centers: [], producers: [] } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${process.env.APP_TEST_URL || 'http://127.0.0.1:5173'}/month-closure?month=2026-09`)
    await page.getByRole('button', { name: 'Summary', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Center summary', exact: true })
    await dialog.waitFor()
    assert.deepEqual(await dialog.locator('tbody tr').first().locator('td').allTextContents(), ['29', '300', '50', '350', '360.8'])
    assert.equal(await page.locator('.month-closure-pricing-table tbody tr').count(), 25)
    assert.equal(await dialog.evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.getBoundingClientRect().left >= 0), true)
    await page.screenshot({ path: `work/month-closure-center-summary/summary-${width}.png` })
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), false)
    await page.getByPlaceholder('Producer name...').fill('Producer 29')
    await page.getByRole('button', { name: 'Summary', exact: true }).click()
    await dialog.waitFor()
    assert.deepEqual(await dialog.locator('tbody tr').first().locator('td').allTextContents(), ['29', '10', '0', '10', '10.3'])
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByPlaceholder('Producer name...').fill('No matching producer')
    await page.getByRole('button', { name: 'Summary', exact: true }).click()
    await dialog.getByText('No centers match the selected month and filters.').waitFor()
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}: all-page totals, distinct producers, blocked liters, filters, empty state and modal controls`)
    await context.close()
  }
} finally { await browser.close() }
