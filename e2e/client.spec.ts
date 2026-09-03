import { expect, type Page, test } from '@playwright/test'

const browserTestOrigin = process.env.PW_TEST_ORIGIN ?? 'http://127.0.0.1:4173'
const assetPath = `${browserTestOrigin}/__ASSET_PATH__`

test('the production client loads and renders with CDN modules', async ({ page }) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  page.on('requestfailed', (request) => {
    browserErrors.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText}`)
  })

  await page.addInitScript(
    (env) => {
      window.env = {
        assetPath: env.assetPath,
        assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
        proxyPath: '/api',
        board: 'ze-great-team',
        clientVersion: 'browser-test',
      }
    },
    { assetPath },
  )
  await page.route('**/api/boards/ze-great-team', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ panels: [] }) }),
  )
  await page.route('**/api/client', (route) =>
    route.fulfill({
      contentType: 'application/json',
      headers: { 'cache-control': 'no-store' },
      body: JSON.stringify({
        assetPath,
        assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
        serverVersion: 'browser-test-server',
      }),
    }),
  )

  await page.goto('/')
  await expect(page.locator('h1')).toHaveText('ze-great-team')
  await expect(page.locator('[data-board-footer]')).toContainText('Signals are read live')
  expect(browserErrors).toEqual([])
})

test('reloads when the server starts serving a different client', async ({ page }) => {
  let identityChecks = 0
  await page.addInitScript(
    (env) => {
      window.env = {
        assetPath: env.assetPath,
        assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
        proxyPath: '/api',
        board: 'ze-great-team',
        clientVersion: 'browser-test',
      }
    },
    { assetPath },
  )
  await page.route('**/api/boards/ze-great-team', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ panels: [] }) }),
  )
  await page.route('**/api/client', (route) => {
    identityChecks += 1
    const clientAssetPath = identityChecks === 1 ? `${assetPath}/new` : assetPath
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        assetPath: clientAssetPath,
        assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
        serverVersion: 'browser-test-server',
      }),
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

const signalFieldBoard = {
  panels: [
    {
      id: 'live-build',
      type: 'pipeline-status',
      running_animation: 'telemetry-bloom',
      position: { x: 0, y: 0, w: 6, h: 12 },
    },
    {
      id: 'fast-build',
      type: 'pipeline-status',
      running_animation: 'release-transit',
      position: { x: 6, y: 0, w: 6, h: 12 },
    },
    {
      id: 'legacy-signal-build',
      type: 'pipeline-status',
      running_animation: 'signal-field',
      position: { x: 0, y: 12, w: 12, h: 12 },
    },
    {
      id: 'falling-shapes-build',
      type: 'pipeline-status',
      running_animation: 'falling-shapes',
      position: { x: 0, y: 24, w: 12, h: 2 },
    },
    {
      id: 'narrow-bloom-build',
      type: 'pipeline-status',
      running_animation: 'telemetry-bloom',
      position: { x: 0, y: 26, w: 2, h: 2 },
    },
  ],
}

const singleScreenBoard = {
  panels: [
    {
      id: 'coupling-build',
      label: 'Coupling',
      type: 'pipeline-status',
      density: 'comfortable',
      position: { x: 0, y: 0, w: 12, h: 2 },
    },
    {
      id: 'jsmints-build',
      label: 'JSmints',
      type: 'pipeline-status',
      density: 'comfortable',
      position: { x: 0, y: 2, w: 12, h: 2 },
    },
    {
      id: 'testmints-build',
      label: 'Testmints',
      type: 'pipeline-status',
      density: 'comfortable',
      position: { x: 0, y: 4, w: 12, h: 2 },
    },
    {
      id: 'tools-build',
      label: 'Tools',
      type: 'pipeline-status',
      density: 'comfortable',
      position: { x: 0, y: 6, w: 12, h: 2 },
    },
    {
      id: 'dashboard-build',
      label: 'Dashboard',
      type: 'pipeline-status',
      density: 'comfortable',
      position: { x: 0, y: 8, w: 12, h: 2 },
    },
    {
      id: 'tagger-version',
      label: 'Tagger',
      type: 'http-value',
      position: { x: 0, y: 10, w: 3, h: 2 },
      density: 'compact',
    },
    {
      id: 'coupling-version',
      label: 'Coupling',
      type: 'http-value',
      position: { x: 3, y: 10, w: 3, h: 2 },
      density: 'compact',
    },
    {
      id: 'jsmints-version',
      label: 'JSmints',
      type: 'http-value',
      position: { x: 6, y: 10, w: 3, h: 2 },
      density: 'compact',
    },
    {
      id: 'testmints-version',
      label: 'Testmints',
      type: 'http-value',
      position: { x: 9, y: 10, w: 3, h: 2 },
      density: 'compact',
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

const valueEnvelope = (panelId: string) => ({
  panelId,
  state: 'ok',
  observedAt: '2026-08-24T14:00:00.000Z',
  link: 'https://example.com/version',
  signal: { type: 'http-value', value: '1.2.3' },
})

const pullRequestHealthEnvelope = (panelId: string) => ({
  panelId,
  state: 'ok',
  observedAt: '2026-08-24T14:00:00.000Z',
  link: 'https://github.com/example/example/pulls',
  signal: {
    type: 'pull-request-health',
    status: 'passed',
    summary: '1 update workflow · No open update PRs',
    workflows: [{ label: 'dependabot', status: 'passed', detail: 'Passed', link: null }],
    pullRequests: [],
  },
})

function browserEnv(board = 'ze-great-team') {
  return {
    assetPath,
    assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
    proxyPath: '/api',
    board,
    clientVersion: 'browser-test',
  }
}

function stubDashboard(page: Page, board: unknown, boardName = 'ze-great-team') {
  return Promise.all([
    page.addInitScript((env) => {
      window.env = env
    }, browserEnv(boardName)),
    page.route(`**/api/boards/${boardName}`, (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify(board) }),
    ),
    page.route('**/api/client', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          assetPath,
          assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
          serverVersion: 'browser-test-server',
        }),
      }),
    ),
  ])
}

function stubBoard(page: Page) {
  return Promise.all([
    stubDashboard(page, positionedBoard),
    page.route('**/api/panel/**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }),
    ),
  ])
}

test('fits a positioned board inside the desktop viewport', async ({ page }) => {
  await stubBoard(page)
  await page.goto('/')
  await expect(page.locator('[data-panel]')).toHaveCount(positionedBoard.panels.length)

  const layout = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
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

test('keeps four independently sourced facts readable inside one compact panel', async ({
  page,
}) => {
  const facts = [
    { id: 'api', label: 'API', url: 'https://api.example.com/version' },
    { id: 'web', label: 'Web', url: 'https://web.example.com/version' },
    { id: 'worker', label: 'Worker', url: 'https://worker.example.com/version' },
    { id: 'docs', label: 'Docs', url: 'https://docs.example.com/version' },
  ]
  await page.setViewportSize({ width: 2400, height: 1200 })
  await stubDashboard(page, {
    panels: [
      {
        id: 'versions',
        label: 'Deployed libraries',
        type: 'http-value',
        density: 'compact',
        facts,
        position: { x: 0, y: 0, w: 6, h: 4 },
      },
    ],
  })
  await page.route('**/api/panel/**', (route) => {
    const factId = new URL(route.request().url()).pathname.split('/').at(-1) ?? ''
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        panelId: 'versions',
        state: 'ok',
        observedAt: '2026-08-24T14:00:00.000Z',
        link: `https://${factId}.example.com/version`,
        signal: { type: 'http-value', value: `${factId}-1.2.3` },
      }),
    })
  })

  await page.goto('/')
  await expect(page.locator('[data-http-value-fact]')).toHaveCount(4)
  const layout = await page.locator('[data-panel-id="versions"]').evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect()
    const facts = [...panel.querySelectorAll<HTMLElement>('[data-http-value-fact]')]
    return {
      fits: panel.scrollHeight <= panel.clientHeight,
      factsFit: facts.every((fact) => {
        const rect = fact.getBoundingClientRect()
        return (
          rect.left >= panelRect.left &&
          rect.right <= panelRect.right &&
          rect.top >= panelRect.top &&
          rect.bottom <= panelRect.bottom
        )
      }),
    }
  })
  expect(layout).toEqual({ fits: true, factsFit: true })
  for (const fact of facts)
    await expect(
      page.locator(`[aria-label="View source for ${fact.label} (opens in a new tab)"]`),
    ).toHaveCount(1)
})

test('adapts density independently across wide, square, narrow, and tall cells', async ({
  page,
}) => {
  const densityBoard = {
    panels: [
      {
        id: 'wide',
        type: 'pipeline-status',
        density: 'comfortable',
        position: { x: 0, y: 0, w: 6, h: 4 },
      },
      {
        id: 'compact-narrow',
        label: 'Coupling Updates',
        type: 'pipeline-status',
        density: 'compact',
        position: { x: 6, y: 0, w: 1, h: 2 },
      },
      { id: 'auto-narrow', type: 'pipeline-status', position: { x: 7, y: 0, w: 1, h: 2 } },
      { id: 'auto-tall', type: 'pipeline-status', position: { x: 8, y: 0, w: 1, h: 8 } },
    ],
  }
  await page.setViewportSize({ width: 2400, height: 1200 })
  await stubDashboard(page, densityBoard)
  await page.route('**/api/panel/**', (route) => {
    const panelId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
    )
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(pipelineEnvelope(panelId)),
    })
  })

  await page.goto('/')
  await expect(page.locator('[data-panel]')).toHaveCount(densityBoard.panels.length)
  await expect(page.locator('[data-panel][aria-busy="true"]')).toHaveCount(0)
  const layout = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
      const rect = panel.getBoundingClientRect()
      const metadata = panel.querySelector<HTMLElement>('[data-panel-meta]')
      return {
        id: panel.dataset.panelId,
        density: panel.dataset.density,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        fits: panel.scrollHeight <= panel.clientHeight,
        metadataDisplay: metadata ? getComputedStyle(metadata).display : 'missing',
      }
    }),
  )

  expect(layout.find((panel) => panel.id === 'wide')?.metadataDisplay).toBe('block')
  expect(layout.find((panel) => panel.id === 'compact-narrow')?.metadataDisplay).toBe('flex')
  expect(layout.find((panel) => panel.id === 'auto-narrow')?.metadataDisplay).toBe('flex')
  expect(layout.find((panel) => panel.id === 'auto-tall')?.metadataDisplay).toBe('flex')
  expect(layout.every((panel) => panel.fits && panel.right <= 2400)).toBe(true)
  expect(layout.every((panel, index) => index === 0 || panel.left >= layout[index - 1].right)).toBe(
    true,
  )

  const sourceCorner = await page.locator('[data-panel-id="compact-narrow"]').evaluate((panel) => {
    const action = panel.querySelector<HTMLElement>('[data-panel-link]')
    const label = panel.querySelector('h2')
    if (!action || !label) return { textOverlapsAction: true }
    const range = document.createRange()
    range.selectNodeContents(label)
    const actionRect = action.getBoundingClientRect()
    return {
      textOverlapsAction: [...range.getClientRects()].some(
        (rect) =>
          rect.left < actionRect.right &&
          rect.right > actionRect.left &&
          rect.top < actionRect.bottom &&
          rect.bottom > actionRect.top,
      ),
    }
  })
  expect(sourceCorner.textOverlapsAction).toBe(false)
})

test('centers pull-request status in a narrow tall tile while retaining normal and wide cards', async ({
  page,
}) => {
  const board = {
    panels: [
      {
        id: 'updates-tall',
        type: 'pull-request-health',
        position: { x: 0, y: 0, w: 1, h: 12 },
      },
      {
        id: 'updates-normal',
        type: 'pull-request-health',
        density: 'compact',
        position: { x: 1, y: 0, w: 3, h: 3 },
      },
      {
        id: 'updates-wide',
        type: 'pull-request-health',
        density: 'compact',
        position: { x: 4, y: 0, w: 8, h: 3 },
      },
    ],
  }
  await page.setViewportSize({ width: 2400, height: 1200 })
  await stubDashboard(page, board)
  await page.route('**/api/panel/**', (route) => {
    const path = new URL(route.request().url()).pathname
    const panelId = decodeURIComponent(path.split('/').at(-2) ?? '')
    if (path.endsWith('/pull-requests'))
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          panelId,
          state: 'ok',
          observedAt: '2026-08-29T12:00:00.000Z',
          link: 'https://github.com/example/repo',
          signal: { type: 'pull-request-candidates', pullRequests: [] },
        }),
      })
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(pullRequestHealthEnvelope(panelId)),
    })
  })

  await page.goto('/')
  await expect(page.locator('[data-panel]')).toHaveCount(3)
  await expect(page.locator('[data-panel][aria-busy="true"]')).toHaveCount(0)

  const presentation = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
      const rect = (selector: string) =>
        panel.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
      const label = rect('h2')
      const status = rect('[data-panel-anchor="status"]')
      const evidence = rect('[data-panel-anchor="evidence"]')
      return {
        id: panel.dataset.panelId,
        facts: getComputedStyle(panel.querySelector('[data-compact-facts]') as Element).display,
        summary: getComputedStyle(
          panel.querySelector('[data-compact-facts]')?.previousElementSibling as Element,
        ).position,
        fits: panel.scrollHeight <= panel.clientHeight,
        anchors:
          label && status && evidence
            ? { labelBottom: label.bottom, statusTop: status.top, evidenceTop: evidence.top }
            : undefined,
      }
    }),
  )

  expect(presentation.find((panel) => panel.id === 'updates-tall')).toMatchObject({
    facts: 'flex',
    summary: 'absolute',
    fits: true,
  })
  const tallAnchors = presentation.find((panel) => panel.id === 'updates-tall')?.anchors
  expect(tallAnchors?.statusTop).toBeGreaterThan(
    tallAnchors?.labelBottom ?? Number.POSITIVE_INFINITY,
  )
  expect(tallAnchors?.evidenceTop).toBeGreaterThan(
    tallAnchors?.statusTop ?? Number.POSITIVE_INFINITY,
  )
  expect(presentation.find((panel) => panel.id === 'updates-normal')).toMatchObject({
    facts: 'none',
    summary: 'static',
    fits: true,
  })
  expect(presentation.find((panel) => panel.id === 'updates-wide')).toMatchObject({
    facts: 'none',
    summary: 'static',
    fits: true,
  })
})

test('stacks build and pull-request evidence readably on narrow viewports', async ({ page }) => {
  const board = {
    panels: [
      {
        id: 'build',
        label: 'Main build',
        type: 'pipeline-status',
        position: { x: 0, y: 0, w: 6, h: 2 },
      },
      {
        id: 'updates',
        label: 'Dependency updates',
        type: 'pull-request-health',
        update_workflows: [{ workflow: 'dependabot' }],
        position: { x: 6, y: 0, w: 6, h: 2 },
      },
    ],
  }
  await page.setViewportSize({ width: 700, height: 844 })
  await stubDashboard(page, board)
  await page.route('**/api/panel/**', (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/panel/ze-great-team/build')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(pipelineEnvelope('build')),
      })
    if (path === '/api/panel/ze-great-team/updates/pull-requests')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          panelId: 'updates',
          state: 'ok',
          observedAt: '2026-08-24T14:00:00.000Z',
          link: 'https://github.com/example/example/pulls',
          signal: { type: 'pull-request-candidates', pullRequests: [] },
        }),
      })
    if (path === '/api/panel/ze-great-team/updates/update-workflow/dependabot')
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          panelId: 'updates',
          state: 'ok',
          observedAt: '2026-08-24T14:00:00.000Z',
          link: 'https://github.com/example/example/actions',
          signal: {
            type: 'pull-request-workflow',
            workflow: 'dependabot',
            item: { label: 'dependabot', status: 'passed', detail: 'Passed', link: null },
          },
        }),
      })
    return route.fulfill({ status: 404, body: `Unexpected panel path: ${path}` })
  })
  await page.goto('/')
  await expect(page.locator('[data-panel]')).toHaveCount(board.panels.length)
  await expect(page.locator('[data-panel][aria-busy="true"]')).toHaveCount(0)
  await expect(page.locator('[data-panel-id="build"]')).toContainText('✓ Passed')
  await expect(page.locator('[data-panel-id="updates"]')).toContainText('✓ Healthy')

  const layout = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
      const rect = panel.getBoundingClientRect()
      const content = panel.querySelector<HTMLElement>('[data-panel-content]')
      return {
        id: panel.dataset.panelId,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        contentHeight: content?.clientHeight ?? 0,
        contentScrollHeight: content?.scrollHeight ?? 0,
        readableContentFits: content ? content.scrollHeight <= content.clientHeight : false,
      }
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
  expect(
    layout.panels.every((panel) => panel.readableContentFits),
    `Clipped narrow panel content: ${JSON.stringify(
      layout.panels
        .filter((panel) => !panel.readableContentFits)
        .map(({ id, contentHeight, contentScrollHeight }) => ({
          id,
          contentHeight,
          contentScrollHeight,
        })),
    )}`,
  ).toBe(true)
  expect(layout.panels[0].top).toBeLessThan(layout.panels[1].top)
})

test('keeps panel-scale fields behind readable content, adapts them without overflow, and honors reduced motion', async ({
  page,
}) => {
  const runningSignal = {
    panelId: 'live-build',
    state: 'ok',
    observedAt: '2026-08-24T14:00:00.000Z',
    link: null,
    signal: {
      type: 'pipeline-status',
      status: 'running',
      rawStatus: 'in_progress',
      name: 'Build',
      runStartedAt: '2026-08-24T13:58:00.000Z',
      estimatedDurationMs: 2_000,
    },
  }
  await stubDashboard(page, signalFieldBoard)
  await page.route('**/api/panel/**', (route) => {
    const panelId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
    )
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...runningSignal, panelId }),
    })
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const field = page.locator('[data-running-field][data-animation="telemetry-bloom"]').first()
  await expect(field).toBeVisible()
  const large = await field.evaluate((element) => {
    const panel = element.closest<HTMLElement>('[data-panel]')?.getBoundingClientRect()
    const content = element
      .closest<HTMLElement>('[data-panel]')
      ?.querySelector<HTMLElement>('[data-panel-content]')
    const packet = element.querySelector<HTMLElement>('[data-running-part="bloom-marker"]')
    return {
      panel,
      field: element.getBoundingClientRect(),
      content: content?.getBoundingClientRect(),
      packetAnimation: packet && getComputedStyle(packet).animationName,
    }
  })
  expect(large.panel).toBeTruthy()
  expect(large.field?.left).toBeGreaterThanOrEqual(large.panel?.left ?? 0)
  expect(large.field?.bottom).toBeLessThanOrEqual(large.panel?.bottom ?? Number.POSITIVE_INFINITY)
  expect(large.content?.zIndex).not.toBe('auto')
  expect(large.packetAnimation).not.toBe('none')

  // The compact decision must follow the panel's rendered width, not the viewport width.
  const narrowBloom = page.locator('[data-running-field][data-animation="telemetry-bloom"]').nth(1)
  await expect(narrowBloom).toBeVisible()
  expect(
    await narrowBloom
      .locator('[data-running-part="bloom-lanes"]')
      .evaluate((element) => getComputedStyle(element).display),
  ).toBe('none')

  const transit = page.locator('[data-running-field][data-animation="release-transit"]')
  await expect(transit).toBeVisible()
  expect(
    await transit
      .locator('[data-running-part="transit-packet"]')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).not.toBe('none')

  const falling = page.locator('[data-running-field][data-animation="falling-shapes"]')
  await expect(falling).toBeVisible()
  const fallingField = falling.locator('[data-running-part="falling-shapes-field"]')
  await expect(fallingField).toHaveAttribute('data-direction', 'horizontal')

  const legacySignal = page.locator('[data-running-progress="signal-field"]')
  await expect(legacySignal).toBeVisible()
  const legacySignalLayout = await legacySignal.evaluate((element) => {
    const visual = element.querySelector<HTMLElement>('[data-running-visual]')
    const tracks = element.querySelector<HTMLElement>('[data-running-part="signal-tracks"]')
    return {
      visualHeight: visual?.getBoundingClientRect().height ?? 0,
      tracksDisplay: tracks ? getComputedStyle(tracks).display : 'none',
    }
  })
  expect(legacySignalLayout.visualHeight).toBeGreaterThan(100)
  expect(legacySignalLayout.tracksDisplay).toBe('flex')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(
    await field
      .locator('[data-running-part="bloom-marker"]')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none')
  expect(
    await legacySignal
      .locator('[data-running-part="signal-marker"]')
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none')
  await expect(page.locator('[data-panel-content]').first()).toContainText('Elapsed')

  await page.setViewportSize({ width: 390, height: 844 })
  const narrow = await field.evaluate((element) => {
    const lanes = element.querySelector<HTMLElement>('[data-running-part="bloom-lanes"]')
    return {
      lanesVisible: lanes ? getComputedStyle(lanes).display !== 'none' : false,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }
  })
  expect(narrow.lanesVisible).toBe(false)
  expect(narrow.documentWidth).toBeLessThanOrEqual(narrow.viewportWidth)
})

test('keeps phased signal and bloom markers continuous while progress updates and reverses', async ({
  page,
}) => {
  const motionBoard = {
    panels: [
      {
        id: 'bloom-build',
        type: 'pipeline-status',
        running_animation: 'telemetry-bloom',
        position: { x: 0, y: 0, w: 12, h: 6 },
      },
      {
        id: 'signal-build',
        type: 'pipeline-status',
        running_animation: 'signal-field',
        position: { x: 0, y: 6, w: 12, h: 6 },
      },
    ],
  }
  const runStartedAt = new Date(Date.now() - 120_000).toISOString()
  const runningSignal = {
    state: 'ok',
    observedAt: new Date().toISOString(),
    link: null,
    signal: {
      type: 'pipeline-status',
      status: 'running',
      rawStatus: 'in_progress',
      name: 'Build',
      runStartedAt,
      estimatedDurationMs: 300_000,
    },
  }
  await stubDashboard(page, motionBoard)
  await page.route('**/api/panel/**', (route) => {
    const panelId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
    )
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...runningSignal, panelId }),
    })
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('[data-running-part="bloom-marker"]').first()).toBeVisible()
  await expect(page.locator('[data-running-part="signal-marker"]').first()).toBeVisible()

  const sample = () =>
    page.evaluate(() => {
      const read = (bodyPart: string, anchorPart: string) => {
        const body = document.querySelector<HTMLElement>(`[data-running-part="${bodyPart}"]`)
        const anchor = document.querySelector<HTMLElement>(`[data-running-part="${anchorPart}"]`)
        const field = body?.closest<HTMLElement>('[data-running-field], [data-running-progress]')
        const animation = body?.getAnimations()[0]
        const bodyRect = body?.getBoundingClientRect()
        const anchorRect = anchor?.getBoundingClientRect()
        const fieldRect = field?.getBoundingClientRect()
        const computed = body ? getComputedStyle(body) : undefined
        return {
          bodyLeft: bodyRect?.left ?? Number.NaN,
          anchorLeft: anchorRect?.left ?? Number.NaN,
          fieldLeft: fieldRect?.left ?? Number.NaN,
          fieldRight: fieldRect?.right ?? Number.NaN,
          animationName: computed?.animationName,
          animationDuration: computed?.animationDuration,
          animationDirection: computed?.animationDirection,
          animationTime: animation?.currentTime ?? Number.NaN,
          progress: field ? getComputedStyle(field).getPropertyValue('--running-progress') : '',
        }
      }
      return {
        bloom: read('bloom-marker', 'bloom-marker-anchor'),
        signal: read('signal-marker', 'signal-marker-anchor'),
      }
    })

  const nextFrame = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        }),
    )
  const nextAnimationIteration = () =>
    page.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const marker = document.querySelector<HTMLElement>('[data-running-part="bloom-marker"]')
          if (!marker) {
            reject(new Error('bloom marker did not mount'))
            return
          }
          marker.addEventListener('animationiteration', () => resolve(), { once: true })
        }),
    )

  const samples = [await sample()]
  for (let index = 0; index < 3; index += 1) {
    await nextFrame()
    samples.push(await sample())
  }
  await nextAnimationIteration()
  samples.push(await sample())
  for (let index = 0; index < 2; index += 1) {
    await nextFrame()
    samples.push(await sample())
  }
  const diagnostics = JSON.stringify(samples, null, 2)
  for (const treatment of ['bloom', 'signal'] as const) {
    const positions = samples.map((entry) => entry[treatment])
    expect(
      positions.every(
        (entry) => entry.bodyLeft >= entry.fieldLeft && entry.bodyLeft <= entry.fieldRight,
      ),
      diagnostics,
    ).toBe(true)
    expect(
      positions.every((entry) => entry.animationName !== 'none'),
      diagnostics,
    ).toBe(true)
    expect(
      positions.every((entry) => entry.animationDuration === '3.2s'),
      diagnostics,
    ).toBe(true)
    expect(
      positions.every((entry) => entry.animationDirection === 'alternate'),
      diagnostics,
    ).toBe(true)
    expect(positions.at(-1)?.animationTime, diagnostics).toBeGreaterThan(
      positions[0]?.animationTime ?? 0,
    )
    const phaseSteps = [
      [positions[0], positions[1]],
      [positions[1], positions[2]],
      [positions[2], positions[3]],
      [positions[4], positions[5]],
      [positions[5], positions[6]],
    ].map(([before, after]) =>
      Math.abs(after.bodyLeft - after.anchorLeft - (before.bodyLeft - before.anchorLeft)),
    )
    expect(Math.max(...phaseSteps), diagnostics).toBeLessThan(20)
  }
  expect(
    samples.map((entry) => entry.bloom.animationName),
    diagnostics,
  ).toEqual(samples.map((entry) => entry.signal.animationName))
})

test('fits populated single-screen team layout without clipping required content', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2048, height: 1024 })
  await stubDashboard(page, singleScreenBoard)
  await page.route('**/api/panel/**', (route) => {
    const panelId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
    )
    const panel = singleScreenBoard.panels.find((candidate) => candidate.id === panelId)
    const body =
      panel?.type === 'pipeline-status' ? pipelineEnvelope(panelId) : valueEnvelope(panelId)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
  })

  await page.goto('/')
  await expect(page.locator('[data-panel]')).toHaveCount(singleScreenBoard.panels.length)
  await expect(page.locator('[data-panel-link]')).toHaveCount(singleScreenBoard.panels.length)

  const layout = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
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
  const buildRows = layout.panels.slice(0, 5)
  const versionPanels = layout.panels.slice(5)
  expect(buildRows.every((panel) => panel.right - panel.left > layout.viewport.width * 0.9)).toBe(
    true,
  )
  expect(new Set(versionPanels.map((panel) => panel.top)).size).toBe(1)
  expect(
    await page
      .locator('[data-panel][data-density="comfortable"] [data-panel-content]')
      .first()
      .evaluate((element) => getComputedStyle(element).flexDirection),
  ).toBe('row')
  expect(
    await page
      .locator('[data-panel][data-density="compact"] [data-panel-content]')
      .first()
      .evaluate((element) => getComputedStyle(element).flexDirection),
  ).toBe('row')
})

test('keeps the focused signal-field demo expanded at panel scale', async ({ page }) => {
  const reviewBoard = {
    panels: [
      {
        id: 'signal-field-motion-review',
        type: 'pipeline-animation-demo',
        running_animation: 'signal-field',
        position: { x: 0, y: 0, w: 12, h: 12 },
      },
    ],
  }
  await stubDashboard(page, reviewBoard)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const geometry = await page
    .locator('[data-running-progress="signal-field"]')
    .evaluate((element) => {
      const panel = element.closest<HTMLElement>('[data-panel]')?.getBoundingClientRect()
      const visual = element
        .querySelector<HTMLElement>('[data-running-visual]')
        ?.getBoundingClientRect()
      const tracks = element.querySelector<HTMLElement>('[data-running-part="signal-tracks"]')
      return {
        panelWidth: panel?.width ?? 0,
        panelHeight: panel?.height ?? 0,
        visualWidth: visual?.width ?? 0,
        visualHeight: visual?.height ?? 0,
        tracksDisplay: tracks ? getComputedStyle(tracks).display : 'none',
      }
    })
  expect(geometry.visualWidth).toBeGreaterThan(geometry.panelWidth * 0.8)
  expect(geometry.visualHeight).toBeGreaterThan(geometry.panelHeight * 0.5)
  expect(geometry.tracksDisplay).toBe('flex')
})

test('keeps the showcase signal-field visual inside its three-row panel', async ({ page }) => {
  const showcaseBoard = {
    panels: [
      {
        id: 'showcase-signal-field',
        type: 'pipeline-animation-demo',
        running_animation: 'signal-field',
        position: { x: 7, y: 6, w: 5, h: 3 },
      },
    ],
  }
  await stubDashboard(page, showcaseBoard, 'animation-showcase')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const signal = page.locator('[data-running-progress="signal-field"]')
  await expect(signal).toBeVisible()
  const geometry = await signal.evaluate((element) => {
    const panel = element.closest<HTMLElement>('[data-panel]')
    const visual = element.querySelector<HTMLElement>('[data-running-visual]')
    const tracks = element.querySelector<HTMLElement>('[data-running-part="signal-tracks"]')
    return {
      panelBottom: panel?.getBoundingClientRect().bottom ?? 0,
      visualBottom: visual?.getBoundingClientRect().bottom ?? 0,
      panelFits: panel ? panel.scrollHeight <= panel.clientHeight : false,
      tracksDisplay: tracks ? getComputedStyle(tracks).display : 'none',
    }
  })

  expect(geometry.visualBottom).toBeLessThanOrEqual(geometry.panelBottom)
  expect(geometry.panelFits).toBe(true)
  expect(geometry.tracksDisplay).toBe('flex')
})
