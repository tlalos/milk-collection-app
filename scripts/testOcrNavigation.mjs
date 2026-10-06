import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
const paths = ['/ocr/upload', '/ocr/archive-history', '/milk-reception', '/milk-deliveries', '/daily-aviz', '/daily-reconciliation', '/monthly-reconciliation', '/month-closure', '/ocr/review', '/ocr/monthly-review', '/bank-note', '/ocr/settings', '/ocr/compare', '/milk-factors']
await mkdir('work/ocr-navigation', { recursive: true })
try {
  for (const width of [1365, 844, 390, 320]) {
    if (process.env.NAV_TEST_WIDTH && width !== Number(process.env.NAV_TEST_WIDTH)) continue
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' })
    let user = { username: 'test-only', isAdmin: true }
    const writes = []
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (!['GET', 'HEAD'].includes(route.request().method()) && path !== '/api/activity/page-open') writes.push(path)
      return route.fulfill(path === '/api/auth/session' ? { json: { user } } : { status: 503, json: { error: 'Test data unavailable' } })
    })
    const page = await context.newPage()
    for (const path of paths) {
      await page.goto(`${base}${path}`)
      const trigger = page.getByRole('button', { name: 'Page menu', exact: true })
      await trigger.waitFor()
      const header = page.locator('.ocr-has-navigation > div > header')
      const back = await header.locator('.app-back-button').boundingBox()
      const menu = await trigger.boundingBox()
      const title = await header.locator('h1').boundingBox()
      assert.equal(back.x, width <= 760 ? 12 : 16, `${path}: left margin`)
      assert.equal(menu.x - back.x - back.width, 10, `${path}: back/menu gap`)
      assert.equal(title.x - menu.x - menu.width, 10, `${path}: menu/title gap`)
      assert.equal(back.y, menu.y, `${path}: buttons aligned`)
      assert.ok(title.width > 0 && title.x + title.width <= width, `${path}: title fits ${JSON.stringify(title)}`)
      const headerOverlaps = await header.evaluate(el => {
        const items = [...el.querySelectorAll('button, h1')].map(item => item.getBoundingClientRect()).filter(r => r.width > 0)
        return items.some((r, i) => items.slice(i + 1).some(s => r.left < s.right - 1 && r.right > s.left + 1 && r.top < s.bottom - 1 && r.bottom > s.top + 1))
      })
      assert.equal(headerOverlaps, false, `${path}: header does not overlap`)
      if (path === '/ocr/upload') await page.screenshot({ path: `work/ocr-navigation/header-${width}.png` })
      await trigger.click()
      const drawer = page.getByRole('dialog', { name: 'OCR menu', exact: true })
      await drawer.waitFor()
      assert.equal(await drawer.getByRole('link').count(), 9)
      assert.equal(await drawer.locator('.ocr-navigation-lock').count(), 0, 'admin has no locked pages')
      assert.equal(await drawer.locator('a.active').count(), 1)
      const bounds = await drawer.boundingBox()
      assert.equal(bounds.x, 0)
      assert.ok(bounds.width <= 280 && bounds.width < width)
      const clipped = await drawer.locator('a').evaluateAll(links => links.some(link => link.scrollWidth > link.clientWidth))
      assert.equal(clipped, false)
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab')
        assert.equal(await drawer.evaluate(el => el.contains(document.activeElement)), true, 'focus stays within drawer')
      }
      if (path === '/month-closure') await page.screenshot({ path: `work/ocr-navigation/${width}.png` })
      await page.keyboard.press('Escape')
      await page.waitForFunction(() => document.querySelector('.ocr-navigation-trigger')?.getAttribute('aria-expanded') === 'false')
      assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true)
      await trigger.click()
      await page.mouse.click(width - 8, 420)
      assert.equal(await drawer.isVisible(), false, 'outside click closes drawer')
      const controls = await page.locator('.ocr-auth-session').evaluate(el => [...el.children].map(child => {
        const r = child.getBoundingClientRect()
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
      }))
      assert.ok(controls.every(r => r.left >= 0 && r.right <= width))
      assert.ok(controls.every((r, i) => !i || controls[i - 1].right <= r.left))
    }
    await page.getByRole('button', { name: 'Page menu', exact: true }).click()
    await page.getByRole('dialog').getByRole('link', { name: 'Daily Aviz', exact: true }).click()
    await page.waitForURL('**/daily-aviz')
    await page.getByRole('button', { name: 'Romanian', exact: true }).click()
    await page.getByRole('button', { name: 'Meniu pagini', exact: true }).click()
    await page.getByRole('dialog', { name: 'Meniu OCR', exact: true }).getByRole('button', { name: 'Închideți meniul', exact: true }).click()
    user = { username: 'restricted', isAdmin: false, permissions: ['ocr_documents'] }
    await page.goto(`${base}/ocr/upload`)
    await page.locator('.ocr-navigation-trigger').click()
    const restrictedDrawer = page.getByRole('dialog')
    assert.equal(await restrictedDrawer.getByRole('link').count(), 9, 'all pages remain visible')
    assert.equal(await restrictedDrawer.locator('a[href]').count(), 3, 'only main menu, documents and backup history allowed')
    assert.equal(await restrictedDrawer.locator('a[aria-disabled="true"] .ocr-navigation-lock').count(), 6)
    assert.equal(await restrictedDrawer.locator('a[href] .ocr-navigation-lock').count(), 0, 'accessible pages have no lock')
    assert.equal(await restrictedDrawer.locator('a').evaluateAll(links => links.some(link => link.scrollWidth > link.clientWidth)), false, 'locked labels fit')
    const lockedLink = restrictedDrawer.getByRole('link', { name: 'Milk Reception: Acces restricționat', exact: true })
    assert.equal(await lockedLink.getAttribute('href'), null)
    await lockedLink.dispatchEvent('click')
    await lockedLink.focus()
    await page.keyboard.press('Enter')
    assert.equal(new URL(page.url()).pathname, '/ocr/upload', 'locked pages cannot navigate')
    await restrictedDrawer.locator('a').last().focus()
    await page.keyboard.press('Tab')
    assert.equal(await restrictedDrawer.getByRole('button').evaluate(el => el === document.activeElement), true, 'focus wraps after locked entry')
    await page.screenshot({ path: `work/ocr-navigation/locked-${width}.png` })
    await page.keyboard.press('Escape')
    await page.goto(`${base}/month-closure`)
    await page.getByRole('heading', { name: 'Acces restricționat' }).waitFor()
    assert.equal(await page.locator('.ocr-navigation-trigger').count(), 0)
    assert.deepEqual(writes, [], 'navigation never saves or sends records')
    console.log(`PASS ${width}: pages, drawer layout, keyboard, outside dismissal, navigation, Romanian controls and permissions`)
    await context.close()
  }
} finally {
  await browser.close()
}
