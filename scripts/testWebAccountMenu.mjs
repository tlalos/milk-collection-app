import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/account-menu', { recursive: true })

try {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    let signedIn = true
    let logouts = 0
    let username = 'lactea'
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: signedIn ? { id: 'test-only', username, isAdmin: true } : null } })
      if (path === '/api/auth/logout') {
        assert.equal(route.request().method(), 'POST')
        logouts++
        signedIn = false
        return route.fulfill({ json: { ok: true } })
      }
      return route.fulfill({ status: 503, json: { error: 'Test: data unavailable' } })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    for (const path of ['/milk-deliveries', '/month-closure', '/ocr/upload', '/ocr']) {
      signedIn = true
      const before = logouts
      await page.goto(`${baseUrl}${path}`)
      const bubble = page.getByRole('button', { name: `Web account: ${username}`, exact: true })
      await bubble.waitFor()
      assert.equal(await bubble.innerText(), 'LA')
      assert.equal(await bubble.getAttribute('aria-expanded'), 'false')
      assert.equal(await page.getByRole('button', { name: 'Log out', exact: true }).count(), 0)
      const box = await bubble.boundingBox()
      assert.equal(box.width, 38)
      assert.equal(box.height, 38)
      assert.equal(await bubble.evaluate(el => getComputedStyle(el).borderRadius), '50%')
      if (path === '/ocr') assert.equal(await page.locator('.ocr-language-switch').count(), 0)
      else {
        const language = await page.locator('.ocr-language-switch').boundingBox()
        assert.equal(box.x - language.x - language.width, 8)
        assert.equal(box.y, language.y)
      }
      await bubble.click()
      const panel = page.getByRole('dialog', { name: `Web account: ${username}`, exact: true })
      await panel.waitFor()
      assert.equal(await panel.locator('.web-account-username').innerText(), username)
      const panelBox = await panel.boundingBox()
      assert.ok(panelBox.y > box.y + box.height)
      assert.ok(panelBox.x >= 0 && panelBox.x + panelBox.width <= viewport.width)
      assert.equal(panelBox.x + panelBox.width, box.x + box.width)
      assert.equal(logouts, before, 'Opening must not log out')
      await page.screenshot({ path: `work/account-menu/${path.replaceAll('/', '_')}-${viewport.width}.png` })
      await page.keyboard.press('Escape')
      assert.equal(await panel.count(), 0)
      assert.equal(await bubble.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      await panel.waitFor()
      await page.mouse.click(4, viewport.height - 4)
      assert.equal(await panel.count(), 0)
      assert.equal(logouts, before, 'Dismissal must not log out')
      await bubble.click()
      await panel.getByRole('button', { name: 'Log out', exact: true }).click()
      await bubble.waitFor({ state: 'detached' })
      assert.equal(logouts, before + 1)
      console.log(`PASS ${viewport.width}: ${path} initials, position, keyboard, dismissal, mocked logout`)
    }
    // Long account names wrap inside the popup, not across the header.
    signedIn = true
    username = 'long.account.name.with.no.spaces.for.the.layout.test'
    await page.goto(`${baseUrl}/milk-deliveries`)
    await page.locator('.web-account-trigger').click()
    assert.equal(await page.locator('.web-account-trigger').innerText(), 'LO')
    assert.equal(await page.locator('.web-account-username').evaluate(el => el.scrollWidth <= el.clientWidth), true)
    assert.deepEqual(errors, [])
    await context.close()
  }
} finally {
  await browser.close()
}
