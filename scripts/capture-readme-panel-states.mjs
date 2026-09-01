import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { setTimeout as wait } from 'node:timers/promises'
import { chromium } from '@playwright/test'
import {
  readmePanelStateEnvelopes,
  readmePanelStatesBoard,
} from './readme-panel-states-fixtures.mjs'

const root = resolve(new URL('..', import.meta.url).pathname)
const output = resolve(root, 'docs/assets/readme-panel-states.png')
const clientPort = 5174
const serverPort = 3001

const client = spawn(
  'npm',
  [
    'run',
    'dev',
    '--workspace',
    '@continuous-excellence/ze-great-dashboard-client',
    '--',
    '--host',
    '127.0.0.1',
    '--port',
    String(clientPort),
  ],
  { cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: true },
)
const server = spawn('npm', ['run', 'dev', '--workspace', '@ze-great-dashboard/server'], {
  cwd: root,
  env: {
    ...process.env,
    ASSET_PATH: `http://127.0.0.1:${clientPort}/__ASSET_PATH__`,
    BOARD_CONFIG_URL: resolve(root, 'boards/readme-panel-states.yaml'),
    BOARD: 'readme-panel-states',
    PORT: String(serverPort),
    HOST: '127.0.0.1',
    TEMPLATE_WAIT_MS: '20000',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
})

let serverOutput = ''
for (const process of [client, server]) {
  process.stdout.on('data', (chunk) => {
    serverOutput += chunk
  })
  process.stderr.on('data', (chunk) => {
    serverOutput += chunk
  })
}

let browser
try {
  browser = await chromium.launch()
  await waitForServer(`http://127.0.0.1:${serverPort}/health`)
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  await page.clock.install({ time: new Date('2026-08-27T14:00:00.000Z') })
  await page.emulateMedia({ reducedMotion: 'reduce' })

  const unexpectedRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      unexpectedRequests.push(request.url())
    }
  })
  await page.route('**/api/boards/readme-panel-states', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(readmePanelStatesBoard),
    }),
  )
  await page.route('**/api/panel/**', (route) => {
    const panelId = new URL(route.request().url()).pathname.split('/').pop()
    const envelope = readmePanelStateEnvelopes[panelId]
    if (!envelope) throw new Error(`No README fixture for panel ${panelId}`)
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(envelope) })
  })

  await page.goto(`http://127.0.0.1:${serverPort}/`, { waitUntil: 'networkidle' })
  await page.locator('[data-panel]').nth(5).waitFor()
  await page.screenshot({ path: output })

  if (unexpectedRequests.length > 0) {
    throw new Error(`Capture made unexpected external requests: ${unexpectedRequests.join(', ')}`)
  }
  const labels = await page.locator('[data-panel] h2').allTextContents()
  if (labels.length !== 6) throw new Error(`Expected six panels, captured ${labels.length}`)
  console.log(`Captured ${labels.join(', ')}`)
} catch (error) {
  console.error(serverOutput)
  throw error
} finally {
  await browser?.close()
  terminate(client)
  terminate(server)
}

console.log(`Wrote ${output}`)

async function waitForServer(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {
      // The Vite and application servers start independently.
    }
    await wait(250)
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function terminate(child) {
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}
