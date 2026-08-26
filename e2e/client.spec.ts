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
  await expect(page.locator('[data-board-footer]')).toContainText('Signals are read live')
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
  ],
}

const singleScreenBoard = {
  panels: [
    {
      id: 'coupling-build',
      label: 'Coupling',
      type: 'pipeline-status',
      display: 'primary',
      position: { x: 0, y: 0, w: 12, h: 2 },
    },
    {
      id: 'jsmints-build',
      label: 'JSmints',
      type: 'pipeline-status',
      display: 'primary',
      position: { x: 0, y: 2, w: 12, h: 2 },
    },
    {
      id: 'testmints-build',
      label: 'Testmints',
      type: 'pipeline-status',
      display: 'primary',
      position: { x: 0, y: 4, w: 12, h: 2 },
    },
    {
      id: 'tools-build',
      label: 'Tools',
      type: 'pipeline-status',
      display: 'primary',
      position: { x: 0, y: 6, w: 12, h: 2 },
    },
    {
      id: 'dashboard-build',
      label: 'Dashboard',
      type: 'pipeline-status',
      display: 'primary',
      position: { x: 0, y: 8, w: 12, h: 2 },
    },
    {
      id: 'tagger-version',
      label: 'Tagger',
      type: 'http-value',
      position: { x: 0, y: 10, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'coupling-version',
      label: 'Coupling',
      type: 'http-value',
      position: { x: 3, y: 10, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'jsmints-version',
      label: 'JSmints',
      type: 'http-value',
      position: { x: 6, y: 10, w: 3, h: 2 },
      display: 'compact',
    },
    {
      id: 'testmints-version',
      label: 'Testmints',
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

test('stacks panels readably on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await stubBoard(page)
  await page.goto('/')
  await expect(page.locator('[data-panel]')).toHaveCount(positionedBoard.panels.length)

  const layout = await page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
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
  await page.addInitScript(() => {
    window.env = {
      assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
      proxyPath: '/api',
      board: 'ze-great-team',
      clientVersion: 'browser-test',
    }
  })
  await page.route('**/api/boards/ze-great-team', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(signalFieldBoard) }),
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
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...runningSignal, panelId }),
    })
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const field = page.locator('[data-running-field][data-animation="telemetry-bloom"]')
  await expect(field).toBeVisible()
  await expect(field.locator('[data-running-part="bloom-lane"]')).toHaveCount(4)
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

  const transit = page.locator('[data-running-field][data-animation="release-transit"]')
  await expect(transit).toBeVisible()
  await expect(transit.locator('[data-running-part="transit-packet"]')).toHaveCount(1)
  await expect(transit.locator('[data-running-part="transit-trail"]')).toHaveCount(1)
  await expect(transit.locator('[data-running-part="transit-now"]')).toHaveCount(1)
  expect(
    await transit
      .locator('[data-running-part="transit-packet"]')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).not.toBe('none')

  const falling = page.locator('[data-running-field][data-animation="falling-shapes"]')
  await expect(falling).toBeVisible()
  const fallingField = falling.locator('[data-running-part="falling-shapes-field"]')
  await expect(fallingField).toHaveAttribute('data-direction', 'horizontal')
  await expect(fallingField).toHaveCount(1)
  await page.waitForTimeout(1_400)
  await expect(falling.locator('[data-piece]')).toHaveCount(1)
  const firstPieceCells = await falling
    .locator('[data-piece]')
    .first()
    .locator(':scope > span')
    .count()
  expect(firstPieceCells).toBeGreaterThanOrEqual(2)
  expect(firstPieceCells).toBeLessThanOrEqual(4)
  await page.waitForTimeout(1_800)
  await expect(falling.locator('[data-piece]')).toHaveCount(2)

  const legacySignal = page.locator('[data-running-progress="signal-field"]')
  await expect(legacySignal).toBeVisible()
  await expect(legacySignal.locator('[data-running-part="signal-track"]')).toHaveCount(5)
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
  await page.waitForTimeout(100)
  const reducedFallingPosition = await falling.locator('[data-piece]').first().getAttribute('style')
  await page.waitForTimeout(200)
  await expect(falling.locator('[data-piece]').first()).toHaveAttribute(
    'style',
    reducedFallingPosition ?? '',
  )
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
  await page.addInitScript(() => {
    window.env = {
      assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
      proxyPath: '/api',
      board: 'ze-great-team',
      clientVersion: 'browser-test',
    }
  })
  await page.route('**/api/boards/ze-great-team', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(motionBoard) }),
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
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ ...runningSignal, panelId }),
    })
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.locator('[data-running-part="bloom-marker"]')).toHaveCount(4)
  await expect(page.locator('[data-running-part="signal-marker"]')).toHaveCount(5)

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

  const samples = [await sample()]
  for (const delay of [20, 20, 20, 3_050, 20, 20]) {
    await page.waitForTimeout(delay)
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
      .locator('[data-panel][data-display="primary"] [data-panel-content]')
      .first()
      .evaluate((element) => getComputedStyle(element).flexDirection),
  ).toBe('row')
  expect(
    await page
      .locator('[data-panel][data-display="compact"] [data-panel-content]')
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
  await page.addInitScript(() => {
    window.env = {
      assetPath: 'http://127.0.0.1:4173/__ASSET_PATH__',
      proxyPath: '/api',
      board: 'ze-great-team',
      clientVersion: 'browser-test',
    }
  })
  await page.route('**/api/boards/ze-great-team', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(reviewBoard) }),
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
  await expect(page.locator('[data-running-part="signal-track"]')).toHaveCount(5)
})
