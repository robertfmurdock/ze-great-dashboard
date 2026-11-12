import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, test } from '@playwright/test'
import { assetPath } from './client-support'

test('the production client loads and renders with CDN modules', ({ page }) =>
  mint({
    setup: async () => {
      const scenario = {
        assetPath,
        assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
        board: 'ze-great-team',
        clientVersion: 'browser-test',
        serverVersion: 'browser-test-server',
      }
      const browserErrors: string[] = []
      page.on('pageerror', (error) => browserErrors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text())
      })
      page.on('requestfailed', (request) => {
        browserErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
      })

      await page.addInitScript((env) => {
        window.env = {
          assetPath: env.assetPath,
          assetPathId: env.assetPathId,
          proxyPath: '/api',
          board: env.board,
          clientVersion: env.clientVersion,
        }
      }, scenario)
      await page.route(`**/api/boards/${scenario.board}`, (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ panels: [] }) }),
      )
      await page.route('**/api/client', (route) =>
        route.fulfill({
          contentType: 'application/json',
          headers: { 'cache-control': 'no-store' },
          body: JSON.stringify({
            assetPath: scenario.assetPath,
            assetPathId: scenario.assetPathId,
            serverVersion: scenario.serverVersion,
          }),
        }),
      )
      return { scenario, browserErrors }
    },
    exercise: async () => {
      await page.goto('/')
      return {
        board: await page.getByRole('heading', { name: 'ze-great-team' }).textContent(),
        footer: await page.locator('[data-board-footer]').textContent(),
      }
    },
    verify: ({ board, footer }, { scenario, browserErrors }) => {
      expect(board).toBe(scenario.board)
      expect(footer).toContain('Signals are read live')
      expect(browserErrors).toEqual([])
    },
  }))

test('reloads when the server starts serving a different client', ({ page }) =>
  mint({
    setup: async () => {
      let identityChecks = 0
      const scenario = {
        board: 'ze-great-team',
        assetPath,
        replacementAssetPath: `${assetPath}/new`,
      }
      await page.addInitScript((env) => {
        window.env = {
          assetPath: env.assetPath,
          assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
          proxyPath: '/api',
          board: env.board,
          clientVersion: 'browser-test',
        }
      }, scenario)
      await page.route(`**/api/boards/${scenario.board}`, (route) =>
        route.fulfill({ contentType: 'application/json', body: JSON.stringify({ panels: [] }) }),
      )
      await page.route('**/api/client', (route) => {
        const clientAssetPath =
          identityChecks++ === 0 ? scenario.replacementAssetPath : scenario.assetPath
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify({
            assetPath: clientAssetPath,
            assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
            serverVersion: 'browser-test-server',
          }),
        })
      })
      return { scenario, identityChecks: () => identityChecks }
    },
    exercise: () => page.goto('/'),
    verify: async (_, { scenario, identityChecks }) => {
      await expect
        .poll(() =>
          page.evaluate(() =>
            performance
              .getEntriesByType('navigation')
              .map((entry) => (entry as PerformanceNavigationTiming).type),
          ),
        )
        .toEqual(['reload'])
      await expect.poll(identityChecks).toBe(2)
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(scenario.board)
    },
  }))
