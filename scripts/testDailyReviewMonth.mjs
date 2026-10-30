import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
await mkdir('work/daily-review-month', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const requests = [], details = [], errors = []
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test', isAdmin: true } } })
      if (url.pathname === '/api/ocr/jobs') {
        requests.push(url.searchParams)
        await new Promise(resolve => setTimeout(resolve, 1200))
        const month = url.searchParams.get('month')
        const jobs = ['2026-10', '2026-09'].filter(value => !month || value === month).map(value => ({
          id: value, sourceFile: `${value}.jpg`, status: url.searchParams.has('reviewStatus') ? 'completed' : 'failed',
          reviewStatus: url.searchParams.get('reviewStatus') || 'pending', documentCategory: 'daily_routes',
          createdAt: `${value}-15T10:00:00Z`, summary: { date: `${value}-15`, route: value, rowCount: 1 },
        }))
        return route.fulfill({ json: { jobs } }).catch(() => {})
      }
      if (/\/api\/ocr\/jobs\//.test(url.pathname)) details.push(url.pathname)
      return route.fulfill({ json: { centers: [], drivers: [], vehicles: [], routes: [] } })
    })
    const page = await context.newPage()
    page.on('pageerror', e => errors.push(e.message))
    await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'))
    await page.goto('http://127.0.0.1:5173/ocr/review', { waitUntil: 'domcontentloaded' })
    await page.screenshot({ path: `work/daily-review-month/loading-${width}.png` })
    await page.getByText('Loading documents…', { exact: true }).waitFor().catch(async error => {
      console.log({ errors, body: (await page.locator('body').innerText()).slice(0, 2500), requests: requests.map(p => p.toString()) })
      throw error
    })
    assert.equal(await page.getByText('No pending documents.', { exact: true }).count(), 0)
    const month = page.getByLabel('Document month', { exact: true })
    assert.equal(await month.inputValue(), '2026-10')
    await page.locator('.review-job-item').first().waitFor()
    assert.equal(await page.locator('.review-job-item').count(), 1)
    assert.equal(requests.at(-1).get('month'), '2026-10')
    await month.fill('2026-09')
    await page.locator('.review-job-title').filter({ hasText: '2026-09' }).waitFor()
    await page.getByRole('button', { name: 'Reviewed', exact: true }).click()
    await page.locator('.review-job-item').first().waitFor()
    assert.equal(requests.at(-1).get('reviewStatus'), 'reviewed')
    assert.equal(requests.at(-1).get('month'), '2026-09')
    await page.getByRole('button', { name: 'Failed', exact: true }).click()
    await page.locator('.review-job-item').first().waitFor()
    assert.equal(requests.at(-1).has('reviewStatus'), false)
    await page.getByRole('button', { name: 'All months', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.review-job-item').length === 2)
    assert.equal(requests.at(-1).has('month'), false)
    await page.getByLabel('Filter by date', { exact: true }).fill('2026-10-15')
    await page.locator('.review-job-title').filter({ hasText: '2026-10' }).waitFor()
    assert.equal(await month.inputValue(), '2026-10')
    assert.equal(await page.locator('.review-job-item').count(), 1)
    assert.deepEqual(details, [])
    assert.deepEqual(errors, [])
    await page.screenshot({ path: `work/daily-review-month/${width}.png` })
    console.log(`PASS ${width}: current month, older months, all months, tabs, date filter, loading, no bulk detail requests`)
    await context.close()
  }
} finally { await browser.close() }
