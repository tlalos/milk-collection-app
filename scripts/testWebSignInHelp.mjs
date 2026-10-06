/* global document, innerWidth, innerHeight */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'

// Use an installed Playwright package, or supply its module URL via PLAYWRIGHT_MODULE.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
await mkdir('work/sign-in-guide', { recursive: true })

try {
  for (const route of ['/month-closure', '/ocr']) {
    for (const viewport of [{ width: 1365, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
      const page = await context.newPage()
      let logins = 0
      const errors = []
      const modules = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('request', request => modules.push(request.url()))
      await page.route('**/api/**', async route => {
        if (!new URL(route.request().url()).pathname.startsWith('/api/')) return route.continue()
        if (route.request().url().endsWith('/api/auth/login')) {
          logins += 1
          return route.fulfill({ status: 401, json: { error: 'Test login rejected' } })
        }
        return route.fulfill({ json: { user: null } })
      })
      await page.goto(`${baseUrl}${route}`)
      const help = page.getByRole('button', { name: 'Step-by-step help', exact: true })
      try { await help.waitFor({ timeout: 10000 }) } catch (error) {
        console.log(await page.locator('body').innerText())
        console.log({ errors, url: page.url() })
        await page.screenshot({ path: 'work/sign-in-guide/debug.png' })
        throw error
      }
      assert.equal(modules.some(url => /\/SignInWalkthrough\./.test(url)), false, 'tour must be lazy-loaded')
      const username = page.locator('input[autocomplete="username"]')
      const password = page.locator('input[autocomplete="current-password"]')
      const submit = page.getByRole('button', { name: 'Web sign in', exact: true })
      await help.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      for (let step = 0; step < 3; step += 1) {
        await page.waitForTimeout(100)
        const geometry = await page.evaluate(() => {
          const panel = document.querySelector('.sign-in-tour-panel').getBoundingClientRect()
          const ring = document.querySelector('.sign-in-tour-ring').getBoundingClientRect()
          return { inside: panel.left >= 0 && panel.right <= innerWidth && panel.top >= 0 && panel.bottom <= innerHeight,
            overlap: panel.left < ring.right && panel.right > ring.left && panel.top < ring.bottom && panel.bottom > ring.top }
        })
        assert.equal(geometry.inside, true, `panel in viewport: ${route}/${viewport.width}/${step}`)
        assert.equal(geometry.overlap, false, `panel must not cover target: ${route}/${viewport.width}/${step}`)
        if (step === 0 || step === 2) await page.screenshot({ path: `work/sign-in-guide/${route.slice(1)}-${viewport.width}-step${step + 1}.png` })
        if (step < 2) {
          assert.equal(await dialog.getByRole('button', { name: 'Next', exact: true }).isDisabled(), true)
          await (step === 0 ? username : password).click()
          await dialog.getByRole('button', { name: 'Next', exact: true }).click()
        } else await submit.click()
      }
      await dialog.waitFor({ state: 'detached' })
      assert.equal(logins, 0, 'practice must never authenticate')
      assert.equal(await username.getAttribute('aria-describedby'), null)
      await help.click()
      await username.click()
      await dialog.getByRole('button', { name: 'Next', exact: true }).click()
      await dialog.getByRole('button', { name: 'Back', exact: true }).click()
      await dialog.getByRole('heading', { name: 'Choose the username field' }).waitFor()
      await dialog.getByRole('button', { name: 'Close guide' }).click()
      await help.click()
      await dialog.waitFor()
      await page.keyboard.press('Tab')
      assert.equal(await username.evaluate(el => el === document.activeElement), true)
      await page.keyboard.press('Enter')
      assert.equal(logins, 0, 'Enter during practice must never authenticate')
      await page.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      assert.equal(await help.evaluate(el => el === document.activeElement), true)
      await username.fill('test-only')
      await password.fill('not-a-real-password')
      await submit.click()
      await page.getByRole('alert').or(page.getByText('Test login rejected', { exact: true })).waitFor()
      assert.equal(logins, 1, 'normal login must work after closing the guide')
      if (route === '/month-closure') {
        await page.getByRole('button', { name: 'Romanian', exact: true }).click()
        await page.getByRole('button', { name: 'Ghid pas cu pas', exact: true }).click()
        await page.getByRole('heading', { name: 'Selectați utilizatorul' }).waitFor()
        await page.keyboard.press('Escape')
      }
      assert.deepEqual(errors, [])
      console.log(`PASS ${route} ${viewport.width}x${viewport.height}: lazy load, three steps, safe practice, keyboard, login restored`)
      await context.close()
    }
  }
} finally {
  await browser.close()
}
