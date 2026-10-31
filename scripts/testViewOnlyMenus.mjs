import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { APP_PERMISSIONS } from '../server/appSecurityStore.js'
import { defaultMilkDensitySettings } from '../server/milkDensitySettingsStore.js'
import { emptyCmrData } from '../server/cmrDocument.js'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
const image = await readFile('test-documents/romanian-monthly-settlement-ocr-test.png')
const month = '2026-10', date = '2026-10-31'
const pricing = { id: 'p1', month, center: 'Test center', producer: 'Test producer', producerCode: 'p000001', milkType: 'MILK-COW', liters: 100, price: 1.5, commission: 0, electricity: 0, readyForPricing: true, pricingStatus: 'saved', source: 'journal', reconciliationStatus: 'ok', sourceRowCount: 1 }
const reception = { receptionId: 'r1', receptionDate: date, vehicleCategory: 'OTHER', vehicleRegistration: 'TEST', driverName: 'Test driver', milkType: 'MILK-COW', fullWeightKg: 20000, emptyWeightKg: 10000, netQuantityKg: 10000, calculatedLiters: 9708.738, qualityDetails: [], routeId: '', updatedAt: 'v1' }
const cmr = { id: 'cmr1', sourceFile: 'CMR.png', mimeType: 'image/png', fileUrl: '/api/ocr/jobs/cmr1/file', status: 'completed', reviewStatus: 'pending', updatedAt: 'v1', data: { ...emptyCmrData(), date, supplier: 'Test supplier', truckNumber: 'TEST', quantity: 4900, quantityUnit: 'L', milkType: 'MILK-COW', receiptDate: date, issueDate: date, avizNumber: '123' } }
const daily = { id: 'daily1', sourceFile: 'Daily.png', mimeType: 'image/png', fileUrl: '/api/ocr/jobs/daily1/file', status: 'completed', reviewStatus: 'pending', documentCategory: 'daily_routes', createdAt: `${date}T10:00:00Z`, summary: { date, route: 'R01', rowCount: 1 }, data: { date, companyName: 'Test company', driverName: 'Test driver', vehicleRegistration: 'TEST', route: 'R01', totalLiters: 100, rawTranscription: '', warnings: [], rows: [{ rowNumber: 1, collectionCenter: 'Test center', milkType: 'MILK-COW', liters: 100, confidence: 1, uncertainFields: [] }] }, centerMatches: [] }
const monthly = { ...daily, id: 'monthly1', sourceFile: 'Monthly.png', documentCategory: 'journal_monthly_settlement', summary: { date, headerCenterName: 'Test center', rowCount: 1 }, data: { date, milkType: 'MILK-COW', headerCenterName: 'Test center', totalLiters: 100, rows: [{ rowNumber: 1, producer: 'Test producer', centerName: 'Test center', milkType: 'MILK-COW', liters: 100, confidence: 1, uncertainFields: [] }], warnings: [] }, producerMatches: [] }
const batch = { batchId: 'b1', month, exportNumber: 1, status: 'EXPORTED', createdAt: `${date}T10:00:00Z`, createdBy: 'test', paymentCount: 1, totalAmount: 150, currency: 'RON', lines: [] }
await mkdir('work/view-only', { recursive: true })
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: 'block' })
    const writes = [], errors = []
    let user = { username: 'viewer', permissions: APP_PERMISSIONS.map(item => item.key), writePermissions: [] }
    let roles = [{ roleKey: 'viewer', roleName: 'Viewer', description: '', permissionKeys: APP_PERMISSIONS.map(item => `${item.key}:view`) }]
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname
      if (url.origin !== base) return route.abort()
      if (!path.startsWith('/api/')) return route.continue()
      const json = body => route.fulfill({ json: body })
      if (path === '/api/auth/session') return json({ user })
      if (path === '/api/activity/page-open') return json({})
      if (path === '/api/web-users/roles' && request.method() === 'POST' && user.isAdmin) {
        const role = request.postDataJSON(); roles = [role]; writes.push(role)
        return json({ roles, role, users: [], permissions: APP_PERMISSIONS })
      }
      if (request.method() !== 'GET') {
        writes.push(`${request.method()} ${path}`)
        return route.fulfill({ status: 403, json: { error: 'View only' } })
      }
      if (path === '/api/web-users/admin-data') return json({ users: [{ userId: 'test', username: 'viewer', fullName: 'Viewer', isActive: true, isAdmin: false, roleKeys: ['viewer'] }], roles, permissions: APP_PERMISSIONS })
      if (path === '/api/month-closure/pricing-rows') return json({ rows: [pricing], selectedMonth: month, monthOptions: [month], journalProducers: [], receptionFactors: [] })
      if (path === '/api/month-closure/invoices') return json({ invoices: [], canResolve: false })
      if (path === '/api/ocr/reference-suppliers') return json({ producers: [{ producerCode: pricing.producerCode, producerName: pricing.producer, iban: 'RO123456789', vatStatusName: 'Is exempted', paymentTerms: '3030', centerName: pricing.center }], centers: [], fetchedAt: `${date}T12:00:00Z` })
      if (path === '/api/bank-exports') return json({ batches: [batch], payments: [] })
      if (path === '/api/bank-exports/b1') return json(batch)
      if (path === '/api/milk-deliveries') return json({ records: [{ id: 'd1', deliveryDate: '2020-01-01', truckNumber: 'TEST', tractorNumber: '', aviz: '1', milkType: 'MILK-COW', milkTypeLabel: 'Cow', densityFactor: 1.03, loadedWeightKg: 20000, emptyWeightKg: 10000, netQuantityKg: 10000, calculatedLiters: 9708.738, deliveryCategory: 'SALES', status: 'AWAITING_GREECE', greeceWeight: null, invoiceNumber: '', arrivalComments: '' }] })
      if (path === '/api/milk-receptions') return json({ records: [reception] })
      if (path === '/api/milk-factors') return json({ settings: defaultMilkDensitySettings, canEdit: false })
      if (path === '/api/ocr/cmr') return json({ jobs: [cmr] })
      if (path.endsWith('/reception-match')) return json({ documentVersion: 'v1', updatedAt: 'v1', link: null, linkedReception: null, candidates: [reception] })
      if (path.endsWith('/file')) return route.fulfill({ contentType: 'image/png', body: image })
      if (path === '/api/ocr/jobs') return json({ jobs: [url.searchParams.get('documentCategory') === 'journal_monthly_settlement' ? monthly : daily] })
      if (path === '/api/ocr/jobs/daily1') return json({ job: daily })
      if (path === '/api/ocr/jobs/monthly1') return json({ job: monthly })
      if (path === '/api/ocr/settings') return json({ settings: { provider: 'openai', model: 'test', providers: [{ id: 'openai', label: 'OpenAI', configured: true, models: ['test'] }] } })
      return json({ rows: [], jobs: [], records: [], centers: [], producers: [], drivers: [], vehicles: [], routes: [], trucks: [], messages: [], issues: [], approvals: [], counts: [], contracts: [], factors: [], activities: [], users: [], summary: {}, canEdit: false })
    })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(error.message))
    page.setDefaultTimeout(12000)
    await page.clock.setFixedTime(new Date('2026-10-31T12:00:00Z'))
    const go = async path => { await page.goto(base + path); await page.locator('.ocr-view-only').waitFor() }
    const disabled = async locator => { await locator.waitFor(); assert.equal(await locator.isDisabled(), true, await locator.getAttribute('aria-label') || await locator.textContent()) }

    await go('/web-users')
    await page.getByRole('button', { name: /Viewer viewer.*permissions/ }).click()
    assert.equal(await page.locator('.web-users-permission-grid select').count(), APP_PERMISSIONS.length)
    for (const select of await page.locator('.web-users-permission-grid select').all()) { await disabled(select); assert.equal(await select.inputValue(), 'view') }
    await disabled(page.getByRole('button', { name: 'Save Web role', exact: true }))

    await go(`/month-closure?month=${month}`)
    await page.getByRole('cell', { name: /Test producer/ }).waitFor()
    for (const input of await page.locator('.month-closure-table tbody input').all()) await disabled(input)
    await disabled(page.getByRole('button', { name: 'Add collector', exact: true }))
    await page.getByRole('button', { name: 'ERP invoices', exact: true }).click()
    await disabled(page.getByLabel('Invoice date for Test producer', { exact: true }))
    await page.getByPlaceholder('Producer name...').fill('No match')
    await page.getByText('No invoice rows found for this view.').waitFor()

    const allMenusViewer = user
    user = { username: 'bank viewer', permissions: ['bank_note'], writePermissions: [] }
    await go(`/bank-note?month=${month}`)
    await disabled(page.getByLabel('Connected account for Test producer'))
    await disabled(page.getByLabel('Select all eligible bank rows on this page'))
    await page.getByRole('button', { name: 'Export history', exact: true }).click()
    await page.getByRole('button', { name: 'Export 1', exact: true }).click()
    await disabled(page.getByRole('button', { name: 'Original file', exact: true }))
    await page.getByLabel('Search', { exact: true }).fill('Test')
    await page.screenshot({ path: `work/view-only/bank-history-${width}.png` })

    await page.goto(base + '/month-closure')
    await page.getByRole('heading', { name: 'No access', exact: true }).waitFor()
    user = { username: 'closure editor', permissions: ['month_closure'], writePermissions: ['month_closure'] }
    await page.goto(base + '/bank-note')
    await page.getByRole('heading', { name: 'No access', exact: true }).waitFor()
    await page.goto(base + `/month-closure?month=${month}`)
    await page.getByRole('cell', { name: /Test producer/ }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Bank note', exact: true }).count(), 0)

    user = { username: 'mixed', permissions: ['month_closure', 'bank_note'], writePermissions: ['month_closure'] }
    await go(`/bank-note?month=${month}`)
    await disabled(page.getByLabel('Connected account for Test producer'))
    user = { ...user, writePermissions: ['bank_note'] }
    await page.goto(base + `/bank-note?month=${month}`)
    await page.getByLabel('Connected account for Test producer').waitFor()
    assert.equal(await page.getByLabel('Connected account for Test producer').isEnabled(), true)
    await go(`/month-closure?month=${month}`)
    await disabled(page.getByRole('button', { name: 'Add collector', exact: true }))
    user = allMenusViewer

    await go('/milk-deliveries')
    await page.getByRole('button', { name: 'Show all dates', exact: true }).click()
    await disabled(page.locator('.delivery-register-row').getByLabel('Delivery date', { exact: true }))
    await disabled(page.getByRole('button', { name: 'Add delivery', exact: true }))
    await page.getByRole('button', { name: 'Expand delivery', exact: true }).click()
    await disabled(page.getByLabel('Weight from Greece *', { exact: true }))
    await disabled(page.getByPlaceholder('Invoice number', { exact: true }))
    await disabled(page.getByRole('textbox', { name: 'Comments / destination' }))

    await go('/milk-reception')
    await disabled(page.locator('tbody input[aria-label="Reception date"]'))
    await disabled(page.getByRole('button', { name: 'Add reception row', exact: true }))
    await page.getByRole('button', { name: 'Expand row', exact: true }).click()

    await go('/ocr/cmr-review?id=cmr1')
    await disabled(page.getByLabel('Supplier (1)', { exact: true }))
    await disabled(page.getByRole('button', { name: 'Save changes', exact: true }))
    await disabled(page.getByRole('button', { name: 'Run OCR', exact: true }))
    await disabled(page.getByRole('button', { name: 'Mark as reviewed', exact: true }))
    await disabled(page.getByRole('button', { name: 'Confirm match', exact: true }))
    assert.equal(await page.getByRole('button', { name: 'Refresh reception matches', exact: true }).isEnabled(), true)
    await page.getByRole('button', { name: 'Rotate image', exact: true }).click()
    await page.screenshot({ path: `work/view-only/cmr-${width}.png` })

    await go('/ocr/review')
    await page.locator('.review-job-open').first().click()
    await disabled(page.locator('.review-manual-save'))
    await disabled(page.getByLabel('Company', { exact: true }))
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await page.getByRole('tab', { name: /centers/i }).click()
    await disabled(page.locator('.review-add-row-inline'))

    await go('/ocr/monthly-review')
    await page.locator('.monthly-list-card').first().click()
    await disabled(page.getByLabel('Header center', { exact: true }))
    for (const input of await page.locator('.monthly-form input, .monthly-form select').all()) await disabled(input)

    await go('/ocr/settings')
    await disabled(page.getByRole('button', { name: 'Save OCR model', exact: true }))
    await go('/ocr/upload')
    for (const input of await page.locator('input[type=file]').all()) assert.equal(await input.isDisabled(), true)
    await go('/ocr/exports/apia')
    await disabled(page.getByRole('button', { name: /Export Excel/ }))
    await go('/ocr/exports/veterinary')
    await disabled(page.getByRole('button', { name: /Export Excel/ }))
    await page.waitForTimeout(1100)
    assert.deepEqual(writes, [], 'View-only browsing must not start mutations or autosave')
    assert.deepEqual(errors, [])

    // Real role-editor interaction with a mocked save, not a production role change.
    user = { username: 'admin', isAdmin: true }
    await page.goto(base + '/web-users')
    await page.getByRole('button', { name: /Viewer viewer.*permissions/ }).click()
    const grant = page.getByLabel('Month closure and payments', { exact: true })
    await grant.selectOption('edit')
    await page.getByRole('button', { name: 'Save Web role', exact: true }).click()
    await page.getByText('Web role saved.', { exact: true }).waitFor()
    assert.ok(writes.at(-1).permissionKeys.includes('month_closure'))
    assert.ok(!writes.at(-1).permissionKeys.includes('month_closure:view'))
    assert.ok(writes.at(-1).permissionKeys.includes('bank_note:view'))
    const bankGrant = page.getByLabel('Bank note', { exact: true })
    await bankGrant.selectOption('edit')
    await grant.selectOption('none')
    await page.getByRole('button', { name: 'Save Web role', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.web-users-save:last-child')?.textContent !== 'Saving...')
    assert.ok(writes.at(-1).permissionKeys.includes('bank_note'))
    assert.ok(!writes.at(-1).permissionKeys.some(key => key.startsWith('month_closure')))
    await page.screenshot({ path: `work/view-only/roles-${width}.png`, fullPage: true })
    assert.equal(await page.locator('.web-users-permission-grid').evaluate(el => el.scrollWidth <= el.clientWidth), true)
    console.log(`PASS ${width}: view-only controls, editable filters, OCR without autosave, role levels`)
    await context.close()
  }
} finally { await browser.close() }
