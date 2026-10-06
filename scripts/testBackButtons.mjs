import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/back-buttons', { recursive: true })
const routes = [
  ['/month-closure', '/ocr'], ['/bank-note?month=2026-08', '/month-closure?month=2026-08'],
  ['/daily-aviz', '/ocr'], ['/daily-reconciliation', '/ocr'], ['/monthly-reconciliation', '/ocr'],
  ['/milk-reception', '/ocr'], ['/milk-deliveries', '/ocr'], ['/ocr/upload', '/ocr'],
  ['/ocr/archive-history', '/ocr'], ['/ocr/settings?from=review', '/ocr/review'],
  ['/web-users', '/home'], ['/web-users/history', '/web-users'],
]

try {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { id: 'test-only', username: 'test-only', isAdmin: true } } })
      // Exercise headers without loading or changing real business records.
      return route.fulfill({ status: 503, json: { error: 'Test: data unavailable' } })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const [from, to] of routes) {
      await page.goto(`${baseUrl}${from}`)
      const back = page.locator('.app-back-button').first()
      await back.waitFor()
      assert.equal((await back.innerText()).trim(), '', 'Back must have no visible words')
      assert.ok(await back.getAttribute('aria-label'))
      assert.ok(await back.getAttribute('title'))
      assert.equal(await back.locator('svg.lucide-arrow-left').count(), 1)
      const rect = await back.boundingBox()
      assert.equal(rect.width, 38, `${from}: compact fixed width`)
      assert.equal(rect.height, 38, `${from}: consistent height`)
      assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width)
      if (['/month-closure', '/ocr/upload', '/web-users'].includes(from)) {
        await page.screenshot({ path: `work/back-buttons/${from.replaceAll('/', '_')}-${viewport.width}.png` })
      }
      await back.click()
      await page.waitForURL(`${baseUrl}${to}`)
      console.log(`PASS ${viewport.width}: ${from} -> ${to}`)
    }
    await page.goto(`${baseUrl}/ocr`)
    const home = page.locator('.home-header').getByRole('button', { name: 'Master menu', exact: true })
    assert.equal(await home.innerText(), '')
    assert.equal(await home.locator('svg.lucide-house').count(), 1)
    assert.equal(await page.locator('.home-main .home-menu-back').count(), 0)
    const homeBox = await home.boundingBox()
    assert.equal(homeBox.width, 38)
    assert.equal(homeBox.height, 38)
    assert.equal(homeBox.x, viewport.width <= 760 ? 12 : 16)
    await page.screenshot({ path: `work/back-buttons/ocr-home-${viewport.width}.png` })
    await home.click()
    await page.waitForURL(`${baseUrl}/home`)
    await page.getByText('Choose a menu', { exact: true }).waitFor()
    await page.reload()
    await page.getByText('Choose a menu', { exact: true }).waitFor()
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally {
  await browser.close()
}
