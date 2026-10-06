import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/delivery-actions', { recursive: true })
try {
  for (const width of [1365, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
    let record = { id: 'test-delivery', deliveryDate: '2026-10-06', truckNumber: 'CJ-TEST', tractorNumber: '', aviz: 'TEST-AVIZ', milkType: 'MILK-COW', loadedWeightKg: 28000, emptyWeightKg: 10000, deliveryCategory: 'SALES', status: 'DRAFT' }
    const patches = []
    let deletes = 0
    let releaseSave
    const saveGate = new Promise(resolve => { releaseSave = resolve })
    await context.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      const method = route.request().method()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      if (path === '/api/milk-deliveries' && method === 'GET') return route.fulfill({ json: { records: record ? [record] : [] } })
      if (path === '/api/milk-deliveries/test-delivery' && method === 'PATCH') {
        patches.push(route.request().postDataJSON())
        await saveGate
        record = patches.at(-1)
        return route.fulfill({ json: { record } })
      }
      if (path === '/api/milk-deliveries/test-delivery' && method === 'DELETE') {
        deletes++
        if (deletes === 1) return route.fulfill({ status: 503, json: { error: 'Test delete failed' } })
        record = null
        return route.fulfill({ json: {} })
      }
      return route.fulfill({ json: {} })
    })
    const page = await context.newPage()
    await page.goto(`${baseUrl}/milk-deliveries`)
    await page.getByRole('button', { name: 'Show all dates', exact: true }).click()
    const depart = page.getByRole('button', { name: 'Truck departed (mark sent)', exact: true })
    const remove = page.getByRole('button', { name: 'Delete delivery row', exact: true })
    await depart.waitFor()
    assert.equal(await depart.innerText(), '')
    assert.equal(await depart.getAttribute('title'), 'Truck departed (mark sent)')
    const truck = await depart.locator('.lucide-truck').boundingBox()
    const arrow = await depart.locator('.lucide-move-right').boundingBox()
    assert.ok(arrow.y >= truck.y + truck.height)
    await depart.screenshot({ path: `work/delivery-actions/depart-${width}.png` })
    async function confirmDelete(accept) {
      page.once('dialog', async dialog => {
        assert.equal(dialog.type(), 'confirm')
        assert.match(dialog.message(), /Are you sure you want to delete this milk delivery/)
        if (accept) await dialog.accept()
        else await dialog.dismiss()
      })
      await remove.click()
    }
    await confirmDelete(false)
    assert.equal(await remove.count(), 1)
    assert.equal(deletes, 0)
    await depart.click()
    await page.waitForFunction(() => document.querySelector('.delivery-row-actions .send')?.disabled)
    assert.equal(await remove.isDisabled(), true)
    releaseSave()
    await depart.waitFor({ state: 'detached' })
    assert.equal(patches.length, 1)
    assert.equal(patches[0].status, 'AWAITING_GREECE')
    assert.equal(patches[0].aviz, 'TEST-AVIZ')
    await confirmDelete(true)
    await page.getByText('Test delete failed', { exact: true }).waitFor()
    assert.equal(await remove.count(), 1, 'Failed delete must retain the row')
    await confirmDelete(true)
    await remove.waitFor({ state: 'detached' })
    assert.equal(deletes, 2)
    await page.getByRole('button', { name: 'Add delivery', exact: true }).click()
    assert.equal(await page.locator('.milk-delivery-detail-row').count(), 0, 'New delivery starts collapsed')
    await page.getByRole('button', { name: 'Expand delivery', exact: true }).click()
    await page.getByRole('heading', { name: 'Arrival in Greece', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Collapse delivery', exact: true }).click()
    assert.equal(await page.locator('.milk-delivery-detail-row').count(), 0)
    await depart.click()
    assert.equal(patches.length, 1, 'Incomplete draft must not be marked sent')
    await confirmDelete(false)
    assert.equal(await remove.count(), 1, 'Cancel must retain a new draft too')
    await confirmDelete(true)
    await remove.waitFor({ state: 'detached' })
    assert.equal(deletes, 2, 'Removing an unsaved draft must not call the server')
    console.log(`PASS ${width}: icon, departure save and validation, saved/new delete confirmation, cancellation and failure`)
    await context.close()
  }
} finally {
  await browser.close()
}
