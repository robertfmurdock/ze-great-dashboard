import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, type Page, test } from '@playwright/test'
import { positionedBoard, renderedTextGeometry, stubDashboard } from './client-support'

test.describe('attention rail', () => {
  test('important failures retain readable panel evidence and expose a reduced-motion attention rail', ({
    page,
  }) =>
    mint({
      setup: async () => {
        const scenario = { board: 'attention', panel: 'build', label: 'Build', treatment: 'alarm' }
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await stubDashboard(
          page,
          {
            attention: { treatment: scenario.treatment },
            panels: [
              {
                id: scenario.panel,
                label: scenario.label,
                type: 'pipeline-status',
                attention: true,
              },
            ],
          },
          scenario.board,
        )
        await page.route(`**/api/panel/${scenario.board}/${scenario.panel}`, (route) =>
          route.fulfill({
            contentType: 'application/json',
            body: JSON.stringify({
              panelId: scenario.panel,
              state: 'ok',
              observedAt: '2026-09-11T12:00:00.000Z',
              link: null,
              signal: {
                type: 'pipeline-status',
                status: 'failed',
                rawStatus: 'failure',
                name: scenario.label,
              },
            }),
          }),
        )
        return { scenario }
      },
      exercise: async () => {
        await page.goto('/')
        return {
          railText: await page.locator('[role="alert"]').textContent(),
          railHref: await page.locator('[role="alert"] a').getAttribute('href'),
          panelText: await page.locator('#panel-build').textContent(),
          activeCount: await page.locator('[data-attention-active="true"]').count(),
          animationName: await page
            .locator('[data-attention-treatment="alarm"]')
            .evaluate((node) => getComputedStyle(node).animationName),
        }
      },
      verify: (evidence, { scenario }) => {
        expect(evidence.railText).toContain(`${scenario.label}: Pipeline failed`)
        expect(evidence.railHref).toBe(`#panel-${scenario.panel}`)
        expect(evidence.panelText).toContain('Failed')
        expect(evidence.activeCount).toBe(1)
        expect(evidence.animationName).toBe('none')
      },
    }))
})

test.describe('update activity', () => {
  test('opens update activity as a full-screen inspection without changing the primary grid', ({
    page,
  }) =>
    mint({
      setup: async () => {
        await stubDashboard(page, positionedBoard)
        await page.route('**/api/panel/**', (route) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }),
        )
        await page.goto('/')
        const gridBefore = await page
          .locator('main')
          .evaluate((grid) => grid.getBoundingClientRect().toJSON())
        return { gridBefore }
      },
      exercise: async () => {
        await page.getByRole('button', { name: 'Update activity' }).click()
        const dialog = page.getByRole('dialog', { name: 'Update activity' })
        const modal = await dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          }
        })
        await dialog.getByRole('button', { name: 'Close' }).click()
        return {
          modal,
          dialogCount: await dialog.count(),
          gridAfter: await page
            .locator('main')
            .evaluate((grid) => grid.getBoundingClientRect().toJSON()),
        }
      },
      verify: ({ modal, dialogCount, gridAfter }, { gridBefore }) => {
        expect(modal).toMatchObject({
          left: 0,
          top: 0,
          width: modal.viewportWidth,
          height: modal.viewportHeight,
        })
        expect(dialogCount).toBe(0)
        expect(gridAfter).toEqual(gridBefore)
      },
    }))
})

test.describe('test-count direction', () => {
  test.use({ hasTouch: true })
  async function arrangeDirection(page: Page) {
    const wideViewport = { width: 1920, height: 1080 }
    const narrowViewport = { width: 360, height: 900 }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const panel = {
      id: 'tests',
      type: 'test-count',
      refresh: '1s',
      position: { x: 0, y: 0, w: 12, h: 8 },
    }
    const earlier = { id: '1', total: 100, updatedAt: new Date(Date.now() - 120000).toISOString() }
    const current = { id: '2', total: 120, updatedAt: new Date(Date.now() - 60000).toISOString() }
    const observations = [earlier, current]
    let observationIndex = 0
    await stubDashboard(page, { panels: [panel] })
    await page.route('**/api/panel/**', (route) => {
      const observation =
        observations[Math.min(observationIndex++, observations.length - 1)] ?? current
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          panelId: panel.id,
          state: 'ok',
          observedAt: observation.updatedAt,
          link: null,
          signal: {
            type: 'test-count',
            status: 'reported',
            total: observation.total,
            run: { id: observation.id, attempt: 1, updatedAt: observation.updatedAt },
          },
        }),
      })
    })
    const renderedPanel = page.locator(`[data-panel-id="${panel.id}"]`)
    const summary = renderedPanel.getByRole('button', { name: `${current.total} tests` })
    const chart = renderedPanel.locator('svg')
    return { wideViewport, narrowViewport, summary, chart }
  }

  test('keeps the test count readable from wall to phone and explains it on touch', ({
    page,
  }, testInfo) =>
    mint({
      setup: async () => {
        const direction = await arrangeDirection(page)
        await page.setViewportSize(direction.wideViewport)
        await page.goto('/')
        await direction.chart.waitFor()
        const wide = await renderedTextGeometry(direction.summary)
        await page.screenshot({ path: testInfo.outputPath('test-direction-wide.png') })
        return { direction, wide }
      },
      exercise: async ({ direction }) => {
        const narrow = await test.step('Resize to a phone viewport', async () => {
          await page.setViewportSize(direction.narrowViewport)
          await direction.chart.waitFor({ state: 'hidden' })
          return {
            chartVisible: await direction.chart.isVisible(),
            summary: await renderedTextGeometry(direction.summary),
          }
        })
        await test.step('Tap the test count', () => direction.summary.tap())
        return narrow
      },
      verify: async (narrow, { direction, wide }) => {
        expect(wide.contained).toBe(true)
        expect(narrow.chartVisible).toBe(false)
        expect(narrow.summary.contained).toBe(true)
        const explanation = page.getByRole('tooltip')
        await expect(explanation).toBeVisible()
        const bounds = await explanation.boundingBox()
        expect(bounds).not.toBeNull()
        expect((bounds?.x ?? -1) >= 0).toBe(true)
        expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
          direction.narrowViewport.width,
        )
        await page.screenshot({ path: testInfo.outputPath('test-direction-narrow.png') })
      },
    }))
})
