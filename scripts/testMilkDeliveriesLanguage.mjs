import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
const translations = [
  ['Arrival in Greece', 'Sosire în Grecia'],
  ['Excel columns M-P', 'Coloanele M-P din Excel'],
  ['Weight from Greece *', 'Greutate din Grecia *'],
  ['Invoice number *', 'Număr factură *'],
  ['Difference', 'Diferență'],
  ['Comments / destination', 'Comentarii / destinație'],
  ['All statuses', 'Toate stările'],
]
const placeholders = [
  ['AVIZ, truck, milk type or destination...', 'AVIZ, camion, tip de lapte sau destinație...'],
  ['Invoice number', 'Număr factură'],
  ['Destination and arrival notes...', 'Observații despre destinație și sosire...'],
]
await mkdir('work/delivery-language', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' })
    const writes = []
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (route.request().method() !== 'GET' && path !== '/api/activity/page-open') writes.push(path)
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      return route.fulfill({ json: {} })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/milk-deliveries')
    await page.goto(`${baseUrl}/milk-deliveries`)
    await loaded
    await page.getByText('0 rows shown', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Add delivery', exact: true }).click()
    assert.equal(await page.locator('.milk-delivery-detail-row').count(), 0, 'New rows start collapsed')
    await page.getByRole('button', { name: 'Expand delivery', exact: true }).click()
    await page.getByRole('heading', { name: 'Arrival in Greece' }).waitFor()
    await page.getByPlaceholder('Truck', { exact: true }).fill('CJ-TEST')
    const screen = page.locator('.milk-deliveries-screen')
    const english = await screen.textContent()
    const fieldsBefore = await screen.locator('input, select, textarea').evaluateAll(fields => fields.map(field => field.value))
    await page.getByRole('button', { name: 'Romanian', exact: true }).click()
    for (const [, ro] of translations) assert.equal(await screen.getByText(ro, { exact: true }).count(), 1, ro)
    for (const [, ro] of placeholders) assert.equal(await screen.getByPlaceholder(ro, { exact: true }).count(), 1, ro)
    let translated = await screen.textContent()
    for (const [en, ro] of translations) translated = translated.replaceAll(ro, en)
    assert.equal(translated, english, 'Only marked text may change')
    assert.deepEqual(await screen.locator('input, select, textarea').evaluateAll(fields => fields.map(field => field.value)), fieldsBefore)
    assert.equal(await page.getByPlaceholder('Număr factură', { exact: true }).isDisabled(), true, 'Draft arrival remains locked')
    await page.screenshot({ path: `work/delivery-language/ro-${width}.png` })
    await page.getByRole('button', { name: 'English', exact: true }).click()
    assert.equal(await screen.textContent(), english)
    for (const [en] of placeholders) assert.equal(await screen.getByPlaceholder(en, { exact: true }).count(), 1)
    assert.deepEqual(writes, [], 'Changing language must not save or send delivery data')
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}: marked text translated, other text unchanged, values and draft lock preserved, EN restored`)
    await context.close()
  }
} finally {
  await browser.close()
}
