/* global document, innerWidth, innerHeight */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/ocr-upload-guide', { recursive: true })

try {
  for (const viewport of [{ width: 1365, height: 900 }, { width: 900, height: 800 }, { width: 761, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
    if (process.env.GUIDE_TEST_WIDTH && viewport.width !== Number(process.env.GUIDE_TEST_WIDTH)) continue
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
    const page = await context.newPage()
    let uploads = 0
    let choosers = 0
    const errors = []
    const modules = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('filechooser', () => { choosers += 1 })
    page.on('request', request => modules.push(request.url()))
    await page.route('**/api/**', async route => {
      const url = new URL(route.request().url())
      if (!url.pathname.startsWith('/api/')) return route.continue()
      if (url.pathname === '/api/ocr/jobs' && route.request().method() === 'POST') {
        uploads += 1
        return route.fulfill({ json: { jobs: [{ id: 'test-job', sourceFile: 'guide-test.pdf', status: 'queued' }] } })
      }
      return route.fulfill({ json: { user: { username: 'test-only', isAdmin: true } } })
    })
    await page.goto(`${baseUrl}/ocr/upload`)
    await page.getByRole('button', { name: 'OCR step-by-step guide' }).waitFor()
    assert.equal(modules.some(url => /\/OcrUploadWalkthrough\./.test(url)), false, 'guide loads only on demand')

    for (const isRo of [false, true]) {
      if (isRo) await page.getByRole('button', { name: 'Romanian', exact: true }).click()
      const help = page.getByRole('button', { name: isRo ? 'Ghid OCR pas cu pas' : 'OCR step-by-step guide', exact: true })
      const header = await page.evaluate(() => {
        const elements = [...document.querySelectorAll('.ocr-header button, .ocr-header h1, .ocr-auth-session')]
        const rects = elements.map(el => ({ label: el.textContent || el.getAttribute('aria-label'), r: el.getBoundingClientRect() }))
        return {
          inside: rects.every(({ r }) => r.left >= 0 && r.right <= innerWidth),
          overlaps: rects.flatMap((a, i) => rects.slice(i + 1).filter(b => a.r.left < b.r.right && a.r.right > b.r.left && a.r.top < b.r.bottom && a.r.bottom > b.r.top).map(b => `${a.label} / ${b.label}`)),
        }
      })
      assert.equal(header.inside, true)
      assert.deepEqual(header.overlaps, [], `header overlap ${viewport.width}`)
      assert.equal(await page.locator('.ocr-header-actions > button').first().getAttribute('class'), 'ocr-help-button')
      assert.equal(await help.locator('svg > circle').evaluate(el => getComputedStyle(el).display), 'none', 'single outer circle')
      assert.equal(await help.locator('svg').getAttribute('class').then(value => value.includes('lucide-circle-question-mark')), true, 'question mark in both languages')
      // Romanian run also exercises a real queued file and selected document type.
      if (isRo) {
        await page.locator('.ocr-document-type select').selectOption('daily_routes')
        await page.locator('input[type=file][multiple]').setInputFiles({ name: 'guide-test.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test fixture') })
        await page.locator('.ocr-document-row').waitFor()
      }
      const categoryBefore = await page.locator('.ocr-document-type select').inputValue()
      const queueBefore = await page.locator('.ocr-queue').innerText()
      await help.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      for (let step = 0; step < 3; step += 1) {
        if (step === 1) {
          await dialog.getByRole('button', { name: isRo ? 'English' : 'Romanian', exact: true }).click()
          await dialog.getByRole('heading', { name: isRo ? 'Choose documents or take a photo' : 'Alegeți documente sau fotografiați' }).waitFor()
          await dialog.getByRole('button', { name: isRo ? 'Romanian' : 'English', exact: true }).click()
          await dialog.getByRole('heading', { name: isRo ? 'Alegeți documente sau fotografiați' : 'Choose documents or take a photo' }).waitFor()
          assert.equal(await dialog.locator('.ocr-language-switch').evaluate(el => el.getBoundingClientRect().height), 28, 'compact in-guide language toggle')
        }
        await page.waitForTimeout(180)
        const geometry = await page.evaluate(() => {
          const panel = document.querySelector('.sign-in-tour-panel').getBoundingClientRect()
          const ring = document.querySelector('.sign-in-tour-ring').getBoundingClientRect()
          return { inside: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight + 1,
            targetInside: ring.left >= 0 && ring.right <= innerWidth && ring.top >= 0 && ring.bottom <= innerHeight,
            overlap: panel.left < ring.right && panel.right > ring.left && panel.top < ring.bottom && panel.bottom > ring.top }
        })
        if (!geometry.inside || !geometry.targetInside || geometry.overlap) {
          await page.screenshot({ path: 'work/ocr-upload-guide/failure.png' })
          console.log(await page.evaluate(() => ({ panel: document.querySelector('.sign-in-tour-panel').getBoundingClientRect().toJSON(), target: document.querySelector('.sign-in-tour-ring').getBoundingClientRect().toJSON() })))
        }
        assert.equal(geometry.inside, true, `panel outside ${viewport.width}/${isRo}/${step}`)
        assert.equal(geometry.targetInside, true, `target outside ${viewport.width}/${isRo}/${step}`)
        assert.equal(geometry.overlap, false, `panel covers target ${viewport.width}/${isRo}/${step}`)
        const next = dialog.locator('.sign-in-tour-next')
        assert.equal(await next.isDisabled(), true)
        if (step === 0 || step === 2) await page.screenshot({ path: `work/ocr-upload-guide/${viewport.width}-${isRo ? 'ro' : 'en'}-${step + 1}.png` })
        if (step === 0) {
          assert.equal(await dialog.locator('.ocr-tour-type-options button').count(), 2)
          await dialog.locator('.ocr-tour-type-options button').first().click()
        } else {
          if (step === 1 || step === 2) {
            const panelBefore = await dialog.locator('.sign-in-tour-panel').boundingBox()
            const scrollBefore = await page.evaluate(() => window.scrollY)
            const targetSelector = step === 1 ? '.ocr-action-button.primary' : '.ocr-review-links button:last-child'
            await page.waitForFunction(selector => {
              const ring = document.querySelector('.sign-in-tour-ring').getBoundingClientRect()
              const target = document.querySelector(selector).getBoundingClientRect()
              return Math.abs(ring.left - target.left + 5) < 1 && Math.abs(ring.top - target.top + 5) < 1
            }, targetSelector, { timeout: 2600 }).catch(async error => {
              console.log({ width: viewport.width, isRo, step, geometry: await page.evaluate(selector => ({ ring: document.querySelector('.sign-in-tour-ring').getBoundingClientRect().toJSON(), target: document.querySelector(selector).getBoundingClientRect().toJSON() }), targetSelector) })
              await page.screenshot({ path: 'work/ocr-upload-guide/failure.png' })
              throw error
            })
            assert.deepEqual(await dialog.locator('.sign-in-tour-panel').boundingBox(), panelBefore, 'only the highlight moves, not the instruction box')
            assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, 'alternating highlights must not scroll the page')
            const pairGeometry = await page.evaluate(() => {
              const panel = document.querySelector('.sign-in-tour-panel').getBoundingClientRect()
              const ring = document.querySelector('.sign-in-tour-ring').getBoundingClientRect()
              return { inside: ring.top >= 0 && ring.bottom <= innerHeight && panel.top >= 0 && panel.bottom <= innerHeight,
                overlap: panel.left < ring.right && panel.right > ring.left && panel.top < ring.bottom && panel.bottom > ring.top }
            })
            assert.equal(pairGeometry.inside, true)
            assert.equal(pairGeometry.overlap, false)
            await page.screenshot({ path: `work/ocr-upload-guide/${viewport.width}-${isRo ? 'ro' : 'en'}-pair-${step}.png` })
          }
          await dialog.locator('.ocr-tour-practice').click()
        }
        assert.equal(await next.isDisabled(), false)
        await next.click()
      }
      await dialog.waitFor({ state: 'detached' })
      assert.equal(uploads, 0, 'practice cannot upload')
      assert.equal(choosers, 0, 'practice cannot open camera/file chooser')
      assert.equal(new URL(page.url()).pathname, '/ocr/upload', 'practice cannot navigate')
      assert.equal(await page.locator('.ocr-document-type select').inputValue(), categoryBefore)
      assert.equal(await page.locator('.ocr-queue').innerText(), queueBefore)
      assert.equal(await page.locator('#root').evaluate(el => el.inert), false)
      await help.click()
      await dialog.waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await dialog.locator('.ocr-tour-type-options button').first().evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      await dialog.locator('.sign-in-tour-next').click()
      await dialog.getByRole('button', { name: isRo ? 'Înapoi' : 'Back', exact: true }).click()
      await dialog.getByRole('heading', { name: isRo ? 'Alegeți tipul documentului' : 'Choose the document type' }).waitFor()
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await page.waitForTimeout(50)
      assert.equal(await help.evaluate(el => el === document.activeElement), true, 'restore focus')
      await help.click()
      await dialog.getByRole('button', { name: isRo ? 'Închide ghidul' : 'Close guide' }).click()
      await dialog.waitFor({ state: 'detached' })
    }
    // A normal upload still works, but the test endpoint never sends to the real server.
    await page.locator('.ocr-process-button').click()
    await page.locator('.ocr-upload-success').waitFor()
    assert.equal(uploads, 1)
    assert.deepEqual(errors, [])
    console.log(`PASS ${viewport.width}x${viewport.height}: EN/RO, open options, alternating highlights, three safe steps, keyboard, unchanged queue, upload restored`)
    await context.close()
  }
} finally {
  await browser.close()
}
