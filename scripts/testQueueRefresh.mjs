import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/queue-refresh', { recursive: true })
try {
  for (const width of [1365, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    let reads = 0
    const writes = [], errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('**/api/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (request.method() !== 'GET') writes.push(path)
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      if (path === '/api/ocr/jobs') reads++
      return route.fulfill({ json: { jobs: [], centers: [], producers: [] } })
    })
    await page.goto(`${base}/ocr/review`)
    for (const isRo of [false, true]) {
      if (isRo) await page.getByRole('button', { name: 'Romanian', exact: true }).click()
      const label = isRo ? 'Actualizați coada' : 'Refresh queue'
      const refresh = page.getByRole('button', { name: label, exact: true })
      await refresh.waitFor()
      assert.equal(await page.locator('.review-header').getByRole('button', { name: label }).count(), 0)
      assert.equal(await refresh.textContent(), '')
      assert.equal(await refresh.getAttribute('title'), label)
      const initial = await refresh.boundingBox()
      const collapse = await page.locator('.review-queue-toggle').boundingBox()
      assert.equal(initial.height, 32)
      assert.equal(initial.y, collapse.y)
      assert.ok(collapse.x + collapse.width < initial.x)
      for (const name of isRo ? ['Eșuate', 'Verificate', 'În așteptare'] : ['Failed', 'Reviewed', 'Pending']) {
        await page.locator('.review-queue-tabs').getByRole('button', { name, exact: true }).click()
        assert.deepEqual(await refresh.boundingBox(), initial, 'refresh must not move between tabs')
        const before = reads
        const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/ocr/jobs')
        await refresh.click()
        await response
        assert.ok(reads > before)
      }
      await page.screenshot({ path: `work/queue-refresh/${width}-${isRo ? 'ro' : 'en'}.png` })
      await page.locator('.review-queue-toggle').click()
      assert.equal(await refresh.isVisible(), true)
      const collapsedRefresh = await refresh.boundingBox()
      const rail = await page.locator('.review-queue').boundingBox()
      assert.ok(collapsedRefresh.x >= rail.x && collapsedRefresh.x + 32 <= rail.x + rail.width)
      assert.ok(collapsedRefresh.y + 32 <= rail.y + rail.height)
      await page.locator('.review-queue-toggle').click()
      assert.deepEqual(await refresh.boundingBox(), initial)
    }
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}: stationary EN/RO refresh, reads queue, no writes, collapse/expand`)
    await context.close()
  }
} finally { await browser.close() }
