/* global document, window, innerWidth, innerHeight */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/review-guide', { recursive: true })
const job = {
  id: 'guide-fixture', sourceFile: 'route-test.png', mimeType: 'image/png', status: 'completed', reviewStatus: 'pending', createdAt: '2026-10-01T10:00:00Z', completedAt: '2026-10-01T10:01:00Z',
  fileUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  attention: { warningCount: 0, uncertainFieldCount: 0, needsAttention: false }, summary: { date: '2026-10-01', route: 'R01', driverName: 'Test driver', vehicleRegistration: 'TEST-01' },
  openai: { provider: 'test', model: 'test-ocr-model', durationMs: 1200, cost: { estimatedUsd: 0.12 }, usage: null },
  data: { documentType: 'daily_driver_statement', companyName: 'Test company', date: '2026-10-01', driverName: 'Test driver', vehicleRegistration: 'TEST-01', route: 'R01', totalLiters: 100, warnings: [], rawTranscription: '',
    rows: [{ rowNumber: 1, collectionCenter: 'Test center', milkType: 'MILK-COW', liters: 100, fatPercent: 4, density: 1.03, water: 0, temperature: 4, noticeNumber: 'TEST-AVIZ', confidence: 1, uncertainFields: [] }] },
  centerMatches: [{ rowNumber: 1, originalName: 'Test center', selectedCode: 'c0001', selectedName: 'Test center', status: 'confirmed', suggestions: [{ code: 'c0001', name: 'Test center', score: 1 }] }],
}
try {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    if (process.env.GUIDE_TEST_WIDTH && viewport.width !== Number(process.env.GUIDE_TEST_WIDTH)) continue
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const page = await context.newPage()
    const writes = [], errors = [], modules = []
    let empty = false
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => modules.push(request.url()))
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(`${request.method()} ${path}`)
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
      if (path === '/api/ocr/jobs') return route.fulfill({ json: { jobs: empty ? [] : [job] } })
      if (path === '/api/ocr/jobs/guide-fixture') return route.fulfill({ json: { job } })
      if (path === '/api/ocr/reference-suppliers') return route.fulfill({ json: { centers: [{ code: 'c0001', name: 'Test center' }], producers: [], fetchedAt: '2026-10-01T10:00:00Z' } })
      if (path === '/api/ocr/reception-routes') return route.fulfill({ json: { routes: [{ receptionId: 'r1', receptionDate: '2026-10-01', truck: 'TEST-01', route: 'R01', milkType: 'MILK-COW', netQuantityKg: 103, calculatedLiters: 100, status: 'complete' }] } })
      return route.fulfill({ json: { jobs: [], drivers: [], vehicles: [], routes: [], items: [] } })
    })
    await page.goto(`${base}/ocr/review`)
    await page.locator('.review-job-open').waitFor()
    assert.equal(await page.getByRole('button', { name: /Backup history|Istoric backup/ }).count(), 0)
    assert.equal(modules.some(url => /\/ReviewWalkthrough\./.test(url)), false)
    for (const isRo of [false, true]) {
      if (isRo) await page.getByRole('button', { name: 'Romanian', exact: true }).click()
      const card = page.locator('.review-job-open').first()
      assert.equal(await card.locator('.review-job-model, .review-job-cost').count(), 0)
      assert.doesNotMatch(await card.innerText(), /test-ocr-model|OpenAI est\./)
      assert.match(await card.innerText(), /R01/)
      assert.match(await card.innerText(), /Test driver/)
      assert.match(await card.innerText(), /TEST-01/)
      assert.equal(await card.locator('.review-job-status').count(), 1)
      const help = page.getByRole('button', { name: isRo ? 'Ghid de verificare' : 'Review guide', exact: true })
      await help.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      for (let step = 0; step < 6; step++) {
        await dialog.locator('header > span').filter({ hasText: `${step + 1}/6` }).waitFor()
        await dialog.locator('.ocr-tour-practice').waitFor()
        await page.waitForTimeout(200)
        if (step === 2) {
          const save = page.locator('.review-manual-save')
          assert.equal(await save.textContent(), '')
          assert.equal(await save.getAttribute('title'), isRo ? 'Salvați modificările' : 'Save changes')
          assert.deepEqual(await save.evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color })), { background: 'rgb(26, 107, 60)', color: 'rgb(255, 255, 255)' })
          assert.equal(await page.locator('.review-data-title-line .review-ocr-time-badge').count(), 1)
          const headingLayout = await page.locator('.review-data-heading').evaluate(el => {
            const header = el.getBoundingClientRect()
            const save = el.querySelector('.review-manual-save').getBoundingClientRect()
            const status = el.querySelector('.review-autosave-status').getBoundingClientRect()
            const boxes = [...el.querySelectorAll('h2, .review-ocr-time-badge, .review-manual-save, .review-autosave-status, .clear-badge')].map(item => item.getBoundingClientRect())
            return { sideBySide: status.right < save.left && Math.abs(save.top + save.height / 2 - status.top - status.height / 2) < 1,
              inside: boxes.every(box => box.left >= header.left && box.right <= header.right && box.top >= header.top && box.bottom <= header.bottom),
              overlaps: boxes.some((box, i) => boxes.slice(i + 1).some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)) }
          })
          assert.equal(headingLayout.sideBySide, true, 'save and autosave stay together')
          assert.equal(headingLayout.inside, true, 'header content stays inside')
          assert.equal(headingLayout.overlaps, false, 'header controls do not overlap')
        }
        const geometry = await page.evaluate(() => {
          const p = document.querySelector('.sign-in-tour-panel').getBoundingClientRect()
          const r = document.querySelector('.sign-in-tour-ring').getBoundingClientRect()
          return { inside: p.left >= 0 && p.right <= innerWidth + 1 && p.top >= 0 && p.bottom <= innerHeight + 1,
            overlap: p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top }
        })
        await page.screenshot({ path: `work/review-guide/${viewport.width}-${isRo ? 'ro' : 'en'}-${step + 1}.png` })
        assert.equal(geometry.inside, true, `panel outside ${viewport.width}/${step}`)
        assert.equal(geometry.overlap, false, `panel overlaps target ${viewport.width}/${step}`)
        if (step === 0) await dialog.locator('.sign-in-tour-next').click()
        else {
          await dialog.locator('.ocr-tour-practice').click()
          if (step === 3) assert.equal(await page.locator('.review-reception-routes').getAttribute('open'), '')
          if (step !== 1) await dialog.locator('.sign-in-tour-next').click()
        }
      }
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await page.locator('.review-complete').count(), 1, 'practice never marks reviewed')
      assert.equal(await page.locator('.review-center-cell input').inputValue(), 'Test center')
      assert.deepEqual(writes, [], 'no saves, review, archive, delete or ERP requests')
      await help.click()
      await dialog.waitFor()
      await dialog.getByRole('button', { name: isRo ? 'English' : 'Romanian', exact: true }).click()
      await dialog.getByRole('heading', { name: isRo ? 'After uploading' : 'După încărcare' }).waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await page.locator('#root').evaluate(el => el.inert), false)
      await page.getByRole('button', { name: isRo ? 'Romanian' : 'English', exact: true }).click()
    }
    empty = true
    await page.reload()
    await page.getByRole('button', { name: 'Ghid de verificare', exact: true }).click()
    await page.locator('.sign-in-tour-next').click()
    await page.getByRole('status').filter({ hasText: 'Nu există un document disponibil' }).waitFor()
    assert.equal(await page.locator('.sign-in-tour-next').isDisabled(), true)
    await page.keyboard.press('Escape')
    await page.goto(`${base}/ocr/monthly-review`)
    const monthlyHelp = page.getByRole('button', { name: 'Ghid de verificare', exact: true })
    await monthlyHelp.waitFor()
    assert.equal(await page.getByRole('button', { name: /Backup history|Istoric backup/ }).count(), 0)
    await monthlyHelp.click()
    await page.locator('.sign-in-tour-next').click()
    await page.getByRole('heading', { name: 'Alegeți un document' }).waitFor()
    await page.locator('.sign-in-tour-next').click()
    assert.deepEqual(writes, [])
    assert.deepEqual(errors, [])
    console.log(`PASS ${viewport.width}: six daily steps EN/RO, reception routes, safe completion, empty queue, monthly introduction`)
    await context.close()
  }
} finally { await browser.close() }
