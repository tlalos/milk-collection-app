import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { emptyCmrData } from '../server/cmrDocument.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
const image = await readFile(process.env.CMR_TEST_IMAGE || 'test-documents/romanian-monthly-settlement-ocr-test.png')
await mkdir('work/cmr', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    let version = 1, attempts = 0, phase = 0, saves = 0
    let job = { id: 'cmr-ocr-test', sourceFile: 'CMR.jpeg', mimeType: 'image/jpeg', fileUrl: '/api/ocr/jobs/cmr-ocr-test/file',
      status: 'completed', reviewStatus: 'reviewed', updatedAt: 'v1', data: { ...emptyCmrData(), supplier: 'Saved manual supplier' } }
    const errors = [], unexpected = []
    await context.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url()), method = route.request().method()
      if (!pathname.startsWith('/api/')) return route.continue()
      if (pathname === '/api/auth/session') return route.fulfill({ json: { user: { username: 'cmr-test', isAdmin: false, permissions: ['ocr_documents'] } } })
      if (pathname === '/api/activity/page-open') return route.fulfill({ json: {} })
      if (pathname.endsWith('/reception-match')) return route.fulfill({ json: { documentVersion: '0x0000000000000001', updatedAt: job.updatedAt, link: null, linkedReception: null, candidates: [] } })
      if (pathname === '/api/ocr/cmr/truck-options') return route.fulfill({ json: { trucks: [], drivers: [] } })
      if (pathname === '/api/ocr/jobs/cmr-ocr-test/file') return route.fulfill({ contentType: 'image/jpeg', body: image })
      if (pathname === '/api/ocr/cmr/cmr-ocr-test/recognize' && method === 'POST') {
        assert.equal(route.request().postDataJSON().updatedAt, job.updatedAt)
        attempts++; phase = 0
        job = { ...job, status: 'queued', reviewStatus: 'pending', updatedAt: `v${++version}`, error: null }
        return route.fulfill({ status: 202, json: { job } })
      }
      if (pathname === '/api/ocr/cmr') {
        if (['queued', 'processing'].includes(job.status)) {
          phase++
          if (phase === 1) job = { ...job, status: 'processing', updatedAt: `v${++version}` }
          else if (attempts === 2) job = { ...job, status: 'failed', error: 'Test provider unavailable', updatedAt: `v${++version}` }
          else job = { ...job, status: 'completed', updatedAt: `v${++version}`,
            data: { ...emptyCmrData(), date: job.data.date, supplier: 'MIRON', truckNumber: 'MS 33 MRN', avizNumber: '00168', quantity: 4900, quantityUnit: 'L', loadingDate: '2026-09-23' },
            openai: { model: 'test-model', durationMs: 27000 },
            cmrOcr: { warnings: ['Box 25 has no legible receipt date.'], uncertainFields: ['date'], verifiedFields: [], confidence: 0.85, rawTranscription: 'Aviz 00168; 4900 litri' } }
        }
        return route.fulfill({ json: { jobs: [job] } })
      }
      if (pathname === '/api/ocr/cmr/cmr-ocr-test' && method === 'PATCH') {
        const body = route.request().postDataJSON()
        assert.equal(body.updatedAt, job.updatedAt)
        saves++
        job = { ...job, data: body.data, updatedAt: `v${++version}`, reviewStatus: body.markReviewed ? 'reviewed' : 'pending',
          cmrOcr: { ...job.cmrOcr, verifiedFields: ['date'] } }
        return route.fulfill({ json: { job } })
      }
      unexpected.push(`${method} ${pathname}`)
      return route.fulfill({ status: 400, json: { error: 'Unexpected request' } })
    })
    const page = await context.newPage()
    page.on('pageerror', err => errors.push(err.message))
    page.on('dialog', dialog => dialog.accept())
    await page.goto(base + '/ocr/cmr-review?id=cmr-ocr-test')
    await page.getByRole('button', { name: 'Run OCR', exact: true }).waitFor()
    assert.equal(await page.getByRole('heading', { name: 'Recognised data', exact: true }).count(), 1)
    assert.equal(await page.locator('.cmr-fields-heading').getByRole('button', { name: 'Save changes', exact: true }).count(), 1)
    assert.equal(await page.locator('.cmr-source-heading h2').innerText(), 'CMR.jpeg')
    assert.equal(await page.getByRole('tab', { name: 'Reviewed', exact: true }).getAttribute('aria-selected'), 'true')
    await page.getByRole('button', { name: 'Run OCR', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.cmr-ocr-status')?.textContent.includes('Queued'))
    assert.equal(await page.getByLabel('Supplier (1)', { exact: true }).isDisabled(), true)
    assert.equal(await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).isDisabled(), true)
    await page.waitForFunction(() => document.querySelector('.cmr-ocr-status')?.textContent.includes('Ready for review'), { timeout: 15000 })
    assert.equal(await page.getByLabel('Supplier (1)', { exact: true }).inputValue(), 'MIRON')
    assert.equal(await page.getByLabel('Reception date', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('Reception date', { exact: true }).getAttribute('aria-invalid'), 'true')
    assert.equal(await page.getByLabel('Loading date', { exact: true }).inputValue(), '2026-09-23')
    assert.equal(await page.getByLabel('Aviz number', { exact: true }).inputValue(), '00168')
    assert.equal(await page.getByLabel('Document quantity', { exact: true }).inputValue(), '4900')
    assert.equal(await page.getByRole('combobox', { name: /^Unit/ }).inputValue(), 'L')
    const goods = page.locator('.cmr-quantity-fields')
    assert.equal(await page.locator('.cmr-fields fieldset > :last-child').getAttribute('class'), 'cmr-reception-match', 'Reception matching follows all document fields')
    const positions = await goods.locator('label').evaluateAll(labels => labels.map(label => {
      const { top, bottom } = label.getBoundingClientRect()
      return { top, bottom }
    }))
    assert.equal(positions.length, 3)
    if (width > 1100) assert.ok(positions.every(position => Math.abs(position.top - positions[0].top) < 1), 'Goods fields share one desktop row')
    else assert.ok(positions[1].top >= positions[0].bottom && positions[2].top >= positions[1].bottom, 'Goods fields stack on mobile')
    await goods.scrollIntoViewIfNeeded()
    await goods.screenshot({ path: `work/cmr/goods-${width}.png` })
    assert.equal(await page.getByRole('tab', { name: 'Pending', exact: true }).getAttribute('aria-selected'), 'true')
    await page.locator('.cmr-warnings summary').click()
    await page.getByText('Box 25 has no legible receipt date.', { exact: true }).waitFor()
    await page.getByLabel('Reception date', { exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `work/cmr/ocr-result-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    await page.getByLabel('Reception date', { exact: true }).fill('2026-09-24')
    assert.equal(await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).isDisabled(), true)
    await page.getByLabel('Goods receipt date (25)', { exact: true }).fill('2026-09-25')
    await page.getByLabel('CMR issue date (22)', { exact: true }).fill('2026-09-23')
    await page.getByLabel('CMR issue date (22)', { exact: true }).blur()
    await page.getByRole('combobox', { name: /^Milk type/ }).selectOption('MILK-COW')
    await page.waitForFunction(() => document.querySelector('.cmr-autosave')?.textContent.includes('Autosaved'))
    assert.equal(job.reviewStatus, 'pending')
    assert.equal(job.data.date, '2026-09-24')
    assert.equal(job.data.receiptDate, '2026-09-25')
    for (const [label, value, select] of [['Supplier (1)', 'MIRON'], ['Truck number', 'MS 33 MRN'], ['Aviz number', '00168'], ['Reception date', '2026-09-24'], ['Goods receipt date (25)', '2026-09-25'], ['CMR issue date (22)', '2026-09-23'], ['Document quantity', '4900'], ['Milk type', 'MILK-COW', true], ['Unit', 'L', true]]) {
      const field = select ? page.getByRole('combobox', { name: new RegExp(`^${label}`) }) : page.getByLabel(label, { exact: true })
      if (select) await field.selectOption(''); else await field.fill('')
      assert.equal(await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).isDisabled(), true, label)
      if (select) await field.selectOption(value); else await field.fill(value)
    }
    await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Reviewed')
    assert.equal(job.reviewStatus, 'reviewed')
    await page.getByRole('button', { name: 'Redo OCR', exact: true }).click()
    await page.getByText('Test provider unavailable', { exact: true }).waitFor({ timeout: 15000 })
    assert.equal(await page.getByRole('tab', { name: 'Failed', exact: true }).getAttribute('aria-selected'), 'true')
    assert.equal(await page.getByLabel('Reception date', { exact: true }).inputValue(), '2026-09-24', 'Failed retry retains corrections')
    assert.equal(await page.getByRole('button', { name: 'Mark as reviewed', exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: 'Redo OCR', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.cmr-ocr-status')?.textContent.includes('Ready for review'), { timeout: 15000 })
    assert.equal(job.reviewStatus, 'pending')
    assert.equal(attempts, 3)
    assert.ok(saves >= 2)
    assert.equal(job.data.date, '2026-09-24', 'Successful OCR also preserves the independent matching date')
    assert.deepEqual(errors, []); assert.deepEqual(unexpected, [])
    console.log(`PASS CMR OCR ${width}: progress, uncertain date, returned fields, autosave, review, failed retry preservation, retry success, no ERP requests`)
    await context.close()
  }
} finally { await browser.close() }
