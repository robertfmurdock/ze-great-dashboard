import { expect, test } from '@playwright/test'

const origin = process.env.PW_AUTH0_BROWSER_ORIGIN
const bootstrap = process.env.PW_AUTH0_OIDC_BOOTSTRAP

test.skip(!origin || !bootstrap, 'Auth0 browser credentials are unavailable outside trusted main.')

test.use({ baseURL: origin })

test('admits a freshly minted Auth0 user token through the packaged dashboard', async ({
  page,
}) => {
  const protectedResponses: number[] = []
  page.on('response', (response) => {
    if (/\/api\/(boards\/auth0-browser|client)$/.test(new URL(response.url()).pathname))
      protectedResponses.push(response.status())
  })
  await page.addInitScript((value) => {
    window.__DASHBOARD_OIDC_TEST_BOOTSTRAP__ = JSON.parse(value)
  }, bootstrap)

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'auth0-browser' })).toBeVisible()
  await expect(page.locator('[data-panel-id="demo"]')).toContainText('Authenticated demo')
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  await expect.poll(() => protectedResponses).toContain(200)
  expect(protectedResponses.every((status) => status === 200)).toBe(true)
})
