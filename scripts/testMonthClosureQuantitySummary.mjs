import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = { month: '2026-09', center: 'Test center', milkType: 'MILK-COW', source: 'aviz', liters: 1500,
  sourceRowCount: 7, previousMonthLiters: null, previousMonthRowCount: 0, reconciliationStatus: 'missing_monthly',
  reconciliationDifferenceLiters: -1500, centerAvizLiters: 1500, centerMonthlyLiters: 0, centerJournalRows: 0, centerAvizLines: 7 }
const rows = [
  { ...base, id: 'ready', producer: 'Current producer', producerCode: 'p1', pricingStatus: 'needs_price', readyForPricing: true },
  { ...base, id: 'blocked', producer: 'Original producer', producerCode: 'p2', pricingStatus: 'blocked', readyForPricing: false, approvalReviewRequired: true },
]
await mkdir('work/month-closure-summary', { recursive: true })
try {
  for (const width of [1440, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const writes = [], errors = []
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (route.request().method() !== 'GET' && path !== '/api/activity/page-open') writes.push(path)
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test', isAdmin: true } } })
      if (path === '/api/month-closure/pricing-rows') return route.fulfill({ json: { rows,
        summary: { rowCount: 2, centerCount: 1, producerCount: 2, totalLiters: 3000, readyLiters: 1500, blockedLiters: 1500, readyRowCount: 1, blockedRowCount: 1 },
        selectedMonth: '2026-09', monthOptions: ['2026-09'],
      } })
      return route.fulfill({ json: { invoices: [], centers: [], producers: [] } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${process.env.APP_TEST_URL || 'http://127.0.0.1:5173'}/month-closure?month=2026-09`)
    const summary = page.getByRole('region', { name: 'Month closure summary' })
    await summary.locator('div').filter({ hasText: 'Ready for pricing liters' }).getByText('1,500', { exact: true }).waitFor()
    assert.equal(await summary.locator('div').filter({ hasText: 'Blocked / needs-review liters' }).locator('strong').innerText(), '1,500')
    assert.equal(await summary.getByText('Total liters', { exact: true }).count(), 0)
    assert.equal(await summary.locator('div').evaluateAll(elements => elements.every(el => el.scrollWidth <= el.clientWidth + 1)), true)
    await page.getByTitle('Original producer', { exact: true }).waitFor()
    const heading = page.locator('.month-closure-card-title')
    assert.equal(await heading.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    assert.equal(await heading.locator('p').evaluate(el => el.clientWidth >= Math.min(250, innerWidth - 64)), true)
    await page.screenshot({ path: `work/month-closure-summary/summary-${width}.png` })
    await page.locator('label').filter({ has: page.locator('span', { hasText: /^Pricing status$/ }) }).locator('select').selectOption('blocked')
    await page.getByText('1 filtered rows · 0 L ready for pricing · 1,500 L blocked · 0 ready rows · 1 blocked rows', { exact: false }).waitFor()
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}: separate quantities, blocked row retained, filter totals correct, no writes`)
    await context.close()
  }
} finally { await browser.close() }
