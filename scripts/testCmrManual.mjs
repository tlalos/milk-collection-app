import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/cmr', { recursive: true })
const image = await readFile('test-documents/romanian-monthly-settlement-ocr-test.png')
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const empty = { documentType: 'cmr', supplier: '', transport: '', kilos: null, date: '', avizNumber: '' }
    let jobs = [], uploads = 0, saves = 0, failSave = false, link = null, matchWrites = 0, failMatch = false
    let saveGate = null
    const reception = { receptionId: 'other-reception-1', receptionDate: '2026-10-16', vehicleRegistration: 'B 99 CMR', driverName: 'Vlad', netQuantityKg: 1648.515, calculatedLiters: 1600.5, updatedAt: '2026-10-16T12:00:00.000Z' }
    const unexpected = [], errors = []
    await context.route('**/api/**', async route => {
      const { pathname } = new URL(route.request().url()), method = route.request().method()
      if (!pathname.startsWith('/api/')) return route.continue()
      if (pathname === '/api/auth/session') return route.fulfill({ json: { user: { username: 'cmr-test', isAdmin: false, permissions: ['ocr_documents'] } } })
      if (pathname === '/api/activity/page-open') return route.fulfill({ json: {} })
      if (pathname === '/api/ocr/cmr/cmr-test/reception-match') {
        if (method === 'PUT') {
          if (failMatch) return route.fulfill({ status: 409, json: { error: 'The reception changed. Refresh the candidates before confirming.' } })
          const body = route.request().postDataJSON()
          assert.equal(body.updatedAt, jobs[0].updatedAt)
          assert.equal(body.receptionId === null || body.receptionId === reception.receptionId, true)
          if (body.receptionId) assert.equal(body.receptionUpdatedAt, reception.updatedAt)
          matchWrites++
          link = body.receptionId ? { receptionId: body.receptionId, status: 'CONFIRMED', version: '0x0000000000000002' } : null
        }
        return route.fulfill({ json: { documentVersion: '0x0000000000000001', updatedAt: jobs[0].updatedAt, link,
          linkedReception: link ? reception : null, candidates: jobs[0].data.date === reception.receptionDate && jobs[0].data.truckNumber === reception.vehicleRegistration ? [reception] : [] } })
      }
      if (pathname === '/api/ocr/cmr/truck-options') {
        const date = new URL(route.request().url()).searchParams.get('date')
        return route.fulfill({ json: { trucks: date === '2026-10-16' ? ['B 99 CMR', 'CJ 34 GDG'] : [], drivers: date === '2026-10-16' ? ['Miron', 'Vlad'] : [] } })
      }
      if (pathname === '/api/ocr/jobs' && method === 'POST') {
        assert.match(route.request().postDataBuffer().toString(), /name="documentCategory"\r\n\r\ncmr/)
        uploads++
        jobs = [{ id: 'cmr-test', sourceFile: 'cmr-test.png', mimeType: 'image/png', fileUrl: '/api/ocr/jobs/cmr-test/file', reviewStatus: 'pending', status: 'completed', updatedAt: 'v1', data: { ...empty } }]
        return route.fulfill({ status: 202, json: { jobs } })
      }
      if (pathname === '/api/ocr/cmr') return route.fulfill({ json: { jobs } })
      if (pathname === '/api/ocr/jobs/cmr-test/file') return route.fulfill({ contentType: 'image/png', body: image })
      if (pathname === '/api/ocr/cmr/cmr-test' && method === 'PATCH') {
        if (failSave) return route.fulfill({ status: 503, json: { error: 'Test save failure' } })
        saves++
        if (saveGate) await saveGate
        jobs[0] = { ...jobs[0], data: route.request().postDataJSON().data, updatedAt: `v${saves + 1}`, reviewStatus: route.request().postDataJSON().markReviewed ? 'reviewed' : 'pending' }
        return route.fulfill({ json: { job: jobs[0] } })
      }
      if (pathname === '/api/ocr/cmr/cmr-test' && method === 'DELETE') { jobs = []; return route.fulfill({ json: { deleted: true } }) }
      unexpected.push(`${method} ${pathname}`); return route.fulfill({ status: 400, json: { error: 'Unexpected test request' } })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(base + '/ocr/upload')
    await page.locator('.ocr-document-type select').waitFor({ timeout: 15000 }).catch(async error => {
      await page.screenshot({ path: 'work/cmr/upload-failure.png' })
      console.log({ errors, unexpected, body: await page.locator('body').innerText() })
      throw error
    })
    await page.locator('.ocr-document-type select').selectOption('cmr')
    assert.equal(await page.locator('input[capture="environment"]').isEnabled(), true)
    await page.locator('input[type=file][multiple]').setInputFiles({ name: 'cmr-test.png', mimeType: 'image/png', buffer: image })
    await page.getByRole('button', { name: 'Upload documents', exact: true }).click()
    await page.waitForURL('**/ocr/cmr-review?id=cmr-test')
    await page.getByLabel('Supplier (1)', { exact: true }).waitFor()
    assert.equal(uploads, 1)
    assert.equal(await page.getByRole('heading', { name: 'Sender and recipient', exact: true }).count(), 0)
    assert.equal(await page.locator('.cmr-source-heading h2').innerText(), 'cmr-test.png')
    assert.equal(await page.locator('.cmr-filename').count(), 0)
    assert.equal(await page.locator('.cmr-list-items strong').innerText(), 'cmr-test.png')
    assert.equal(await page.locator('.cmr-fields fieldset input').first().getAttribute('type'), 'date')
    assert.equal(await page.getByLabel('Driver', { exact: true }).inputValue(), '')
    assert.equal(await page.getByLabel('Truck number', { exact: true }).inputValue(), '')
    await page.getByLabel('Supplier (1)', { exact: true }).fill('Example supplier')
    const sourceWidth = (await page.locator('.cmr-source').boundingBox()).width
    await page.getByRole('button', { name: 'Collapse documents', exact: true }).click()
    assert.equal(await page.getByLabel('Search CMR', { exact: true }).isVisible(), false)
    assert.equal(await page.getByRole('button', { name: 'Show documents', exact: true }).getAttribute('aria-expanded'), 'false')
    if (width > 1100) assert.ok((await page.locator('.cmr-source').boundingBox()).width > sourceWidth)
    assert.equal(await page.getByLabel('Supplier (1)', { exact: true }).inputValue(), 'Example supplier')
    await page.screenshot({ path: `work/cmr/collapsed-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    await page.getByRole('button', { name: 'Show documents', exact: true }).click()
    assert.equal(await page.getByLabel('Search CMR', { exact: true }).isVisible(), true)
    assert.equal(await page.getByLabel('Supplier (1)', { exact: true }).inputValue(), 'Example supplier')
    assert.equal(await page.getByRole('button', { name: 'Confirm match', exact: true }).isEnabled(), false)
    await page.getByLabel('Transport', { exact: true }).fill('CJ 34 GDG')
    await page.getByLabel('Driver', { exact: true }).fill('Vlad')
    await page.getByLabel('Truck number', { exact: true }).fill('B 99 CMR')
    await page.getByLabel('Document quantity', { exact: true }).fill('1600,5')
    await page.getByLabel('Reception date', { exact: true }).fill('2026-10-16')
    await page.getByText('2 trucks from Other receptions on this date.', { exact: true }).waitFor()
    assert.deepEqual(await page.locator('#cmr-truck-options option').evaluateAll(options => options.map(option => option.value)), ['B 99 CMR', 'CJ 34 GDG'])
    assert.equal(await page.getByLabel('Truck number', { exact: true }).getAttribute('list'), 'cmr-truck-options')
    assert.equal(await page.getByLabel('Driver', { exact: true }).getAttribute('list'), 'cmr-driver-options')
    assert.deepEqual(await page.locator('#cmr-driver-options option').evaluateAll(options => options.map(option => option.value)), ['Miron', 'Vlad'])
    await page.getByLabel('Reception date', { exact: true }).fill('2026-10-15')
    await page.getByText('No trucks from Other receptions on this date.', { exact: true }).waitFor()
    assert.equal(await page.locator('#cmr-truck-options option').count(), 0)
    assert.equal(await page.locator('#cmr-driver-options option').count(), 0)
    assert.equal(await page.getByLabel('Driver', { exact: true }).inputValue(), 'Vlad')
    assert.equal(await page.getByLabel('Truck number', { exact: true }).inputValue(), 'B 99 CMR')
    await page.getByLabel('Reception date', { exact: true }).fill('2026-10-16')
    await page.getByText('2 trucks from Other receptions on this date.', { exact: true }).waitFor()
    await page.getByLabel('Aviz number', { exact: true }).fill('00123')
    const extraFields = { 'Recipient (2)': 'Recipient company', 'Delivery location': 'Delivery town', 'Planned delivery date': '2026-10-17',
      'Loading location': 'Loading town', 'Loading date': '2026-10-14', 'Aviz date': '2026-10-15', 'CMR issue date (22)': '2026-10-15', 'Goods receipt date (25)': '2026-10-16' }
    for (const [label, value] of Object.entries(extraFields)) await page.getByLabel(label, { exact: true }).fill(value)
    await page.getByRole('combobox', { name: /^Milk type/ }).selectOption('MILK-COW')
    await page.getByRole('combobox', { name: /^Unit/ }).selectOption('L')
    await page.locator('.cmr-list-items button').click()
    assert.equal(await page.getByLabel('Supplier (1)', { exact: true }).inputValue(), 'Example supplier', 'Reselecting the same document must not discard edits')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByText('Autosaved', { exact: true }).waitFor()
    assert.equal(jobs[0].data.quantity, 1600.5); assert.equal(jobs[0].data.quantityUnit, 'L'); assert.equal(jobs[0].data.kilos, null); assert.equal(jobs[0].data.avizNumber, '00123')
    assert.equal(await page.locator('.cmr-list-items strong').innerText(), 'Example supplier · 00123')
    assert.equal(await page.locator('.cmr-list-items button > span').innerText(), '1,600.5 L')
    assert.equal(jobs[0].data.driver, 'Vlad')
    assert.equal(jobs[0].data.date, '2026-10-16')
    assert.equal(jobs[0].data.truckNumber, 'B 99 CMR')
    await page.getByRole('combobox', { name: /^Reception - same date and truck/ }).waitFor().catch(async error => {
      console.log({ matching: await page.locator('.cmr-reception-match').innerText(), errors, unexpected })
      throw error
    })
    failMatch = true
    await page.getByRole('button', { name: 'Confirm match', exact: true }).click()
    await page.getByText('The reception changed. Refresh the candidates before confirming.', { exact: true }).waitFor()
    assert.equal(matchWrites, 0)
    failMatch = false
    await page.getByRole('button', { name: 'Refresh reception matches', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm match', exact: true }).click()
    await page.getByText('Reception linked', { exact: true }).waitFor()
    assert.equal(matchWrites, 1)
    await page.getByRole('region', { name: 'Others reception', exact: true }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `work/cmr/matching-${width}.png`, fullPage: true })
    await page.reload()
    await page.getByLabel('Supplier (1)', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Supplier (1)', { exact: true }).inputValue(), 'Example supplier')
    assert.equal(await page.getByLabel('Driver', { exact: true }).inputValue(), 'Vlad')
    assert.equal(await page.getByLabel('Reception date', { exact: true }).inputValue(), '2026-10-16')
    assert.equal(await page.getByLabel('Truck number', { exact: true }).inputValue(), 'B 99 CMR')
    for (const [label, value] of Object.entries(extraFields)) assert.equal(await page.getByLabel(label, { exact: true }).inputValue(), value)
    assert.equal(await page.getByRole('combobox', { name: /^Milk type/ }).inputValue(), 'MILK-COW')
    assert.equal(await page.getByRole('combobox', { name: /^Unit/ }).inputValue(), 'L')
    await page.getByText('Reception linked', { exact: true }).waitFor()
    link.status = 'NEEDS_REVIEW'
    await page.getByRole('button', { name: 'Refresh reception matches', exact: true }).click()
    await page.getByText('Link needs review', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Confirm match', exact: true }).click()
    await page.getByText('Reception linked', { exact: true }).waitFor()
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Remove reception link', exact: true }).click()
    await page.getByText('No reception linked', { exact: true }).waitFor()
    assert.equal(matchWrites, 3)
    const modernData = jobs[0].data
    jobs[0].data = { documentType: 'cmr', supplier: 'Legacy supplier', transport: '', driver: '', truckNumber: '', kilos: 1250.5, date: '2026-10-16', avizNumber: '0001' }
    await page.reload()
    await page.getByLabel('Supplier (1)', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Document quantity', { exact: true }).inputValue(), '1250.5')
    assert.equal(await page.locator('.cmr-list-items strong').innerText(), 'Legacy supplier · 0001')
    assert.equal(await page.locator('.cmr-list-items button > span').innerText(), '1,250.5 kg')
    assert.equal(await page.getByRole('combobox', { name: /^Unit/ }).inputValue(), 'kg')
    assert.equal(await page.getByLabel('Planned delivery date', { exact: true }).inputValue(), '')
    jobs[0].data = { ...modernData, quantity: 0 }
    await page.reload()
    await page.getByLabel('Supplier (1)', { exact: true }).waitFor()
    assert.equal(await page.locator('.cmr-list-items button > span').innerText(), '0 L')
    jobs[0].data = modernData
    await page.reload()
    await page.getByLabel('Supplier (1)', { exact: true }).waitFor()
    // Native date editing can pause between segments: do not save or disable it mid-edit.
    for (const label of ['Reception date', 'Planned delivery date', 'Loading date', 'Aviz date', 'CMR issue date (22)', 'Goods receipt date (25)']) {
      const input = page.getByLabel(label, { exact: true })
      const before = saves
      await input.focus()
      await input.fill('2026-10-18')
      await page.waitForTimeout(1200)
      assert.equal(saves, before, `${label} must wait until the user leaves the date field`)
      assert.equal(await input.isEnabled(), true)
      assert.equal(await input.inputValue(), '2026-10-18')
      await input.blur()
      await page.getByText('Autosaved', { exact: true }).waitFor()
    }
    let releaseSave
    saveGate = new Promise(resolve => { releaseSave = resolve })
    const pendingSave = page.waitForRequest(request => request.method() === 'PATCH')
    await page.getByLabel('Supplier (1)', { exact: true }).fill('Slow save supplier')
    await pendingSave
    const dateInput = page.getByLabel('Reception date', { exact: true })
    assert.equal(await dateInput.isEnabled(), true)
    await dateInput.fill('2026-10-17')
    saveGate = null
    releaseSave()
    await page.getByText('Unsaved changes', { exact: true }).waitFor()
    assert.equal(await dateInput.inputValue(), '2026-10-17', 'Older save response must not revert a newer date')
    await dateInput.blur()
    await page.getByText('Autosaved', { exact: true }).waitFor()
    assert.equal(jobs[0].data.date, '2026-10-17')
    await page.reload()
    await page.getByLabel('Supplier (1)', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Reception date', { exact: true }).inputValue(), '2026-10-17')
    await page.getByLabel('Search CMR', { exact: true }).fill('b 99 cmr')
    assert.equal(await page.locator('.cmr-list-items button').count(), 1)
    await page.getByLabel('Search CMR', { exact: true }).fill('vlad')
    assert.equal(await page.locator('.cmr-list-items button').count(), 1)
    await page.getByLabel('Search CMR', { exact: true }).fill('')
    await page.waitForFunction(() => document.querySelector('.cmr-image-stage img')?.naturalWidth > 0)
    await page.getByRole('button', { name: 'Rotate image', exact: true }).click()
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    assert.ok((await page.locator('.cmr-image-stage img').getAttribute('style')).includes('90deg'))
    await page.getByRole('button', { name: 'Fit image', exact: true }).click()
    await page.screenshot({ path: `work/cmr/manual-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1), false)
    await page.getByLabel('Document quantity', { exact: true }).fill('-1')
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    const previousSaves = saves
    await page.getByRole('alert').waitFor(); assert.equal(saves, previousSaves)
    await page.getByLabel('Document quantity', { exact: true }).fill('1700')
    failSave = true
    await page.getByRole('button', { name: 'Save changes', exact: true }).click()
    await page.getByText('Test save failure', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Document quantity', { exact: true }).inputValue(), '1700')
    failSave = false
    page.once('dialog', dialog => dialog.dismiss())
    await page.getByRole('button', { name: 'Reload documents', exact: true }).click()
    assert.equal(await page.getByLabel('Document quantity', { exact: true }).inputValue(), '1700')
    page.once('dialog', dialog => dialog.accept())
    await page.getByRole('button', { name: 'Delete CMR document', exact: true }).click()
    await page.getByText('No document selected', { exact: true }).waitFor()
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, [])
    console.log(`PASS CMR ${width}: upload, manual fields, save/reload, no OCR, image, validation, failed save, unsaved warning, delete`)
    await context.close()
  }
} finally { await browser.close() }
