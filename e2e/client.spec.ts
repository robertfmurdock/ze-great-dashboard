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

const positionedBoard = {
  panels: [
    { id: 'build-a', type: 'pipeline-status', position: { x: 0, y: 0, w: 6, h: 4 } },
    { id: 'build-b', type: 'pipeline-status', position: { x: 6, y: 0, w: 6, h: 4 } },
    { id: 'dashboard', type: 'pipeline-status', position: { x: 0, y: 8, w: 12, h: 4 } },
    { id: 'version', type: 'http-value', position: { x: 0, y: 12, w: 3, h: 2 } },
  ],
}

function stubBoard(page: import('@playwright/test').Page) {
  return Promise.all([
    page.addInitScript(() => {
      window.env = {
        assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
        proxyPath: '/api',
        board: 'ze-great-team',
        clientVersion: 'browser-test',
      }
    }),
    page.route('**/api/boards/ze-great-team', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(positionedBoard) }),
    ),
    page.route('**/api/panel/**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }),
    ),
  ])
}

test('fits a positioned board inside the desktop viewport', async ({ page }) => {
  await stubBoard(page)
  await page.goto('/')
  await expect(page.locator('.panel')).toHaveCount(positionedBoard.panels.length)

  const layout = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('.panel')].map((panel) => {
      const rect = panel.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
    })
    return {
      panels,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
      },
    }
  })

  expect(layout.document.scrollWidth).toBeLessThanOrEqual(layout.viewport.width)
  expect(layout.document.scrollHeight).toBeLessThanOrEqual(layout.viewport.height)
  expect(layout.panels.every((panel) => panel.bottom <= layout.viewport.height)).toBe(true)
  expect(layout.panels[0].left).toBeLessThan(layout.panels[1].left)
  expect(layout.panels[2].right - layout.panels[2].left).toBeGreaterThan(
    layout.panels[0].right - layout.panels[0].left,
  )
})

test('stacks panels readably on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubBoard(page)
  await page.goto('/')
  await expect(page.locator('.panel')).toHaveCount(positionedBoard.panels.length)

  const layout = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('.panel')].map((panel) => {
      const rect = panel.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right }
    })
    return {
      panels,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })

  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport)
  expect(new Set(layout.panels.map((panel) => panel.left)).size).toBe(1)
  expect(layout.panels.every((panel) => panel.right <= layout.viewport)).toBe(true)
  expect(layout.panels[0].top).toBeLessThan(layout.panels[1].top)
})
