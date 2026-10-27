import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { defaultMilkDensitySettings, validateMilkDensitySettings } from '../server/milkDensitySettingsStore.js'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
await mkdir('work/delivery-product-factors', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' })
    let settings = structuredClone(defaultMilkDensitySettings), saves = 0
    const errors = []
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      if (path === '/api/milk-factors') {
        if (route.request().method() === 'PUT') {
          settings = route.request().postDataJSON().settings
          validateMilkDensitySettings(settings)
          saves++
        }
        return route.fulfill({ json: { settings, canEdit: true } })
      }
      assert.ok(route.request().method() === 'GET' || path === '/api/activity/page-open', `Unexpected write: ${path}`)
      return route.fulfill({ json: {} })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
    await page.goto(`${base}/milk-deliveries`)
    await page.getByText('0 rows shown', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Add delivery', exact: true }).click()
    await page.locator('.delivery-weight-input-stack input').nth(0).fill('3000')
    await page.locator('.delivery-weight-input-stack input').nth(1).fill('1000')
    const select = page.locator('select').filter({ has: page.locator('option[value="WHEY"]') })
    for (const [code, label] of [['WHEY', 'Whey'], ['LACTOSE', 'Lactose']]) {
      assert.equal(await select.locator(`option[value="${code}"]`).innerText(), label)
      await select.selectOption(code)
      assert.equal(await select.inputValue(), code)
      assert.equal(await page.locator('output[aria-label="Liters"]').innerText(), '\u2014')
      assert.equal(await page.locator('output[aria-label="Net kg"]').innerText(), '2,000')
    }
    await select.selectOption('MILK-COW')
    assert.equal(await page.locator('output[aria-label="Liters"]').innerText(), '1,944')
    await select.selectOption('WHEY')
    assert.equal(await page.locator('output[aria-label="Liters"]').innerText(), '\u2014')
    await page.goto(`${base}/milk-factors?from=deliveries`)
    for (const label of ['Whey', 'Lactose']) {
      const row = page.locator('tr').filter({ has: page.getByRole('rowheader', { name: label, exact: true }) })
      await row.getByText('Kg only', { exact: true }).waitFor()
      assert.equal(await row.getByRole('spinbutton').count(), 0)
      assert.equal(await row.locator('td').last().innerText(), '\u2014')
      assert.equal(await page.getByRole('spinbutton', { name: `Reception ${label} factor` }).count(), 0)
    }
    await page.getByRole('spinbutton', { name: 'Deliveries Cow factor', exact: true }).fill('1.025')
    await page.getByRole('button', { name: 'Save factors', exact: true }).click()
    await page.getByText('Saved', { exact: true }).waitFor()
    assert.equal(saves, 1)
    await page.reload()
    await page.getByRole('spinbutton', { name: 'Deliveries Cow factor', exact: true }).waitFor()
    assert.equal(await page.getByRole('spinbutton', { name: 'Deliveries Cow factor', exact: true }).inputValue(), '1.025')
    assert.equal(await page.getByText('Kg only', { exact: true }).count(), 2)
    await page.screenshot({ path: `work/delivery-product-factors/factors-${width}.png`, fullPage: true })
    assert.deepEqual(errors, [])
    console.log(`PASS ${width}: kg-only products have no liters or factor inputs; milk conversions and factor saves retained (mock API)`)
    await context.close()
  }
} finally { await browser.close() }
