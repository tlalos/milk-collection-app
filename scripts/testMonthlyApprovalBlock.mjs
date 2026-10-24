import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const reason = 'This producer already has a journal for this month and milk type.'
const reservedReason = 'Aviz 1190, row 19, is already reserved by Original center / Original producer (2026-09, needs review; approval 12345678-1234-1234-1234-123456789abc). Cancel that approval with a reason before reusing its lines.'
const row = {
  id: 'blocked', month: '2026-09', center: 'VALEA LUNGA - MIHAILA', milkType: 'MILK-COW',
  avizLiters: 789, monthlyLiters: 0, differenceLiters: -789, differencePercent: -100,
  status: 'missing_monthly', avizLineCount: 9, monthlyRowCount: 0, avizRows: [], monthlyRows: [],
  avizPricing: { reason, linkedProducers: [{ producerCode: 'p1', producerName: 'Test producer' }] },
}
await mkdir('work/monthly-approval-block', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const writes = [], errors = []
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (route.request().method() !== 'GET' && path !== '/api/activity/page-open') writes.push(path)
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test', isAdmin: true } } })
      if (path === '/api/ocr/monthly-reconciliation/rows') return route.fulfill({ json: {
        rows: [row, { ...row, id: 'eligible', center: 'Eligible center', avizPricing: {
          centerCode: 'c2', producerCode: 'p2', producerName: 'Eligible producer', approvedLiters: 789,
          sourceFingerprint: 'test', linkedProducers: [{ producerCode: 'p2', producerName: 'Eligible producer' }],
        } }, { ...row, id: 'reserved', center: 'Changed center', avizPricing: { reason: reservedReason, linkedProducers: [] } }], canApproveAviz: true, avizApprovals: [],
      } })
      return route.fulfill({ json: { issues: [], centers: [], summary: {} } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${process.env.APP_TEST_URL || 'http://127.0.0.1:5173'}/monthly-reconciliation?month=2026-09`)
    const blocked = page.locator('.monthly-recon-row').filter({ hasText: row.center })
    const alert = blocked.getByRole('alert')
    await alert.waitFor()
    assert.equal(await alert.innerText(), `Approval blocked: ${reason}`)
    assert.equal(await blocked.getByRole('button', { name: 'Use aviz for pricing' }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Use aviz for pricing' }).count(), 1)
    assert.equal(await alert.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    const reserved = page.locator('.monthly-recon-row').filter({ hasText: 'Changed center' })
    assert.equal(await reserved.getByRole('alert').innerText(), `Approval blocked: ${reservedReason}`)
    assert.equal(await reserved.getByRole('button', { name: 'Use aviz for pricing' }).count(), 0)
    assert.equal(await reserved.getByRole('alert').evaluate(el => el.scrollWidth <= el.clientWidth + 1), true)
    await alert.scrollIntoViewIfNeeded()
    await page.screenshot({ path: `work/monthly-approval-block/blocked-${width}.png` })
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}: blocking reason visible, eligible approval retained, no writes`)
    await context.close()
  }
} finally { await browser.close() }
