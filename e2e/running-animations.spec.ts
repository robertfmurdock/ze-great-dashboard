import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { stubDashboard } from './client-support'

/** Reads a full-panel field's rendered bounds and the readable layer above it. */
async function runningFieldGeometry(field: Locator) {
  return field.evaluate((element) => {
    const panel = element.closest<HTMLElement>('[data-panel]')
    if (!panel) throw new Error('Expected running field to be inside a panel')
    const content = panel.querySelector<HTMLElement>('[data-panel-content]')
    return {
      panel: panel.getBoundingClientRect().toJSON(),
      field: element.getBoundingClientRect().toJSON(),
      contentZIndex: content ? getComputedStyle(content).zIndex : 'auto',
    }
  })
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
    {
      id: 'snowman-build',
      type: 'pipeline-status',
      running_animation: 'snowman',
      position: { x: 2, y: 26, w: 2, h: 2 },
    },
    {
      id: 'weather-medium-build',
      type: 'pipeline-status',
      running_animation: 'status-weather',
      position: { x: 4, y: 26, w: 2, h: 5 },
    },
    {
      id: 'weather-narrow-build',
      type: 'pipeline-status',
      running_animation: 'status-weather',
      position: { x: 6, y: 26, w: 1, h: 5 },
    },
    {
      id: 'flight-build',
      type: 'pipeline-status',
      running_animation: 'flight-path',
      position: { x: 7, y: 26, w: 2, h: 5 },
    },
    {
      id: 'flight-normal-build',
      type: 'pipeline-status',
      running_animation: 'flight-path',
      position: { x: 9, y: 26, w: 2, h: 5 },
    },
  ],
}

/** A live pipeline response with deliberate normal or overdue timing. */
function runningPipelineEnvelope(
  panelId: string,
  {
    elapsedMs = 0,
    estimatedDurationMs = 300_000,
  }: { elapsedMs?: number; estimatedDurationMs?: number } = {},
) {
  const now = Date.now()
  return {
    panelId,
    state: 'ok' as const,
    observedAt: new Date(now).toISOString(),
    link: null,
    signal: {
      type: 'pipeline-status' as const,
      status: 'running' as const,
      rawStatus: 'in_progress',
      name: 'Build',
      runStartedAt: new Date(now - elapsedMs).toISOString(),
      estimatedDurationMs,
    },
  }
}

async function stubRunningFields(page: Page) {
  const runningSignal = runningPipelineEnvelope('live-build')
  await stubDashboard(page, signalFieldBoard)
  await page.route('**/api/panel/**', (route) => {
    const panelId = decodeURIComponent(
      new URL(route.request().url()).pathname.split('/').at(-1) ?? '',
    )
    const envelope =
      panelId === 'flight-build'
        ? runningPipelineEnvelope(panelId, { elapsedMs: 360_000 })
        : { ...runningSignal, panelId }
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(envelope),
    })
  })

  await page.setViewportSize({ width: 1440, height: 900 })
}

test('renders panel-scale running fields behind readable content', ({ page }) =>
  mint({
    setup: async () => {
      await stubRunningFields(page)
    },
    exercise: async () => {
      await page.goto('/')
    },
    verify: async () => {
      const field = page.locator('[data-running-field][data-animation="telemetry-bloom"]').first()
      await expect(field).toBeVisible()
      const large = await runningFieldGeometry(field)
      const packetAnimation = await field
        .locator('[data-running-part="bloom-marker"]')
        .first()
        .evaluate((element) => getComputedStyle(element).animationName)
      expect(large.panel).toBeTruthy()
      expect(large.field.left).toBeGreaterThanOrEqual(large.panel.left)
      expect(large.field.bottom).toBeLessThanOrEqual(large.panel.bottom)
      expect(large.contentZIndex).not.toBe('auto')
      expect(packetAnimation).not.toBe('none')

      // The compact decision must follow the panel's rendered width, not the viewport width.
      const narrowBloom = page
        .locator('[data-running-field][data-animation="telemetry-bloom"]')
        .nth(1)
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

      const snowman = page.locator('[data-running-field][data-animation="snowman"]')
      await expect(snowman).toBeVisible()
      const snowmanBounds = await runningFieldGeometry(snowman)
      expect(snowmanBounds.field.right).toBeLessThanOrEqual(snowmanBounds.panel.right)
      expect(snowmanBounds.field.bottom).toBeLessThanOrEqual(snowmanBounds.panel.bottom)
      await expect(snowman.locator('[data-running-part="snowman-canvas"]')).toBeVisible()

      const weather = page.locator('[data-running-field][data-animation="status-weather"]')
      await expect(weather).toHaveCount(2)
      const [mediumWeather, narrowWeather] = await Promise.all([
        runningFieldGeometry(weather.nth(0)),
        runningFieldGeometry(weather.nth(1)),
      ])
      const visibleTextureLayers = await weather.evaluateAll((fields) =>
        fields.map(
          (field) =>
            // Full weather is one haze layer, three pressure bands, and five drifters.
            [...field.querySelectorAll('span')].filter(
              (part) => getComputedStyle(part).display !== 'none',
            ).length,
        ),
      )
      expect(mediumWeather.panel.width).toBeGreaterThan(10 * 16)
      expect(mediumWeather.panel.width).toBeLessThan(40 * 16)
      expect(mediumWeather.panel.height).toBeGreaterThan(6 * 16)
      expect(visibleTextureLayers[0]).toBe(9)
      expect(mediumWeather.field.left).toBeGreaterThanOrEqual(mediumWeather.panel.left)
      expect(mediumWeather.field.right).toBeLessThanOrEqual(mediumWeather.panel.right)
      expect(mediumWeather.contentZIndex).not.toBe('auto')
      expect(narrowWeather.panel.width).toBeLessThan(10 * 16)
      expect(narrowWeather.panel.height).toBeGreaterThan(6 * 16)
      expect(visibleTextureLayers[1]).toBe(1)

      const flight = page.locator(
        '[data-running-field][data-animation="flight-path"][data-overdue="true"]',
      )
      await expect(flight).toBeVisible()
      await expect(flight.locator('[data-running-part="flight-path"]')).toHaveAttribute(
        'data-flight-stage',
        'approach',
      )
      await expect(flight).toHaveAttribute('data-overdue', 'true')
      await expect(flight.locator('[data-running-part="flight-cloud"]')).toHaveCount(8)
      await expect(flight.locator('[data-running-part="flight-cloud-layer"]')).toHaveCount(2)
      await expect(flight.locator('[data-running-part="flight-ground"]')).toHaveCount(1)
      await expect(flight.locator('[data-running-part="flight-ground-terrain"]')).toHaveCount(1)
      await expect(flight.locator('[data-running-part="flight-ground-overdrive"]')).toHaveCount(1)
      await expect(flight.locator('[data-running-part="flight-ground-runway"]')).toHaveCount(1)
      await expect(flight.locator('[data-running-part="flight-plane"] svg')).toBeVisible()
      await expect(flight.locator('[data-running-part="flight-fuselage"]')).toHaveCount(1)
      await expect(flight.locator('[data-running-part="flight-wing"]')).toHaveCount(1)
      await expect(flight.locator('[data-running-part="flight-tail"]')).toHaveCount(1)
      await expect(flight.locator('svg[viewBox="0 0 100 100"]')).toHaveCount(0)
      const flightFraming = await flight.evaluate((element) => {
        const plane = element.querySelector<HTMLElement>('[data-running-part="flight-plane"]')
        const runway = element.querySelector<HTMLElement>(
          '[data-running-part="flight-ground-runway"]',
        )
        const field = element.getBoundingClientRect()
        const planeBounds = plane?.getBoundingClientRect()
        const runwayBounds = runway?.getBoundingClientRect()
        return {
          planeCenterX: planeBounds ? (planeBounds.left + planeBounds.right) / 2 - field.left : 0,
          planeCenterY: planeBounds ? (planeBounds.top + planeBounds.bottom) / 2 - field.top : 0,
          width: field.width,
          height: field.height,
          runwayBelowPlane: planeBounds && runwayBounds ? runwayBounds.top - planeBounds.bottom : 0,
        }
      })
      // The bounding box includes the swept wing and slight approach pitch, so use a visual center band.
      expect(Math.abs(flightFraming.planeCenterX - flightFraming.width / 2)).toBeLessThan(
        flightFraming.width * 0.05,
      )
      expect(Math.abs(flightFraming.planeCenterY - flightFraming.height / 2)).toBeLessThan(
        flightFraming.height * 0.08,
      )
      expect(flightFraming.runwayBelowPlane).toBeGreaterThan(8)
      expect(
        await flight
          .locator('[data-running-part="flight-plane"]')
          .evaluate((element) => getComputedStyle(element).animationName),
      ).not.toBe('none')

      const normalFlight = page.locator(
        '[data-running-field][data-animation="flight-path"]:not([data-overdue])',
      )
      await expect(normalFlight).toBeVisible()
      const [normalVelocity, overdueVelocity] = await Promise.all(
        [normalFlight, flight].map(async (field) =>
          field.locator('[data-running-part="flight-ground"]').evaluate((element) => {
            const terrain = element.querySelector<HTMLElement>(
              '[data-running-part="flight-ground-terrain"]',
            )
            const overdrive = element.querySelector<HTMLElement>(
              '[data-running-part="flight-ground-overdrive"]',
            )
            return {
              terrainAnimation: terrain ? getComputedStyle(terrain).animationName : 'none',
              terrainDuration: terrain
                ? Number.parseFloat(getComputedStyle(terrain).animationDuration)
                : 0,
              overdriveAnimation: overdrive ? getComputedStyle(overdrive).animationName : 'none',
              overdriveDuration: overdrive
                ? Number.parseFloat(getComputedStyle(overdrive).animationDuration)
                : 0,
              overdriveOpacity: overdrive
                ? Number.parseFloat(getComputedStyle(overdrive).opacity)
                : 0,
            }
          }),
        ),
      )
      expect(normalVelocity.terrainAnimation).not.toBe('none')
      expect(overdueVelocity.terrainDuration).toBe(normalVelocity.terrainDuration)
      expect(overdueVelocity.overdriveAnimation).not.toBe('none')
      expect(overdueVelocity.overdriveDuration).toBeLessThan(overdueVelocity.terrainDuration)
      expect(overdueVelocity.overdriveOpacity).toBeGreaterThan(normalVelocity.overdriveOpacity)
      const groundTravel = await flight
        .locator('[data-running-part="flight-ground-terrain"]')
        .evaluate(async (element) => {
          const before = element.getBoundingClientRect().left
          await new Promise<void>((resolve) => {
            let frames = 12
            const nextFrame = () => {
              frames -= 1
              if (frames === 0) resolve()
              else requestAnimationFrame(nextFrame)
            }
            requestAnimationFrame(nextFrame)
          })
          return Math.abs(element.getBoundingClientRect().left - before)
        })
      expect(groundTravel).toBeGreaterThan(0)

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
      // Activity inspection is an on-demand overlay, so the primary grid keeps its full footprint.
      expect(legacySignalLayout.visualHeight).toBeGreaterThan(70)
      expect(legacySignalLayout.tracksDisplay).toBe('flex')
    },
  }))

test('adapts a running board to resizing and reduced motion', ({ page }) =>
  mint({
    setup: async () => {
      await stubRunningFields(page)
      await page.goto('/')
      await page.locator('[data-running-field][data-animation="telemetry-bloom"]').first().waitFor()
      await page
        .locator('[data-running-field][data-animation="flight-path"][data-overdue="true"]')
        .waitFor()
    },
    exercise: async () => {
      const field = page.locator('[data-running-field][data-animation="telemetry-bloom"]').first()
      const wideViewport = page.viewportSize()
      if (!wideViewport) throw new Error('Expected a configured viewport')
      const measure = () =>
        field.evaluate((element) => {
          const lanes = element.querySelector<HTMLElement>('[data-running-part="bloom-lanes"]')
          return {
            lanesVisible: lanes ? getComputedStyle(lanes).display !== 'none' : false,
            documentWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth,
          }
        })
      const wide = await measure()
      const narrow = await test.step('Resize the running board', async () => {
        await page.setViewportSize({ width: 390, height: 844 })
        return measure()
      })
      await test.step('Restore the wide viewport and enable reduced motion', async () => {
        await page.setViewportSize(wideViewport)
        await page.emulateMedia({ reducedMotion: 'reduce' })
      })
      return { wide, narrow }
    },
    verify: async ({ wide, narrow }) => {
      expect(wide.lanesVisible).toBe(true)
      expect(narrow.lanesVisible).toBe(false)
      expect(narrow.documentWidth).toBeLessThanOrEqual(narrow.viewportWidth)
      const field = page.locator('[data-running-field][data-animation="telemetry-bloom"]').first()
      const snowman = page.locator('[data-running-field][data-animation="snowman"]')
      const legacySignal = page.locator('[data-running-progress="signal-field"]')
      const flight = page.locator(
        '[data-running-field][data-animation="flight-path"][data-overdue="true"]',
      )
      await expect(snowman.locator('[data-running-part="snowman-field"]')).toHaveAttribute(
        'data-reduced-motion',
        'true',
      )
      await expect(snowman.locator('[data-running-part="snowman-canvas"]')).toBeVisible()
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
      expect(
        await flight
          .locator('[data-running-part="flight-plane"]')
          .evaluate((element) => getComputedStyle(element).animationName),
      ).toBe('none')
      await expect(page.locator('[data-panel-content]').first()).toContainText('Elapsed')
    },
  }))

test('keeps phased signal and bloom markers continuous while progress updates and reverses', ({
  page,
}) =>
  mint({
    setup: async () => {
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
      const runningSignal = runningPipelineEnvelope('motion-build', { elapsedMs: 120_000 })
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
    },
    exercise: async () => {
      await page.goto('/')
      await page.locator('[data-running-part="bloom-marker"]').first().waitFor()
      await page.locator('[data-running-part="signal-marker"]').first().waitFor()

      const sample = () =>
        page.evaluate(() => {
          const read = (bodyPart: string, anchorPart: string) => {
            const body = document.querySelector<HTMLElement>(`[data-running-part="${bodyPart}"]`)
            const anchor = document.querySelector<HTMLElement>(
              `[data-running-part="${anchorPart}"]`,
            )
            const field = body?.closest<HTMLElement>(
              '[data-running-field], [data-running-progress]',
            )
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
              animationStartTime: animation?.startTime ?? Number.NaN,
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
              const marker = document.querySelector<HTMLElement>(
                '[data-running-part="bloom-marker"]',
              )
              if (!marker) {
                reject(new Error('bloom marker did not mount'))
                return
              }
              marker.addEventListener('animationiteration', () => resolve(), { once: true })
            }),
        )

      // The panels mount independently; sample only once each visible marker has a live animation.
      await page.waitForFunction(() =>
        ['bloom-marker', 'signal-marker'].every(
          (part) =>
            document.querySelector<HTMLElement>(`[data-running-part="${part}"]`)?.getAnimations()[0]
              ?.startTime != null,
        ),
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
      return samples
    },
    verify: async (samples) => {
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
        expect(
          positions.every((entry) => entry.animationStartTime === positions[0]?.animationStartTime),
          diagnostics,
        ).toBe(true)
        expect(Number.parseFloat(positions.at(-1)?.progress ?? ''), diagnostics).toBeGreaterThan(
          Number.parseFloat(positions[0]?.progress ?? ''),
        )
      }
      expect(
        samples.map((entry) => entry.bloom.animationName),
        diagnostics,
      ).toEqual(samples.map((entry) => entry.signal.animationName))
    },
  }))

test('keeps the focused signal-field demo expanded at panel scale', ({ page }) =>
  mint({
    setup: async () => {
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
      return { reviewBoard }
    },
    exercise: async () => {
      await page.goto('/')
      return page.locator('[data-running-progress="signal-field"]').evaluate((element) => {
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
    },
    verify: (geometry) => {
      expect(geometry.visualWidth).toBeGreaterThan(geometry.panelWidth * 0.8)
      expect(geometry.visualHeight).toBeGreaterThan(geometry.panelHeight * 0.5)
      expect(geometry.tracksDisplay).toBe('flex')
    },
  }))

test('keeps signal-field expanded through a medium-width wallboard card without reserving a timer column', ({
  page,
}) =>
  mint({
    setup: async () => {
      const reviewBoard = {
        panels: [
          {
            id: 'signal-field-medium-review',
            type: 'pipeline-animation-demo',
            running_animation: 'signal-field',
            position: { x: 0, y: 0, w: 3, h: 12 },
          },
        ],
      }
      await stubDashboard(page, reviewBoard)
      await page.setViewportSize({ width: 1440, height: 900 })
      return { reviewBoard }
    },
    exercise: async () => {
      await page.goto('/')
      return page.locator('[data-running-progress="signal-field"]').evaluate((element) => {
        const visual = element
          .querySelector<HTMLElement>('[data-running-visual]')
          ?.getBoundingClientRect()
        const timing = element.querySelector<HTMLElement>('p')?.getBoundingClientRect()
        const tracks = element.querySelector<HTMLElement>('[data-running-part="signal-tracks"]')
        const progress = element.getBoundingClientRect()
        return {
          visualWidth: visual?.width ?? 0,
          visualTop: visual?.top ?? 0,
          timingWidth: timing?.width ?? 0,
          timingTop: timing?.top ?? 0,
          progressWidth: progress.width,
          tracksDisplay: tracks ? getComputedStyle(tracks).display : 'none',
        }
      })
    },
    verify: (geometry) => {
      expect(geometry.tracksDisplay).toBe('flex')
      expect(geometry.visualWidth).toBeGreaterThan(geometry.progressWidth * 0.9)
      expect(geometry.timingTop).toBeGreaterThan(geometry.visualTop)
      expect(geometry.timingWidth).toBeLessThan(geometry.visualWidth)
    },
  }))

test('keeps the animation demo legible in a portrait panel', ({ page }) =>
  mint({
    setup: async () => {
      const panel = {
        id: 'portrait-motion-review',
        label: 'Motion review',
        type: 'pipeline-animation-demo',
        running_animation: 'radial',
        position: { x: 0, y: 0, w: 1, h: 12 },
      }
      await stubDashboard(page, { panels: [panel] })
      await page.setViewportSize({ width: 2400, height: 1200 })
      return { panel }
    },
    exercise: async () => {
      await page.goto('/')
      return page.locator('[data-panel-id="portrait-motion-review"]').evaluate((panel) => {
        const label = panel.querySelector('h2')?.getBoundingClientRect()
        const status = panel.querySelector('[class*="status"]')
        return {
          fits: panel.scrollHeight <= panel.clientHeight,
          labelHeight: label?.height ?? 0,
          labelWidth: label?.width ?? 0,
          status: status?.textContent,
        }
      })
    },
    verify: (presentation) => {
      expect(presentation.fits).toBe(true)
      expect(presentation.labelHeight).toBeGreaterThan(presentation.labelWidth)
      expect(presentation.status).toContain('Running')
    },
  }))

test('keeps the showcase signal-field visual inside its three-row panel', ({ page }) =>
  mint({
    setup: async () => {
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
      return { showcaseBoard }
    },
    exercise: async () => {
      await page.goto('/')
      return page.locator('[data-running-progress="signal-field"]').evaluate((element) => {
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
    },
    verify: (geometry) => {
      expect(geometry.visualBottom).toBeLessThanOrEqual(geometry.panelBottom)
      expect(geometry.panelFits).toBe(true)
      expect(geometry.tracksDisplay).toBe('flex')
    },
  }))
