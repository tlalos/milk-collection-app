import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/daily-aviz-filters', { recursive: true })
try {
  for (const width of [1920, 1365, 1251, 1250, 1100, 900, 861, 860, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' })
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      return route.fulfill({ json: { rows: [] } })
    })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/daily-aviz`)
    const toolbar = page.getByRole('region', { name: 'Daily aviz filters' })
    await toolbar.waitFor()
    const month = toolbar.getByLabel('Month', { exact: true })
    const date = toolbar.getByLabel('Aviz date', { exact: true })
    await month.fill('2026-09')
    await date.fill('2026-09-30')
    assert.equal(await month.inputValue(), '2026-09')
    assert.equal(await date.inputValue(), '2026-09-30')
    const boxes = await toolbar.locator('input, select, button').evaluateAll(elements => elements.map(el => {
      const box = el.getBoundingClientRect()
      const parent = el.parentElement.getBoundingClientRect()
      return { x: box.x, y: box.y, right: box.right, bottom: box.bottom, parentRight: parent.right, width: box.width }
    }))
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i]
      assert.ok(a.x >= 0 && a.right <= width, `${width}: control ${i} within viewport`)
      assert.ok(a.right <= a.parentRight + 1, `${width}: control ${i} within its slot`)
      for (const b of boxes.slice(i + 1)) {
        assert.equal(a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y, false, `${width}: filters overlap`)
      }
    }
    if ([1365, 1100, 390].includes(width)) await page.screenshot({ path: `work/daily-aviz-filters/${width}.png` })
    await toolbar.getByRole('button', { name: 'Clear', exact: true }).click()
    assert.equal(await month.inputValue(), '')
    assert.equal(await date.inputValue(), '')
    console.log(`PASS ${width}: filters stay in bounds without overlap; month/date selection and clear work`)
    await context.close()
  }
} finally {
  await browser.close()
}
