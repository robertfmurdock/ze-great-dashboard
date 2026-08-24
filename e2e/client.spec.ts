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
  await page.route('**/api/client', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({
        assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
        clientVersion: 'browser-test',
      }),
    }),
  )

  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('ze-great-team')
  await expect(page.locator('.board__footer')).toContainText('Signals are read live')
  expect(browserErrors).toEqual([])
})

test('reloads when the server starts serving a different client', async ({ page }) => {
  let identityChecks = 0
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
  await page.route('**/api/client', (route) => {
    identityChecks += 1
    const assetPath =
      identityChecks === 1
        ? 'http://127.0.0.1:4173/__ASSET_PATH__/new'
        : 'http://127.0.0.1:4173/__ASSET_PATH__'
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ assetPath, clientVersion: 'browser-test' }),
    })
  })

  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('ze-great-team')
  await expect.poll(() => identityChecks).toBe(2)
})

const positionedBoard = {
  panels: [
    { id: 'build-a', type: 'pipeline-status', position: { x: 0, y: 0, w: 6, h: 4 } },
    { id: 'build-b', type: 'pipeline-status', position: { x: 6, y: 0, w: 6, h: 4 } },
    { id: 'dashboard', type: 'pipeline-status', position: { x: 0, y: 8, w: 12, h: 4 } },
    { id: 'version', type: 'http-value', position: { x: 0, y: 12, w: 3, h: 2 } },
  ],
}

const singleScreenBoard = {
  panels: [
    { id: 'coupling-build', type: 'pipeline-status', position: { x: 0, y: 0, w: 6, h: 4 } },
    { id: 'jsmints-build', type: 'pipeline-status', position: { x: 6, y: 0, w: 6, h: 4 } },
    { id: 'testmints-build', type: 'pipeline-status', position: { x: 0, y: 4, w: 4, h: 4 } },
    { id: 'tools-build', type: 'pipeline-status', position: { x: 4, y: 4, w: 4, h: 4 } },
    { id: 'dashboard-build', type: 'pipeline-status', position: { x: 8, y: 4, w: 4, h: 4 } },
    {
      id: 'coupling-update-health',
      type: 'pull-request-health',
      position: { x: 0, y: 8, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'jsmints-update-health',
      type: 'pull-request-health',
      position: { x: 3, y: 8, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'testmints-update-health',
      type: 'pull-request-health',
      position: { x: 6, y: 8, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'tools-update-health',
      type: 'pull-request-health',
      position: { x: 9, y: 8, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'tagger-version',
      type: 'http-value',
      position: { x: 0, y: 10, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'coupling-version',
      type: 'http-value',
      position: { x: 3, y: 10, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'jsmints-version',
      type: 'http-value',
      position: { x: 6, y: 10, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'testmints-version',
      type: 'http-value',
      position: { x: 9, y: 10, w: 3, h: 2 },
      display: 'compact',
    },
  ],
}

const pipelineEnvelope = (panelId: string) => ({
  panelId,
  state: 'ok',
  observedAt: '2026-08-24T14:00:00.000Z',
  link: 'https://github.com/example/example/actions/runs/1',
  signal: {
    type: 'pipeline-status',
    status: 'passed',
    rawStatus: 'success',
    name: 'Build',
    branch: 'main',
    durationMs: 134_000,
    sourceUpdatedAt: '2026-08-24T13:00:00.000Z',
  },
})

const healthEnvelope = (panelId: string) => ({
  panelId,
  state: 'ok',
  observedAt: '2026-08-24T14:00:00.000Z',
  link: 'https://github.com/example/example',
  signal: {
    type: 'pull-request-health',
    status: 'passed',
    summary: '2 update workflows · No open update PRs',
    workflows: [],
    pullRequests: [],
  },
})

const valueEnvelope = (panelId: string) => ({
  panelId,
  state: 'ok',
  observedAt: '2026-08-24T14:00:00.000Z',
  link: 'https://example.com/version',
  signal: { type: 'http-value', value: '1.2.3' },
})

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
    page.route('**/api/client', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
          clientVersion: 'browser-test',
        }),
      }),
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

test('fits populated single-screen team layout without clipping required content', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2048, height: 1024 })
  await page.addInitScript(() => {
    window.env = {
      assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
      proxyPath: '/api',
      board: 'ze-great-team',
      clientVersion: 'browser-test',
    }
  })
  await page.route('**/api/boards/ze-great-team', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(singleScreenBoard) }),
  )
  await page.route('**/api/client', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
        clientVersion: 'browser-test',
      }),
    }),
  )
  await page.route('**/api/panel/**', (route) => {
    const panelId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
    )
    const panel = singleScreenBoard.panels.find((candidate) => candidate.id === panelId)
    const body =
      panel?.type === 'pipeline-status'
        ? pipelineEnvelope(panelId)
        : panel?.type === 'pull-request-health'
          ? healthEnvelope(panelId)
          : valueEnvelope(panelId)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })

  await page.goto('/')
  await expect(page.locator('.panel')).toHaveCount(singleScreenBoard.panels.length)
  await expect(page.locator('.panel__link')).toHaveCount(singleScreenBoard.panels.length)

  const layout = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('.panel')].map((panel) => {
      const rect = panel.getBoundingClientRect()
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        contentFits: panel.scrollHeight <= panel.clientHeight,
      }
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
  expect(layout.panels.every((panel) => panel.contentFits)).toBe(true)
  expect(layout.panels.every((panel) => panel.bottom <= layout.viewport.height)).toBe(true)
  expect(layout.panels.some((panel) => panel.right - panel.left < layout.viewport.width / 2)).toBe(
    true,
  )
})
