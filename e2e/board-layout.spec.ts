import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { positionedBoard, renderedTextGeometry, stubDashboard } from './client-support'

/** Reads the observable scan-grid contract without coupling the test to CSS implementation. */
async function renderedPanelGrid(page: Page) {
  return page.evaluate(() => {
    const panels = [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
      const rect = panel.getBoundingClientRect()
      const content = panel.querySelector<HTMLElement>('[data-panel-content]')
      return {
        id: panel.dataset.panelId,
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        right: rect.right,
        readableContentFits: content ? content.scrollHeight <= content.clientHeight : false,
      }
    })
    return {
      panels,
      viewport: window.innerWidth,
      documentWidth: document.documentElement.scrollWidth,
    }
  })
}

/** Verifies that a compact status card presents its text in the intended reading order. */
async function compactStatusReadingOrder(panel: Locator) {
  return panel.evaluate((element) => {
    const rect = (selector: string) =>
      element.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
    const title = rect('[data-panel-identity-text]')
    const status = rect('[data-panel-status]')
    const evidence = rect('[data-panel-meta]')
    if (!title || !status || !evidence) return false
    return title.bottom <= status.top && status.bottom <= evidence.top
  })
}

/** A security warning occupies a header row rather than competing with the board title. */
async function securityNoticeHasHeaderRow(page: Page) {
  return page.evaluate(() => {
    const title = document.querySelector('h1')?.getBoundingClientRect()
    const notice = document
      .querySelector<HTMLElement>('aside[role="alert"]')
      ?.getBoundingClientRect()
    return Boolean(title && notice && notice.top >= title.bottom)
  })
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

function stubBoard(page: Page) {
  return Promise.all([
    stubDashboard(page, positionedBoard),
    page.route('**/api/panel/**', (route) =>
      route.fulfill({ contentType: 'application/json', body: JSON.stringify({}) }),
    ),
  ])
}

test('fits a positioned board inside the desktop viewport', ({ page }) =>
  mint({
    setup: async () => {
      await stubBoard(page)
      return { expectedPanels: positionedBoard.panels.length }
    },
    exercise: async () => {
      await page.goto('/')
      await page
        .locator('[data-panel]')
        .nth(positionedBoard.panels.length - 1)
        .waitFor()
      return page.evaluate(() => {
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
    },
    verify: (layout, { expectedPanels }) => {
      expect(layout.panels).toHaveLength(expectedPanels)
      expect(layout.document.scrollWidth).toBeLessThanOrEqual(layout.viewport.width)
      expect(layout.document.scrollHeight).toBeLessThanOrEqual(layout.viewport.height)
      expect(layout.panels.every((panel) => panel.bottom <= layout.viewport.height)).toBe(true)
      expect(layout.panels[0].left).toBeLessThan(layout.panels[1].left)
      expect(layout.panels[2].right - layout.panels[2].left).toBeGreaterThan(
        layout.panels[0].right - layout.panels[0].left,
      )
    },
  }))

test('uses a compact two-column scan grid at intermediate widths', ({ page }) =>
  mint({
    setup: async () => {
      const board = {
        panels: singleScreenBoard.panels
          .slice(0, 8)
          .map((panel) =>
            panel.id === 'coupling-build'
              ? { ...panel, running_animation: 'telemetry-bloom' }
              : panel,
          ),
      }
      await page.setViewportSize({ width: 1000, height: 1000 })
      await stubDashboard(page, board)
      await page.addInitScript(() => {
        window.env = { ...window.env, security: 'warning' }
      })
      await page.route('**/api/panel/**', (route) => {
        const panelId = decodeURIComponent(
          new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
        )
        const panel = board.panels.find((candidate) => candidate.id === panelId)
        const completed = pipelineEnvelope(panelId)
        const body =
          panelId === 'coupling-build'
            ? {
                ...completed,
                signal: {
                  ...completed.signal,
                  status: 'running',
                  rawStatus: 'in_progress',
                  runStartedAt: '2026-08-24T13:58:00.000Z',
                  estimatedDurationMs: 2_000,
                },
              }
            : panel?.type === 'pipeline-status'
              ? completed
              : valueEnvelope(panelId)
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
      })

      return { board }
    },
    exercise: async () => {
      await page.goto('/')
    },
    verify: async (_navigation, { board }) => {
      await expect(page.locator('[data-panel]')).toHaveCount(board.panels.length)
      await expect(page.locator('[data-panel-link]')).toHaveCount(board.panels.length)
      await expect(page.locator('[data-panel-id="coupling-build"]')).toContainText('Running')
      await expect(
        page.locator(
          '[data-panel-id="coupling-build"] [data-running-field][data-animation="telemetry-bloom"]',
        ),
      ).toBeVisible()
      await expect(page.getByText('Security: unsecured')).toBeVisible()

      const layout = await renderedPanelGrid(page)

      // The scan surface has two ordered columns and four rows, without clipping readable evidence.
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewport)
      expect(layout.panels.map((panel) => panel.id)).toEqual(board.panels.map((panel) => panel.id))
      expect(new Set(layout.panels.map((panel) => panel.left)).size).toBe(2)
      expect(new Set(layout.panels.map((panel) => panel.top)).size).toBe(4)
      expect(layout.panels.every((panel) => panel.right <= layout.viewport)).toBe(true)
      expect(layout.panels.every((panel) => panel.readableContentFits)).toBe(true)

      // Completed cards read top-to-bottom; the status no longer occupies the evidence band's space.
      expect(await compactStatusReadingOrder(page.locator('[data-panel-id="jsmints-build"]'))).toBe(
        true,
      )

      // A running field remains decorative: its readable text stays in its containing card.
      const runningText = await Promise.all(
        ['[data-panel-identity-text]', '[data-panel-status]', '[data-panel-meta]'].map((selector) =>
          renderedTextGeometry(
            page.locator(`[data-panel-id="coupling-build"] ${selector}`).first(),
          ),
        ),
      )
      expect(runningText.every((text) => text.visible && text.contained)).toBe(true)

      // Deployment posture remains separate from the panel scan surface.
      await expect(page.locator('aside[role="alert"]')).toBeVisible()
      expect(await securityNoticeHasHeaderRow(page)).toBe(true)
    },
  }))

test('keeps four independently sourced facts readable inside one compact portrait panel', ({
  page,
}) =>
  mint({
    setup: async () => {
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
            position: { x: 0, y: 0, w: 1, h: 12 },
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
      return { facts }
    },
    exercise: async () => {
      await page.goto('/')
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
          factCount: facts.length,
        }
      })
      const sourceCounts = await Promise.all(
        ['API', 'Web', 'Worker', 'Docs'].map((label) =>
          page.locator(`[aria-label="View source for ${label} (opens in a new tab)"]`).count(),
        ),
      )
      return { layout, sourceCounts }
    },
    verify: ({ layout, sourceCounts }, { facts }) => {
      expect(layout).toEqual({ fits: true, factsFit: true, factCount: facts.length })
      expect(sourceCounts).toEqual(facts.map(() => 1))
    },
  }))

test('keeps HTTP-value portrait tiles symbol-led while restoring an upright pipeline title', ({
  page,
}) =>
  mint({
    setup: async () => {
      const board = {
        panels: [
          {
            id: 'build',
            label: 'Production build',
            type: 'pipeline-status',
            position: { x: 0, y: 0, w: 1, h: 12 },
          },
          {
            id: 'version',
            label: 'Release version',
            type: 'http-value',
            position: { x: 1, y: 0, w: 1, h: 12 },
          },
        ],
      }
      await page.setViewportSize({ width: 2400, height: 1200 })
      await stubDashboard(page, board)
      await page.route('**/api/panel/**', (route) => {
        const panelId = decodeURIComponent(
          new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
        )
        return route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(
            panelId === 'build' ? pipelineEnvelope(panelId) : valueEnvelope(panelId),
          ),
        })
      })
      return { board }
    },
    exercise: async ({ board }) => {
      await page.goto('/')
      return Promise.all(
        board.panels.map(async ({ id: panelId }) => {
          const tile = page.locator(`[data-panel-id="${panelId}"]`)
          await tile.locator('[data-panel-status] [aria-hidden="true"]').waitFor()
          const compact = await tile.evaluate((panel) => ({
            label: panel.querySelector('h2')?.textContent,
            fits: panel.scrollHeight <= panel.clientHeight,
            writingMode: getComputedStyle(panel.querySelector('h2') as Element).writingMode,
            typeGlyphVisible:
              getComputedStyle(panel.querySelector('[data-panel-type-glyph]') as Element)
                .display !== 'none',
            stateGlyph: getComputedStyle(
              panel.querySelector('[data-panel-status] [aria-hidden="true"]') as Element,
            ).display,
          }))
          return {
            id: panelId,
            compact,
            title: await renderedTextGeometry(tile.locator('[data-panel-identity-text]')),
          }
        }),
      )
    },
    verify: (presentations) => {
      expect(presentations.map(({ id }) => id)).toEqual(['build', 'version'])
      for (const { compact } of presentations)
        expect(compact).toMatchObject({
          fits: true,
          writingMode: 'horizontal-tb',
          typeGlyphVisible: true,
          stateGlyph: 'inline-block',
        })
      expect(presentations[0]?.compact.label).toContain('Production build')
      expect(presentations[0]?.title.visible).toBe(true)
      expect(presentations[1]?.compact.label).toContain('Release version')
      expect(presentations[1]?.title.visible).toBe(false)
    },
  }))

test('adapts density independently across wide, square, narrow, and tall cells', ({ page }) =>
  mint({
    setup: async () => {
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
      return { densityBoard }
    },
    exercise: async ({ densityBoard }) => {
      await page.goto('/')
      await Promise.all(
        densityBoard.panels.map(({ id }) =>
          page
            .locator(`[data-panel-id="${id}"] [data-panel-status] [aria-hidden="true"]`)
            .waitFor(),
        ),
      )
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
      const sourceCorner = await page
        .locator('[data-panel-id="compact-narrow"]')
        .evaluate((panel) => {
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
      return { layout, sourceCorner, expectedIds: densityBoard.panels.map(({ id }) => id) }
    },
    verify: ({ layout, sourceCorner, expectedIds }) => {
      expect(layout.map((panel) => panel.id)).toEqual(expectedIds)
      expect(layout.find((panel) => panel.id === 'wide')?.metadataDisplay).toBe('block')
      expect(layout.find((panel) => panel.id === 'compact-narrow')?.metadataDisplay).toBe('flex')
      expect(layout.find((panel) => panel.id === 'auto-narrow')?.metadataDisplay).toBe('flex')
      expect(layout.find((panel) => panel.id === 'auto-tall')?.metadataDisplay).toBe('flex')
      expect(layout.every((panel) => panel.fits && panel.right <= 2400)).toBe(true)
      expect(
        layout.every((panel, index) => index === 0 || panel.left >= layout[index - 1].right),
      ).toBe(true)
      expect(sourceCorner.textOverlapsAction).toBe(false)
    },
  }))

test('uses readable primary symbols in a narrow tall pull-request tile while retaining normal and wide cards', ({
  page,
}) =>
  mint({
    setup: async () => {
      const board = {
        panels: [
          {
            id: 'updates-tall',
            label: 'Dependency update health',
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
      // Match the narrow tiles on the wall display rather than only the roomier test viewport.
      await page.setViewportSize({ width: 1728, height: 1728 })
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

      return { board }
    },
    exercise: async () => {
      await page.goto('/')
    },
    verify: async (_navigation, { board }) => {
      await expect(page.locator('[data-panel]')).toHaveCount(board.panels.length)
      await expect(page.locator('[data-panel][aria-busy="true"]')).toHaveCount(0)

      const presentation = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-panel]')].map((panel) => {
          const rect = (selector: string) =>
            panel.querySelector<HTMLElement>(selector)?.getBoundingClientRect()
          const label = rect('h2')
          const status = rect('[data-panel-anchor="status"]')
          const evidence = rect('[data-panel-anchor="evidence"]')
          const panelRect = panel.getBoundingClientRect()
          return {
            id: panel.dataset.panelId,
            facts: getComputedStyle(panel.querySelector('[data-compact-facts]') as Element).display,
            summary: getComputedStyle(
              panel.querySelector('[data-compact-facts]')?.previousElementSibling as Element,
            ).position,
            fits: panel.scrollHeight <= panel.clientHeight,
            anchors:
              label && status && evidence
                ? {
                    panelTop: panelRect.top,
                    panelHeight: panelRect.height,
                    labelTop: label.top,
                    labelBottom: label.bottom,
                    statusTop: status.top,
                    statusBottom: status.bottom,
                    evidenceTop: evidence.top,
                    labelWritingMode: getComputedStyle(panel.querySelector('h2') as Element)
                      .writingMode,
                    typeGlyphVisible:
                      getComputedStyle(panel.querySelector('[data-panel-type-glyph]') as Element)
                        .display !== 'none',
                    statusGlyphVisible:
                      getComputedStyle(
                        panel.querySelector('[data-panel-status] [aria-hidden="true"]') as Element,
                      ).display !== 'none',
                  }
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
      expect(tallAnchors?.labelBottom).toBeLessThan(
        tallAnchors?.statusTop ?? Number.NEGATIVE_INFINITY,
      )
      expect(tallAnchors?.labelWritingMode).toBe('horizontal-tb')
      expect(tallAnchors?.typeGlyphVisible).toBe(true)
      expect(tallAnchors?.statusGlyphVisible).toBe(true)
      const tallTitle = await renderedTextGeometry(
        page.locator('[data-panel-id="updates-tall"] [data-panel-identity-text]'),
      )
      expect(tallTitle.visible).toBe(true)
      expect(tallTitle.width).toBeGreaterThan(10)
      expect(tallTitle.height).toBeGreaterThan(10)
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
    },
  }))

test('aligns health-panel state markers while keeping unequal titles upright and contained', ({
  page,
}) =>
  mint({
    setup: async () => {
      const board = {
        panels: [
          {
            id: 'build-health',
            label: 'Production deployment verification',
            type: 'pipeline-status',
            position: { x: 0, y: 0, w: 6, h: 8 },
          },
          {
            id: 'update-health',
            label: 'Dependency update pull request health',
            type: 'pull-request-health',
            position: { x: 6, y: 0, w: 6, h: 8 },
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
          body: JSON.stringify(
            path.includes('update-health')
              ? pullRequestHealthEnvelope(panelId)
              : {
                  panelId,
                  state: 'error',
                  observedAt: '2026-09-11T12:00:00.000Z',
                  link: 'https://ci.example.com/production',
                  error: { kind: 'unreachable', message: 'Build authority is unavailable.' },
                },
          ),
        })
      })

      return { board }
    },
    exercise: async () => {
      await page.goto('/')
    },
    verify: async (_navigation, { board }) => {
      await expect(page.locator('[data-panel]')).toHaveCount(board.panels.length)
      await expect(page.locator('[data-panel][aria-busy="true"]')).toHaveCount(0)
      const geometry = await page.locator('[data-panel]').evaluateAll((panels) =>
        panels.map((panel) => {
          const marker = panel.querySelector<HTMLElement>('[data-panel-anchor="status"]')
          const markerRect = marker?.getBoundingClientRect()
          return {
            fits: panel.scrollHeight <= panel.clientHeight,
            markerCenter: markerRect ? markerRect.top + markerRect.height / 2 : Number.NaN,
          }
        }),
      )

      expect(geometry.every((panel) => panel.fits)).toBe(true)
      const titles = await Promise.all(
        board.panels.map(({ id: panelId }) =>
          renderedTextGeometry(
            page.locator(`[data-panel-id="${panelId}"] [data-panel-identity-text]`),
          ),
        ),
      )
      expect(titles.every((title) => title.visible && title.contained)).toBe(true)
      expect(geometry).toHaveLength(2)
      const [pipeline, pullRequest] = geometry
      if (!pipeline || !pullRequest) throw new Error('Expected both health panels to render')
      expect(Math.abs(pipeline.markerCenter - pullRequest.markerCenter)).toBeLessThanOrEqual(2)
    },
  }))

test('stacks build and pull-request evidence readably on narrow viewports', ({ page }) =>
  mint({
    setup: async () => {
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
      return { board }
    },
    exercise: async () => {
      await page.goto('/')
    },
    verify: async (_navigation, { board }) => {
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
    },
  }))

test('fits populated single-screen team layout without clipping required content', ({ page }) =>
  mint({
    setup: async () => {
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
    },
    exercise: async () => {
      await page.goto('/')
    },
    verify: async () => {
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
      expect(
        buildRows.every((panel) => panel.right - panel.left > layout.viewport.width * 0.9),
      ).toBe(true)
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
    },
  }))
