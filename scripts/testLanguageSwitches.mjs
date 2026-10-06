import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/language-switches', { recursive: true })
const routes = ['/milk-collection', '/month-closure', '/bank-note?month=2026-08',
  '/daily-aviz', '/daily-reconciliation', '/monthly-reconciliation', '/milk-reception', '/milk-deliveries',
  '/milk-factors', '/ocr/upload', '/ocr/archive-history', '/ocr/settings', '/ocr/review',
  '/ocr/monthly-review', '/ocr/compare', '/web-users', '/web-users/history']

try {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    let signedIn = true
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: signedIn ? { id: 'test-only', username: 'test-only', isAdmin: true } : null } })
      return route.fulfill({ status: 503, json: { error: 'Test: data unavailable' } })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const path of routes) {
      await page.goto(`${baseUrl}${path}`)
      const control = page.getByRole('group', { name: 'Language', exact: true })
      await control.waitFor()
      assert.equal(await control.count(), 1)
      const rect = await control.boundingBox()
      assert.equal(rect.width, 84, `${path}: width`)
      assert.equal(rect.height, 38, `${path}: height`)
      assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width, `${path}: within viewport ${JSON.stringify(rect)}`)
      const session = page.locator('.ocr-auth-session')
      if (await session.count()) {
        assert.equal(await session.locator('.ocr-language-switch').count(), 1, `${path}: toggle in session controls`)
        const account = await session.locator('.web-account-trigger').boundingBox()
        assert.equal(account.height, 38)
        assert.equal(rect.y, account.y, `${path}: same baseline`)
        assert.equal(account.x - rect.x - rect.width, 8, `${path}: immediately left of account`)
        assert.equal(rect.y, viewport.width > 760 ? 16 : 10, `${path}: consistent position`)
      }
      const header = page.locator('header').first()
      for (const button of await header.locator('button:not(.ocr-language-switch > button)').all()) {
        if (!(await button.isVisible())) continue
        const buttonRect = await button.boundingBox()
        assert.equal(buttonRect.height, 38, `${path}: header button ${await button.innerText()}`)
        if (await session.count()) {
          const sessionRect = await session.boundingBox()
          const intersects = buttonRect.x < sessionRect.x + sessionRect.width && buttonRect.x + buttonRect.width > sessionRect.x && buttonRect.y < sessionRect.y + sessionRect.height && buttonRect.y + buttonRect.height > sessionRect.y
          assert.equal(intersects, false, `${path}: header button overlaps session`)
        }
      }
      await control.getByRole('button', { name: 'Romanian', exact: true }).click()
      assert.equal(await control.getByRole('button', { name: 'Romanian', exact: true }).getAttribute('aria-pressed'), 'true')
      assert.equal(await page.evaluate(() => localStorage.getItem('ocr-language')), 'ro')
      await page.reload()
      await control.waitFor()
      assert.equal(await control.getByRole('button', { name: 'Romanian', exact: true }).getAttribute('aria-pressed'), 'true')
      await control.getByRole('button', { name: 'English', exact: true }).click()
      await page.mouse.move(viewport.width - 1, viewport.height - 1)
      const colors = await control.locator('button').evaluateAll(buttons => buttons.map(b => ({ color: getComputedStyle(b).color, background: getComputedStyle(b).backgroundColor, font: getComputedStyle(b).fontSize })))
      assert.deepEqual(colors, [{ color: 'rgb(255, 255, 255)', background: 'rgb(23, 92, 59)', font: '12px' }, { color: 'rgb(66, 89, 75)', background: 'rgba(0, 0, 0, 0)', font: '12px' }], path)
      if (['/month-closure', '/ocr/upload', '/web-users', '/ocr/settings', '/milk-collection'].includes(path)) await page.screenshot({ path: `work/language-switches/${path.replaceAll('/', '_')}-${viewport.width}.png` })
      console.log(`PASS ${viewport.width}: ${path}`)
    }
    for (const name of ['Customers', 'Transport', 'Settings', 'Milk collection', 'Data sync']) {
      await page.goto(`${baseUrl}/milk-collection`)
      await page.getByRole('button', { name, exact: true }).click()
      const control = page.getByRole('group', { name: 'Language', exact: true })
      await control.waitFor()
      assert.equal(await control.count(), 1)
      const rect = await control.boundingBox()
      assert.equal(rect.width, 84)
      assert.equal(rect.height, 38)
      assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width, `${name}: within viewport`)
      await control.getByRole('button', { name: 'Romanian', exact: true }).click()
      await control.getByRole('button', { name: 'English', exact: true }).click()
      await page.screenshot({ path: `work/language-switches/collection-${name.replaceAll(' ', '-')}-${viewport.width}.png` })
      console.log(`PASS ${viewport.width}: collection/${name}`)
    }
    // Existing translations still work; the main OCR menu must stay English with no switch.
    await page.goto(`${baseUrl}/ocr/upload`)
    await page.getByRole('button', { name: 'Romanian', exact: true }).click()
    await page.getByRole('heading', { name: /^Document OCR/ }).waitFor()
    await page.goto(`${baseUrl}/ocr`)
    await page.getByRole('heading', { name: 'OCR', exact: true }).waitFor()
    assert.equal(await page.locator('.ocr-language-switch').count(), 0)
    await page.getByText('Month Closure & Payments', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'All menus', exact: true }).click()
    await page.getByText('Choose a menu', { exact: true }).waitFor()
    assert.equal(await page.locator('.ocr-language-switch').count(), 0)
    await page.goto(`${baseUrl}/home`)
    await page.getByText('Choose a menu', { exact: true }).waitFor()
    assert.equal(await page.locator('.ocr-language-switch').count(), 0)
    signedIn = false
    await page.goto(`${baseUrl}/month-closure`)
    await page.locator('.ocr-auth-card .ocr-language-switch').waitFor()
    assert.equal(await page.locator('.ocr-language-switch').count(), 1)
    await page.screenshot({ path: `work/language-switches/sign-in-${viewport.width}.png` })
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally {
  await browser.close()
}
