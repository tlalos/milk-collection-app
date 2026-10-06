import assert from 'node:assert/strict'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
const baseUrl = process.env.APP_TEST_URL || 'http://127.0.0.1:5173'
const user = { id: 'test-user', username: 'test-only', permissions: ['ocr_documents'] }

try {
  for (const pathname of ['/web-users', '/month-closure?month=2026-08', '/ocr']) {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    let signedIn = false
    let rejectLogin = true
    let loginCount = 0
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    // Mock only backend routes; no real accounts or application data are touched.
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (!path.startsWith('/api/')) return route.continue()
      if (path === '/api/auth/session') return route.fulfill({ json: { user: signedIn ? user : null } })
      if (path === '/api/auth/login') {
        loginCount += 1
        if (rejectLogin) return route.fulfill({ status: 401, json: { error: 'Test login rejected' } })
        signedIn = true
        return route.fulfill({ json: { user } })
      }
      return route.fulfill({ json: {} })
    })
    await page.goto(`${baseUrl}${pathname}`)
    await page.locator('input[autocomplete="username"]').fill('test-only')
    await page.locator('input[autocomplete="current-password"]').fill('not-a-real-password')
    await page.getByRole('button', { name: 'Web sign in', exact: true }).click()
    await page.getByText('Test login rejected', { exact: true }).waitFor()
    assert.equal(page.url(), `${baseUrl}${pathname}`, 'failed login must not navigate')
    rejectLogin = false
    await page.getByRole('button', { name: 'Web sign in', exact: true }).click()
    await page.waitForURL(`${baseUrl}/ocr`)
    await page.getByRole('button', { name: 'Web account: test-only', exact: true }).waitFor()
    await page.getByRole('button', { name: 'OCR documents', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Milk Reception', exact: true }).count(), 0, 'menu must respect permissions')
    assert.equal(loginCount, 2)

    // Restoring an existing session must not redirect away from the requested page.
    await page.goto(`${baseUrl}/web-users`)
    await page.getByRole('heading', { name: 'No access', exact: true }).waitFor()
    assert.equal(new URL(page.url()).pathname, '/web-users')
    assert.deepEqual(errors, [])
    console.log(`PASS ${pathname}: failed login stays, success opens menu, session persists, permissions and existing-session navigation preserved`)
    await context.close()
  }
} finally {
  await browser.close()
}
