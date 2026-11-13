import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, test } from '@playwright/test'

const origin = process.env.PW_AUTH0_BROWSER_ORIGIN
const bootstrap = process.env.PW_AUTH0_OIDC_BOOTSTRAP

test.skip(!origin || !bootstrap, 'Auth0 browser credentials are unavailable outside trusted main.')

test.use({ baseURL: origin })

test('admits a freshly minted Auth0 user token through the packaged dashboard', ({ page }) =>
  mint({
    setup: async () => {
      const protectedPaths = ['/api/boards/auth0-browser', '/api/client']
      const protectedResponses: { path: string; status: number }[] = []
      page.on('response', (response) => {
        const path = new URL(response.url()).pathname
        if (protectedPaths.includes(path))
          protectedResponses.push({ path, status: response.status() })
      })
      await page.addInitScript((value) => {
        window.__DASHBOARD_OIDC_TEST_BOOTSTRAP__ = JSON.parse(value)
      }, bootstrap)
      return { protectedPaths, protectedResponses }
    },
    exercise: () => page.goto('/', { waitUntil: 'domcontentloaded' }),
    verify: async (_, { protectedPaths, protectedResponses }) => {
      await expect(page.getByRole('heading', { name: 'auth0-browser' })).toBeVisible()
      await expect(page.locator('[data-panel-id="demo"]')).toContainText('Authenticated demo')
      await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
      await expect
        .poll(() => protectedResponses)
        .toEqual(expect.arrayContaining(protectedPaths.map((path) => ({ path, status: 200 }))))
      expect(protectedResponses.every(({ status }) => status === 200)).toBe(true)
    },
  }))
