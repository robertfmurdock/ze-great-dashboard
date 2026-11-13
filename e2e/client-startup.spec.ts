import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, test } from '@playwright/test'

test.use({ trace: 'retain-on-failure' })

test('the production client loads and renders with CDN modules', ({ page }) =>
  mint({
    setup: async () => {
      const scenario = { board: 'public' }
      const browserErrors: string[] = []
      page.on('pageerror', (error) => browserErrors.push(error.message))
      page.on('console', (message) => {
        if (message.type() === 'error') browserErrors.push(message.text())
      })
      page.on('requestfailed', (request) => {
        browserErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
      })

      return { scenario, browserErrors }
    },
    exercise: async ({ scenario }) => {
      await page.goto('/')
      return {
        board: await page.getByRole('heading', { name: scenario.board }).textContent(),
        footer: await page.locator('[data-board-footer]').textContent(),
      }
    },
    verify: ({ board, footer }, { scenario, browserErrors }) => {
      expect(board).toBe(scenario.board)
      expect(footer).toContain('Signals are read live')
      expect(browserErrors).toEqual([])
    },
  }))
