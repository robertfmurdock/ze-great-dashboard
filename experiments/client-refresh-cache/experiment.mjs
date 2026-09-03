import { execFileSync } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const clientDist = join(root, 'packages/client/dist')
const templatePath = join(clientDist, 'index.html')
const requireFromRoot = createRequire(join(root, 'package.json'))
const { chromium } = requireFromRoot('@playwright/test')

execFileSync(
  'npm',
  ['run', 'build', '--workspace', '@continuous-excellence/ze-great-dashboard-client'],
  {
    cwd: root,
    stdio: 'inherit',
  },
)

const template = await readFile(templatePath, 'utf8')
const state = { selected: 'a', cacheMode: 'cached', cachedEntry: undefined }
const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(error instanceof Error ? error.message : String(error))
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Experiment server did not bind')
const origin = `http://127.0.0.1:${address.port}`

try {
  await runHttpProbe()
  const browser = await chromium.launch().catch((error) => {
    console.error(
      `HTTP probe passed, but Chromium could not launch: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  })
  if (browser) {
    try {
      await runScenario(browser, 'cached', 'cached')
      await runScenario(browser, 'control', 'no-store')
    } finally {
      await browser.close()
    }
  }
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}

async function runHttpProbe() {
  state.selected = 'a'
  state.cacheMode = 'cached'
  state.cachedEntry = undefined
  const first = await (await fetch(`${origin}/`)).text()
  await control('/__control/deploy?version=b')
  const identity = await (await fetch(`${origin}/api/client`)).json()
  const cached = await (await fetch(`${origin}/`)).text()
  state.cacheMode = 'no-store'
  const fresh = await (await fetch(`${origin}/`)).text()
  const result = {
    scenario: 'http-only-cache-layer',
    identityAssetPath: identity.assetPath,
    firstDocument: marker(first),
    cachedDocumentAfterDeploy: marker(cached),
    freshDocumentAfterCacheDisabled: marker(fresh),
  }
  console.log(JSON.stringify(result, null, 2))
  if (
    result.firstDocument !== 'a' ||
    result.cachedDocumentAfterDeploy !== 'a' ||
    result.freshDocumentAfterCacheDisabled !== 'b' ||
    !result.identityAssetPath.endsWith('/client-b')
  ) {
    throw new Error('HTTP cache-layer probe did not reproduce the expected stale entrypoint')
  }
}

async function runScenario(browser, label, cacheMode) {
  state.selected = 'a'
  state.cacheMode = cacheMode
  state.cachedEntry = undefined
  const context = await browser.newContext()
  await context.addInitScript(() => {
    const nativeSetTimeout = window.setTimeout.bind(window)
    window.setTimeout = (callback, delay, ...args) =>
      nativeSetTimeout(callback, Math.min(delay, 150), ...args)
  })
  const page = await context.newPage()
  let entrypointRequests = 0
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname === '/') entrypointRequests++
  })

  await page.goto(`${origin}/`)
  await page.waitForFunction(() => document.querySelector('h1')?.textContent === 'ze-great-team')
  await control('/__control/deploy?version=b')
  await page.waitForTimeout(900)

  const observed = await page.evaluate(() => ({
    assetPath: window.env?.assetPath,
    marker: document.querySelector('meta[name="experiment-selected-client"]')?.content,
  }))
  const expected = cacheMode === 'no-store' ? 'b' : 'a'
  const passed = observed.marker === expected && observed.assetPath?.endsWith(`/client-${expected}`)
  console.log(
    JSON.stringify(
      {
        scenario: label,
        cacheMode,
        passed,
        entrypointRequests,
        observed,
        expected: { marker: expected, assetPathSuffix: `/client-${expected}` },
      },
      null,
      2,
    ),
  )
  await context.close()
  if (!passed) throw new Error(`${label} scenario did not produce the expected client document`)
}

async function control(path) {
  const response = await fetch(`${origin}${path}`)
  if (!response.ok) throw new Error(`Control request failed: ${response.status}`)
}

async function handle(request, response) {
  const url = new URL(request.url ?? '/', origin)
  if (url.pathname === '/__control/deploy') {
    const version = url.searchParams.get('version')
    if (version !== 'a' && version !== 'b') throw new Error('version must be a or b')
    state.selected = version
    response.writeHead(204).end()
    return
  }
  if (url.pathname === '/api/client') {
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
    })
    response.end(JSON.stringify({ assetPath: `${origin}/client-${state.selected}` }))
    return
  }
  if (url.pathname === '/api/boards/ze-great-team') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ panels: [] }))
    return
  }
  if (url.pathname === '/') {
    const entry = renderEntry(state.selected)
    if (state.cacheMode === 'cached') {
      if (!state.cachedEntry) state.cachedEntry = entry
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': 'text/html; charset=utf-8',
      })
      response.end(state.cachedEntry)
      return
    }
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    })
    response.end(entry)
    return
  }
  if (url.pathname.startsWith('/client-a/') || url.pathname.startsWith('/client-b/')) {
    const relativePath = normalize(url.pathname.replace(/^\/client-[ab]\//, ''))
    const filePath = join(clientDist, relativePath)
    if (!filePath.startsWith(clientDist)) {
      response.writeHead(403).end('forbidden')
      return
    }
    const contentType = filePath.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : filePath.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'application/octet-stream'
    response.setHeader('content-type', contentType)
    createReadStream(filePath)
      .on('error', () => response.writeHead(404).end('not found'))
      .pipe(response)
    return
  }
  response.writeHead(404).end('not found')
}

function marker(html) {
  return html.match(/name="experiment-selected-client" content="([ab])"/)?.[1]
}

function renderEntry(version) {
  const assetPath = `${origin}/client-${version}`
  const env = JSON.stringify({ assetPath, proxyPath: '/api', board: 'ze-great-team' })
  return template
    .replaceAll('/__ASSET_PATH__/', `${assetPath}/`)
    .replace(
      '<head>',
      `<head><meta name="experiment-selected-client" content="${version}"><script>window.env = ${env};</script>`,
    )
}
