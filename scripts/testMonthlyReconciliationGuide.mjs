import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const base = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
const aviz = { id: 'aviz', jobId: 'job', sourceFile: 'test.png', fileUrl: '/test.png', documentDate: '2026-08-01', route: 'R01', vehicleRegistration: 'TEST', rowNumber: 1, noticeNumber: 'A001', liters: 100 }
const journal = { id: 'journal', jobId: 'journal-job', sourceFile: 'journal.png', fileUrl: '/journal.png', documentDate: '2026-08-31', producer: 'Test producer', liters: 100, producerWarning: 'No ERP match' }
const row = { id: 'r1', month: '2026-08', center: 'Test center', milkType: 'MILK-COW', avizLiters: 100, monthlyLiters: 100, differenceLiters: 0, differencePercent: 0, status: 'ok', avizLineCount: 1, monthlyRowCount: 1, avizRows: [aviz], monthlyRows: [journal] }
const single = { ...row, id: 'r2', center: 'Single producer', status: 'missing_monthly', monthlyRowCount: 0, monthlyRows: [], monthlyLiters: 0, avizPricing: { centerCode: 'c2', producerCode: 'p2', producerName: 'Test supplier', approvedLiters: 100, sourceFingerprint: 'test', linkedProducers: [{ producerCode: 'p2', producerName: 'Test supplier' }] } }
const approval = { approvalId: 'a1', monthKey: '2026-08', centerCode: 'c3', centerName: 'Approved center', producerName: 'Approved supplier', producerCode: 'p3', milkType: 'MILK-COW', approvedLiters: 100, status: 'APPROVED' }
await mkdir('work/monthly-guide', { recursive: true })
try {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    if (process.env.GUIDE_TEST_WIDTH && viewport.width !== Number(process.env.GUIDE_TEST_WIDTH)) continue
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const page = await context.newPage()
    const writes = [], errors = []
    let empty = false
    page.on('pageerror', e => errors.push(e.message))
    await context.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (!['GET', 'HEAD'].includes(route.request().method()) && path !== '/api/activity/page-open') writes.push(path)
      if (path === '/api/auth/session') return route.fulfill({ json: { user: { username: 'test', isAdmin: true } } })
      if (path === '/api/ocr/monthly-reconciliation/rows') return route.fulfill({ json: { rows: empty ? [] : [row, single, { ...row, id: 'r3', center: 'Difference center', status: 'difference', monthlyLiters: 125, differenceLiters: 25 }], canApproveAviz: !empty, avizApprovals: empty ? [] : [approval] } })
      if (path === '/api/monthly-reconciliation/reference-centers') return route.fulfill({ json: { centers: [{ name: 'New center', code: 'c4' }] } })
      return route.fulfill({ json: { issues: [], summary: {} } })
    })
    for (const ro of [false, true]) {
      await page.goto(`${base}/monthly-reconciliation?month=2026-08`)
      if (ro) await page.getByRole('button', { name: 'Romanian', exact: true }).click()
      const help = page.locator('.monthly-recon-help-button')
      await page.locator('.monthly-recon-row').first().waitFor()
      assert.equal(await page.locator('.monthly-recon-actions').getByRole('button').count(), 3)
      assert.equal(await page.locator('.monthly-recon-refresh-button').textContent(), '')
      await help.click()
      const tour = page.locator('.review-walkthrough')
      await page.locator('.monthly-recon-example-banner').waitFor()
      assert.equal(await page.locator('.monthly-recon-row').count(), 5)
      for (let step = 0; step < 9; step++) {
        await tour.locator('header > span').filter({ hasText: `${step + 1}/9` }).waitFor()
        if (step === 0) {
          assert.equal(await tour.locator('input').count(), 0, 'month field exists only on the page')
          await page.locator('.monthly-recon-toolbar input[type="month"]').click({ position: { x: 20, y: 15 } })
          await page.locator('.monthly-recon-toolbar input[type="month"]').fill('2026-07')
          assert.equal(await page.locator('.monthly-recon-row').count(), 5)
          await page.locator('.monthly-recon-toolbar input[type="month"]').fill('2026-08')
          assert.equal(await page.locator('.monthly-recon-row').count(), 5)
        }
        assert.equal(await tour.locator('.review-guide-note').count(), 0, 'every step omits the safety sentence')
        for (const button of await tour.locator('footer > button').all()) {
          const size = await button.boundingBox()
          assert.equal(size.width, 32, 'discreet guide navigation width')
          assert.equal(size.height, 32, 'discreet guide navigation height')
          assert.equal(await button.innerText(), '', 'icon-only guide navigation')
          assert.ok(await button.getAttribute('aria-label'))
          assert.ok(await button.getAttribute('title'))
        }
        if (step >= 1 && step <= 2) {
          assert.equal(await tour.locator('.sign-in-tour-shade').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'table remains undimmed')
          assert.equal(await page.evaluate(() => document.getElementById('root').inert), true)
        }
        const practice = tour.locator('.ocr-tour-practice')
        await tour.locator('.sign-in-tour-ring').waitFor()
        if (step === 5) assert.equal(await tour.locator('.sign-in-tour-next').isEnabled(), true, 'bulk change explanation needs no practice click')
        if (step === 8) {
          assert.equal(await page.locator('.monthly-recon-approvals-toggle').getAttribute('aria-expanded'), 'true', 'approvals automatically expanded')
          assert.equal(await page.locator('.monthly-aviz-approval').count(), 1)
          assert.equal(await tour.locator('.sign-in-tour-panel').count(), 1, 'one instruction window')
          assert.equal(await tour.locator('.sign-in-tour-next').isEnabled(), true, 'approval list needs no practice click')
        }
        if (await practice.count()) await practice.click()
        if (step === 6) {
          await tour.getByRole('button', { name: ro ? 'Înapoi' : 'Back', exact: true }).click()
          await tour.locator('header > span').filter({ hasText: '6/9' }).waitFor()
          assert.equal(await page.locator('.monthly-recon-modal').count(), 0)
          await tour.locator('.ocr-tour-practice').click()
          assert.equal(await page.locator('.monthly-recon-modal').count(), 0, 'highlight click does not open a correction dialog')
          await tour.locator('.sign-in-tour-next').click()
          await tour.locator('header > span').filter({ hasText: '7/9' }).waitFor()
          assert.equal(await page.locator('.monthly-recon-modal').count(), 0, 'next step leaves correction dialog closed')
          await tour.locator('.ocr-tour-practice').click()
        }
        await page.waitForTimeout(70)
        if (step === 1 || step === 2) {
          const descriptions = ro
            ? ['Avizele corespund jurnalelor', 'Jurnalul lunar nu a fost încă primit.']
            : ['Aviz matches journals', 'The monthly journal has not been received yet.']
          assert.equal(await tour.locator('.sign-in-tour-action p').innerText(), descriptions[step - 1])
          const pair = step === 1 ? ['demo-ok', 'demo-warning'] : ['demo-single', 'demo-difference']
          const ring = await tour.locator('.sign-in-tour-ring').boundingBox()
          for (const id of pair) {
            const bounds = await page.locator(`[data-guide-row="${id}"]`).boundingBox()
            assert.ok(bounds.y >= ring.y && bounds.y + bounds.height <= ring.y + ring.height + 1, `both example rows highlighted: ${id}`)
            assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, `both example rows on screen: ${id}`)
          }
          assert.equal(await page.locator('.monthly-recon-guide-case').getAttribute('data-guide-row'), pair[0])
          assert.equal(await page.locator('.review-guide-secondary-target').getAttribute('data-guide-row'), pair[1])
          assert.equal(await tour.locator('.review-guide-compact, [role="status"]').count(), 0)
        }
        if (step === 2) {
          const difference = page.locator('[data-guide-row="demo-difference"] .monthly-recon-diff-liters')
          assert.equal(await difference.innerText(), '30')
          assert.equal(await difference.evaluate(el => getComputedStyle(el).fontSize), '16px')
          for (const element of [difference, page.locator('th.monthly-recon-diff-liters')]) {
            assert.notEqual(await element.evaluate(el => getComputedStyle(el).boxShadow), 'none', 'difference value and heading stand out')
          }
        }
        const geometry = await tour.evaluate(el => {
          const p = el.querySelector('.sign-in-tour-panel').getBoundingClientRect()
          const r = el.querySelector('.sign-in-tour-ring')?.getBoundingClientRect()
          return { inside: p.left >= 0 && p.right <= innerWidth + 1 && p.top >= 0 && p.bottom <= innerHeight + 1,
            overlaps: r && p.left < r.right && p.right > r.left && p.top < r.bottom && p.bottom > r.top }
        })
        assert.equal(geometry.inside, true, `panel outside ${viewport.width}/${step}`)
        assert.ok(!geometry.overlaps, `overlap ${viewport.width}/${step}`)
        if (step === 1) {
          const bounds = await page.locator('[data-guide-row="demo-warning"]').boundingBox()
          const guideBounds = await tour.locator('.sign-in-tour-panel').first().boundingBox()
          assert.ok(guideBounds.y >= bounds.y + bounds.height || guideBounds.y + guideBounds.height <= bounds.y, 'warning row totals remain visible')
          if (viewport.width === 1365) assert.ok(guideBounds.y >= bounds.y + bounds.height, 'desktop callout appears below the warning row')
        }
        assert.equal(await page.locator('.monthly-recon-modal').count(), 0, 'guide stays on the page without opening dialogs')
        if (step === 6) {
          assert.equal(await tour.locator('.monthly-guide-journal-cases').count(), 0, 'combined step keeps only the original instruction')
          assert.equal(await tour.locator('.sign-in-tour-action p').innerText(), ro ? 'Apăsați Journals lângă Monthly journals Vs Aviz pentru a vedea centrele cu jurnale primite în luna selectată, inclusiv cele fără aviz corespondent.' : 'Press Journals beside Monthly journals Vs Aviz to see the journal centers received for the selected month, including those without a matching aviz.')
          assert.equal(await page.locator('.monthly-recon-journals-toggle').getAttribute('aria-expanded'), 'true', 'journal examples open automatically')
          assert.equal(await tour.locator('.sign-in-tour-next').isEnabled(), true)
          assert.ok(await page.locator('.monthly-recon-journal-centers li:not(.has-difference):not(.missing-aviz)').count())
          assert.equal(await page.locator('.monthly-recon-journal-centers li.has-difference').count(), 1)
          assert.equal(await page.locator('.monthly-recon-journal-centers li.missing-aviz').count(), 1)
        }
        if (step === 7) {
          assert.equal(await page.locator('[data-guide-row="demo-single"] .monthly-recon-producer-count button').getAttribute('aria-expanded'), 'true')
          assert.equal(await tour.locator('.sign-in-tour-next').isEnabled(), true)
          for (const selector of ['.monthly-recon-producers', '.monthly-aviz-pricing-button']) {
            assert.equal(await page.locator(`.monthly-recon-guide-pricing ${selector}`).evaluate(el => getComputedStyle(el).outlineStyle), 'solid')
          }
          const rowBounds = await page.locator('[data-guide-row="demo-single"]').boundingBox()
          const panelBounds = await tour.locator('.sign-in-tour-panel').first().boundingBox()
          assert.ok(panelBounds.y >= rowBounds.y + rowBounds.height || panelBounds.y + panelBounds.height <= rowBounds.y, 'producer row remains visible')
        }
        if (step === 3) {
          assert.equal(await page.locator('[data-guide-row="demo-difference"] .monthly-recon-diff-liters').evaluate(el => getComputedStyle(el).boxShadow), 'none', 'difference emphasis is limited to its guide step')
          assert.equal(await page.locator('.monthly-recon-guide-case, .review-guide-secondary-target').count(), 0, 'paired row highlights are removed')
          assert.equal(await page.locator('.monthly-recon-guide-details .monthly-recon-detail-panel').count(), 2)
          assert.equal(await page.locator('.monthly-recon-guide-details .monthly-recon-producer-warning').evaluate(el => getComputedStyle(el).outlineStyle), 'solid')
          assert.equal(await tour.locator('.sign-in-tour-shade').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
        }
        if (step === 4) {
          for (const selector of ['.monthly-recon-file-actions button:first-child', '.monthly-recon-journal-detail-table td:last-child button', '.monthly-recon-row-edit']) {
            const button = page.locator(`.monthly-recon-guide-actions ${selector}`).first()
            assert.equal(await button.evaluate(el => getComputedStyle(el).outlineStyle), 'solid')
            assert.equal(await button.isVisible(), true)
          }
        }
        if ([1, 2, 4, 7].includes(step)) {
          const extra = tour.locator('.review-guide-companion')
          assert.equal(await extra.isVisible(), viewport.width >= 760)
          if (viewport.width >= 760) {
            const a = await tour.locator('.sign-in-tour-panel').first().boundingBox()
            const b = await extra.boundingBox()
            const r = await tour.locator('.sign-in-tour-ring').boundingBox()
            assert.ok(b.x >= a.x + a.width && b.x + b.width <= viewport.width && b.y >= 0 && b.y + b.height <= viewport.height, 'two separate visible callouts')
            assert.ok(b.y >= r.y + r.height || b.y + b.height <= r.y, 'second callout does not cover the lists')
          }
        }
        if (step === 5) {
          assert.equal(await page.locator('.monthly-recon-modal').count(), 0, 'bulk change step only highlights the button')
          assert.equal(await page.locator('.monthly-recon-guide-actions').count(), 0, 'action highlights are removed on the next step')
          assert.equal(await tour.locator('.sign-in-tour-action p').innerText(), ro ? 'Apăsați Change aviz center pentru a muta întreaga listă de avize la alt centru.' : 'Press Change aviz center to change the entire aviz list to another center.')
        }
        if (step === 8) assert.equal(await page.locator('.monthly-recon-guide-pricing').count(), 0, 'pricing highlights are removed after the combined step')
        await page.screenshot({ path: `work/monthly-guide/${viewport.width}-${ro ? 'ro' : 'en'}-${step}.png` })
        await tour.locator('.sign-in-tour-next').click()
      }
      await tour.waitFor({ state: 'detached' })
      assert.equal(await page.locator('.monthly-recon-modal').count(), 0)
      assert.equal(await page.locator('.monthly-recon-detail-grid').count(), 0)
      assert.equal(await page.locator('.monthly-recon-journal-centers').count(), 0)
      assert.equal(await page.locator('.monthly-aviz-approvals').count(), 0)
      assert.equal(await page.locator('.monthly-recon-example-banner').count(), 0)
      assert.equal(await page.locator('.monthly-recon-row').count(), 3, 'real records restored')
      assert.doesNotMatch(await page.locator('.monthly-recon-table').innerText(), /Example -/)
      assert.equal(await page.evaluate(() => document.getElementById('root').inert), false)
    }
    empty = true
    await page.reload()
    await page.locator('.monthly-recon-help-button').click()
    const tour = page.locator('.review-walkthrough')
    for (let step = 0; step < 9; step++) {
      await tour.locator('header > span').filter({ hasText: `${step + 1}/9` }).waitFor()
      await tour.locator('.sign-in-tour-ring').waitFor()
      if (await tour.locator('.ocr-tour-practice').count()) await tour.locator('.ocr-tour-practice').click()
      await tour.locator('.sign-in-tour-next').click()
    }
    await tour.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.monthly-recon-row').count(), 0, 'empty live list restored')
    await page.locator('.monthly-recon-toolbar input[type="month"]').fill('2026-07')
    await page.locator('.monthly-recon-toolbar input[placeholder="Collection center..."]').fill('original filter')
    await page.locator('.monthly-recon-help-button').click()
    await tour.waitFor()
    await page.locator('.monthly-recon-toolbar input[type="month"]').fill('2026-08')
    assert.equal(await page.locator('.monthly-recon-row').count(), 5)
    await page.keyboard.press('Escape')
    await tour.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.monthly-recon-toolbar input[type="month"]').inputValue(), '2026-07')
    assert.equal(await page.locator('.monthly-recon-toolbar input[placeholder="Collection center..."]').inputValue(), 'original filter')
    assert.equal(await page.locator('.monthly-recon-example-banner').count(), 0)
    assert.deepEqual(writes, [], 'guide never saves corrections or approvals')
    assert.deepEqual(errors, [])
    assert.equal(context.pages().length, 1, 'guide never opens source documents')
    console.log(`PASS ${viewport.width}: 9 steps EN/RO, combined journal instruction and examples, paired callouts, no dialogs or writes, geometry, empty list, restored state`)
    await context.close()
  }
} finally { await browser.close() }
