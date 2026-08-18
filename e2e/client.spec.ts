import { expect, test } from '@playwright/test'

test('the production client loads and renders with CDN modules', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    browserErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
  })

  await page.addInitScript(() => {
    window.env = {
      assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
      proxyPath: '/api',
      board: 'ze-great-team',
      clientVersion: 'browser-test',
    }
  })
  await page.route('**/api/boards/ze-great-team', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ panels: [] }) }),
  )

  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('ze-great-team')
  await expect(page.locator('.board__footer')).toContainText('Signals are read live')
  expect(browserErrors).toEqual([])
})
