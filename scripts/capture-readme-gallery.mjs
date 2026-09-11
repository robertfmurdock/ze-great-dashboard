import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import { readmeGalleryScenarios } from './readme-gallery-fixtures.mjs'

const scenarioName = process.argv[2]
const scenario = readmeGalleryScenarios[scenarioName]
if (!scenario) throw new Error(`Choose one of: ${Object.keys(readmeGalleryScenarios).join(', ')}`)

const root = resolve(new URL('..', import.meta.url).pathname)
const output = resolve(root, scenario.output)
const scenarioOffset = Object.keys(readmeGalleryScenarios).indexOf(scenarioName)
// Vite's development base is deliberately fixed at this sentinel-serving capture port. Each
// application server still gets its own port below, so an incomplete prior capture cannot leak
// its deployment posture or board into the next scenario.
const clientPort = 5174
const serverPort = 3001 + scenarioOffset
const clientOrigin = `http://127.0.0.1:${clientPort}`
const serverOrigin = `http://127.0.0.1:${serverPort}`
const browserBoard = scenarioName === 'warning' ? 'security' : 'readme-panel-states'
let processOutput = ''
const bin = resolve(root, 'node_modules', '.bin')
const client =
  scenarioName === 'blocked'
    ? undefined
    : start(resolve(bin, 'vite'), [
        '--host',
        '127.0.0.1',
        '--port',
        String(clientPort),
        '--strictPort',
      ])
const server = start(resolve(bin, 'tsx'), [resolve(root, 'packages/server/src/node-server.ts')], {
  ASSET_PATH: `${clientOrigin}/__ASSET_PATH__`,
  BOARD_CONFIG_URL: resolve(root, scenario.boardConfig ?? 'boards/readme-panel-states.yaml'),
  BOARD: scenarioName === 'blocked' ? 'readme-authentication-required' : 'readme-panel-states',
  PORT: String(serverPort),
  HOST: scenario.host ?? '127.0.0.1',
  TEMPLATE_WAIT_MS: '20000',
})

let browser
try {
  browser = await chromium.launch()
  await waitForServer(`${serverOrigin}/health`)
  const page = await browser.newPage({ viewport: scenario.viewport, deviceScaleFactor: 1 })
  await page.clock.install({ time: new Date('2026-08-27T14:00:00.000Z') })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  if (scenarioName === 'warning') {
    await page.addInitScript(() => {
      let configuredEnv
      Object.defineProperty(window, 'env', {
        configurable: true,
        get: () => configuredEnv,
        set: (value) => {
          configuredEnv = { ...value, board: 'security', security: 'warning' }
        },
      })
    })
  }

  const unexpectedRequests = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1') {
      unexpectedRequests.push(url.href)
      await route.abort('blockedbyclient')
      return
    }
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const board = scenarioName === 'blocked' ? 'readme-authentication-required' : browserBoard
    if (url.pathname === `/api/boards/${board}`) {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(scenario.board),
      })
    }
    if (url.pathname === '/api/client') {
      return route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ assetPath: clientOrigin }),
      })
    }
    const panelId = url.pathname.split('/').pop()
    const envelope = scenario.envelopes[panelId]
    if (envelope)
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope) })
    throw new Error(`No intercepted fixture response for ${url.pathname}`)
  })

  await page.goto(`${serverOrigin}/`, { waitUntil: 'domcontentloaded' })
  await page.locator(scenario.ready).waitFor()
  if (scenario.expectedAlertLabel) {
    const alertLabel = await page.locator('[role="alert"]').first().getAttribute('aria-label')
    if (alertLabel !== scenario.expectedAlertLabel)
      throw new Error(
        `${scenarioName} expected alert label ${JSON.stringify(scenario.expectedAlertLabel)}, got ${JSON.stringify(alertLabel)}`,
      )
  }
  for (const expected of scenario.expectedText) {
    if (!(await page.locator('body').getByText(expected, { exact: false }).count()))
      throw new Error(`${scenarioName} did not render ${JSON.stringify(expected)}`)
  }
  if (scenario.expectsNoBoardData && (await page.locator('[data-panel]').count()) !== 0)
    throw new Error('Blocked authentication scenario rendered board data')
  if (unexpectedRequests.length > 0)
    throw new Error(`Capture attempted external requests: ${unexpectedRequests.join(', ')}`)
  await page.screenshot({ path: output })
  await assertPngDimensions(output, scenario.viewport)
} finally {
  await browser?.close()
  await Promise.all([...(client ? [terminate(client)] : []), terminate(server)])
}

console.log(`Wrote ${output}`)

function start(command, args, overrides = {}) {
  // Gallery evidence must not inherit an operator's deliberate deployment acknowledgement; that
  // would suppress the warning scenario and make the capture depend on the caller's shell.
  const { ALLOW_UNPROTECTED_DASHBOARD: _allowUnprotectedDashboard, ...captureEnvironment } =
    process.env
  const child = spawn(command, args, {
    cwd: root,
    env: { ...captureEnvironment, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => {
    processOutput += chunk
  })
  child.stderr.on('data', (chunk) => {
    processOutput += chunk
  })
  return child
}

async function waitForServer(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // The Vite and application servers start independently.
    }
    await wait(250)
  }
  throw new Error(`Timed out waiting for ${url}\n${processOutput}`)
}

async function terminate(child) {
  if (!child.pid || child.exitCode !== null) return
  child.kill('SIGTERM')
  await once(child, 'exit')
}

async function assertPngDimensions(path, expected) {
  const image = await readFile(path)
  const isPng = image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const width = image.readUInt32BE(16)
  const height = image.readUInt32BE(20)
  if (!isPng || width !== expected.width || height !== expected.height)
    throw new Error(
      `Expected ${expected.width} × ${expected.height} PNG, got ${width} × ${height} ${isPng ? 'PNG' : 'non-PNG'}`,
    )
}
