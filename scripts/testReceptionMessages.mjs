import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
await mkdir('work/reception-messages', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const errors = [], receptionQueries = []
    let fail = false, resolved = false, ocrAccess = false
    await context.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/auth/session') return route.fulfill({ json: { user: { username: 'reception-test', permissions: ['milk_reception', ...(ocrAccess ? ['ocr_documents', 'daily_aviz'] : [])], isAdmin: false } } })
      if (url.pathname === '/api/activity/page-open') return route.fulfill({ json: {} })
      if (url.pathname === '/api/milk-receptions/options') return route.fulfill({ json: { options: {} } })
      if (url.pathname === '/api/weighbridge/config') return route.fulfill({ json: { weighbridge: {} } })
      if (url.pathname === '/api/milk-receptions') { receptionQueries.push(url.searchParams.get('date')); return route.fulfill({ json: { records: [] } }) }
      if (url.pathname === '/api/milk-receptions/messages') return route.fulfill({ status: fail ? 503 : 200, json: fail ? { error: 'Messages unavailable' } : { messages: resolved ? [] : [
        { id: 'aviz-1', documentType: 'daily_aviz', kind: 'missing_reception', receptionDate: '2026-09-23', truckNumber: 'MS 20 AVZ', route: 'R201', avizNumber: '00012', quantity: 150, unit: 'L', reviewed: false },
        ...['missing_reception', 'missing_weights', 'confirm_match', 'review_link'].map((kind, index) => ({ id: `cmr-${index}`, documentType: 'cmr', kind, receptionDate: '2026-09-23', truckNumber: `MS ${33 + index} MRN`, supplier: 'MIRON', avizNumber: '00168', quantity: 4900, unit: 'L', reviewed: index > 0 }))] } })
      errors.push(url.pathname)
      return route.fulfill({ status: 400, json: {} })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto((process.env.APP_TEST_URL || 'http://127.0.0.1:5173') + '/milk-reception')
    await page.getByRole('button', { name: 'Reception messages: 5 outstanding', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Reception messages', exact: true })
    await dialog.getByText(/No Others scale reception found/).waitFor()
    assert.equal(await dialog.locator('li').count(), 5)
    await dialog.getByText(/No Collection scale reception found/).waitFor()
    assert.match(await dialog.innerText(), /Route: R201/)
    assert.equal(await dialog.getByRole('link', { name: 'Open Daily Aviz' }).count(), 0)
    assert.equal(await dialog.getByRole('link', { name: 'Review CMR' }).count(), 0)
    assert.match(await dialog.innerText(), /Current and previous month/)
    const bounds = await dialog.boundingBox()
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true)
    await page.screenshot({ path: `work/reception-messages/inbox-${width}.png` })
    await dialog.getByRole('button', { name: 'View receptions', exact: true }).first().click()
    assert.equal(await dialog.isVisible(), false)
    await page.waitForFunction(() => document.querySelector('.reception-toolbar input[type=date]')?.value === '2026-09-23')
    await page.waitForTimeout(300)
    assert.ok(receptionQueries.includes('2026-09-23'))
    assert.equal(await page.getByRole('button', { name: 'Add reception row', exact: true }).isDisabled(), true, 'Historical permissions remain unchanged')
    await page.getByRole('button', { name: 'Reception messages: 5 outstanding', exact: true }).click()
    fail = true
    await page.getByRole('button', { name: 'Refresh messages', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.getByText('No outstanding reception messages.').count(), 0)
    fail = false; resolved = true
    await page.getByRole('button', { name: 'Refresh messages', exact: true }).click()
    await dialog.getByText('No outstanding reception messages.').waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await dialog.isVisible(), false)
    assert.equal(await page.getByRole('button', { name: 'Reception messages: 0 outstanding', exact: true }).evaluate(element => element === document.activeElement), true)
    resolved = false; ocrAccess = true
    await page.reload()
    await page.getByRole('button', { name: 'Reception messages: 5 outstanding', exact: true }).click()
    assert.equal(await dialog.getByRole('link', { name: 'Review CMR' }).count(), 4)
    assert.equal(await dialog.getByRole('link', { name: 'Open Daily Aviz' }).getAttribute('href'), '/daily-aviz?month=2026-09')
    assert.deepEqual(errors, [])
    console.log(`PASS reception messages ${width}: inbox, permissions, date navigation, errors, resolution, keyboard, layout`)
    await context.close()
  }
} finally { await browser.close() }
