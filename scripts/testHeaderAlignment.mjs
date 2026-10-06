import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
const routes = ['/milk-deliveries', '/milk-reception', '/milk-factors', '/month-closure', '/bank-note',
  '/daily-aviz', '/daily-reconciliation', '/monthly-reconciliation', '/ocr/upload', '/ocr/review',
  '/ocr/monthly-review', '/ocr/archive-history', '/ocr/settings', '/ocr/compare', '/web-users', '/web-users/history', '/ocr']
await mkdir('work/header-alignment', { recursive: true })
try {
  for (const width of [1365, 1920]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      return route.fulfill({ status: 503, json: { error: 'Test: data unavailable' } })
    })
    const page = await context.newPage()
    for (const path of routes) {
      await page.goto(`${baseUrl}${path}`)
      await page.locator('.web-account-trigger').waitFor()
      if (path === '/month-closure') {
        const actions = page.locator('.month-closure-actions')
        assert.equal(await actions.getByRole('button').count(), 2)
        assert.equal(await actions.getByRole('button', { name: 'Bank note', exact: true }).count(), 1)
        const refresh = actions.getByRole('button', { name: 'Refresh', exact: true })
        assert.equal(await refresh.textContent(), '')
        assert.equal(await refresh.locator('svg').count(), 1)
        assert.equal(await refresh.getAttribute('title'), 'Refresh')
        assert.equal((await refresh.boundingBox()).width, 38)
      }
      if (path === '/bank-note') {
        assert.equal(await page.locator('.month-closure-actions').getByRole('button').count(), 3)
      }
      const boxes = await page.locator('header button:not(.ocr-language-switch > button), .ocr-auth-session .web-account-trigger, .ocr-auth-session .ocr-language-switch').evaluateAll(elements => elements.filter(el => el.getBoundingClientRect().width).map(el => {
        const rect = el.getBoundingClientRect()
        return { label: el.textContent || el.getAttribute('aria-label'), top: rect.top, height: rect.height }
      }))
      assert.ok(boxes.length >= 2)
      for (const box of boxes) {
        assert.equal(box.height, 38, `${path}: ${box.label} height`)
        assert.ok(Math.abs(box.top - 16) < 1, `${path}: ${box.label} top ${box.top}`)
      }
      if (width === 1365 && ['/milk-deliveries', '/ocr/upload', '/month-closure'].includes(path)) {
        await page.screenshot({ path: `work/header-alignment/${path.replaceAll('/', '_')}.png` })
      }
      if (path !== '/ocr') {
        const scrollCheck = await page.evaluate(() => {
          const session = document.querySelector('.ocr-auth-session')
          const wrapper = document.querySelector('.ocr-auth-content')
          const before = session.getBoundingClientRect().top - wrapper.getBoundingClientRect().top
          const spacer = document.createElement('div')
          spacer.style.height = '1000px'
          wrapper.append(spacer)
          window.scrollTo({ top: 150, behavior: 'instant' })
          const scrolled = window.scrollY
          const top = session.getBoundingClientRect().top
          const after = top - wrapper.getBoundingClientRect().top
          spacer.remove()
          window.scrollTo({ top: 0, behavior: 'instant' })
          return { before, after, top, scrolled }
        })
        assert.equal(scrollCheck.after, scrollCheck.before, `${path}: account controls remain anchored to header`)
        assert.ok(scrollCheck.scrolled > 0, 'test must scroll')
        assert.ok(scrollCheck.top < 0, `${path}: account controls scroll out with header`)
      }
      console.log(`PASS ${width}: ${path} header controls aligned`)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
