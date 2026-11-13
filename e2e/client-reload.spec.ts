import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, test } from '@playwright/test'
import { assetPath, stubDashboard } from './client-support'

test('reloads the rendered board when a later poll finds a different client', ({ page }) =>
  mint({
    setup: async () => {
      const board = 'ze-great-team'
      const identity = {
        assetPath,
        assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
        serverVersion: 'browser-test-server',
      }
      await page.clock.install()
      await stubDashboard(page, { panels: [] }, board)
      const initialCheck = page.waitForResponse('**/api/client')
      await page.goto('/')
      const heading = page.getByRole('heading', { name: board, exact: true })
      await heading.waitFor()
      await (await initialCheck).finished()
      return { identity, heading, originalUrl: page.url() }
    },
    exercise: async ({ identity }) => {
      // Advertise the replacement once. After reload, the fixture serves its original identity.
      await page.route(
        '**/api/client',
        (route) => route.fulfill({ json: { ...identity, assetPath: `${identity.assetPath}/new` } }),
        { times: 1 },
      )
      const navigation = page.waitForEvent('framenavigated', {
        predicate: (frame) => frame === page.mainFrame(),
        timeout: 5_000,
      })
      const [frame] = await Promise.all([navigation, page.clock.fastForward(61_000)])
      return frame.url()
    },
    verify: async (url, { heading, originalUrl }) => {
      expect(url).toBe(originalUrl)
      await expect(heading).toBeVisible()
    },
  }))
