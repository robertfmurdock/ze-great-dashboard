import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auth0Endpoint } from './auth0-functional-config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Starts an ephemeral immutable-client host and the real packaged server for browser admission. */
export async function startAuth0BrowserFixture(sensitiveValues) {
  const assets = await startAssets()
  const image = `ze-great-dashboard:auth0-browser-${process.pid}`
  const name = `ze-great-dashboard-auth0-browser-${process.pid}`
  let containerStarted = false

  try {
    await docker(['build', '--tag', image, '--build-arg', 'ASSET_PATH=unused', '.'])
    const containerId = await docker([
      'run',
      '--detach',
      '--name',
      name,
      '--publish',
      '127.0.0.1::3000',
      '--add-host',
      'host.docker.internal:host-gateway',
      '--env',
      `ASSET_PATH=${assets.dockerOrigin}/__ASSET_PATH__`,
      '--env',
      `BOARD_CONFIG_URL=${assets.dockerOrigin}/board.yaml`,
      '--env',
      'BOARD=auth0-browser',
      '--env',
      'HOST=0.0.0.0',
      '--env',
      'PORT=3000',
      // Playwright starts the preview server immediately after this fixture. Waiting retains the
      // real startup behavior while avoiding a race between the two independently owned servers.
      '--env',
      'TEMPLATE_WAIT_MS=20000',
      image,
    ])
    containerStarted = true
    const port = await docker(['port', containerId.trim(), '3000'])
    const match = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)\s*$/.exec(port)
    if (!match) throw new Error('Docker did not report the Auth0 browser server port.')
    await waitForServer(`http://127.0.0.1:${match[1]}/health`, name, sensitiveValues)
    return {
      browserOrigin: `http://host.docker.internal:${match[1]}`,
      close: async () => {
        await docker(['rm', '--force', name], sensitiveValues, true)
        await docker(['image', 'rm', image], sensitiveValues, true)
        await assets.close()
      },
    }
  } catch (error) {
    if (containerStarted) await docker(['rm', '--force', name], sensitiveValues, true)
    await docker(['image', 'rm', image], sensitiveValues, true)
    await assets.close()
    throw error
  }
}

async function waitForServer(url, container, sensitiveValues) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // The packaged server may still be loading its immutable template and Auth0 verifier.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const logs = await docker(['logs', container], sensitiveValues, true)
  throw new Error(`Auth0 browser server did not become ready.${logs ? `\n${logs}` : ''}`)
}

async function startAssets() {
  const dist = join(root, 'packages/client/dist')
  await stat(join(dist, 'index.html'))
  let origin
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    response.setHeader('access-control-allow-origin', '*')
    if (url.pathname === '/board.yaml') {
      response
        .writeHead(200, { 'content-type': 'text/yaml; charset=utf-8' })
        .end(`# yaml-language-server: $schema=${origin}/__ASSET_PATH__/board-config.schema.json
auth:
  issuer: https://${auth0Endpoint.domain}/
  client_id: ${auth0Endpoint.browserSpaClientId}
  audience: ${auth0Endpoint.audience}
  authorization:
    mode: authenticated
sources: {}
boards:
  auth0-browser:
    panels:
      - id: demo
        type: pipeline-animation-demo
        label: Authenticated demo
        running_animation: telemetry-bloom
`)
      return
    }
    const relative = url.pathname.replace(/^\/__ASSET_PATH__\/?/, '') || 'index.html'
    const file = resolve(dist, normalize(relative))
    if (!file.startsWith(`${dist}/`) && file !== join(dist, 'index.html')) {
      response.writeHead(404).end()
      return
    }
    try {
      await stat(file)
      response.writeHead(200, { 'content-type': contentType(file) })
      createReadStream(file).pipe(response)
    } catch {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen({ port: 0, host: '::', ipv6Only: false }, resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('Could not determine asset fixture port.')
  origin = `http://host.docker.internal:${address.port}`
  return {
    dockerOrigin: origin,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  }
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html'
  if (file.endsWith('.js')) return 'text/javascript'
  if (file.endsWith('.css')) return 'text/css'
  if (file.endsWith('.json')) return 'application/json'
  return 'application/octet-stream'
}

function docker(args, sensitiveValues = [], allowFailure = false) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('docker', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0 || allowFailure) return resolveRun(output.trim())
      const redacted = sensitiveValues.reduce(
        (text, value) => text.replaceAll(value, '[redacted]'),
        output,
      )
      reject(new Error(`Docker command failed.${redacted ? `\n${redacted.slice(-4000)}` : ''}`))
    })
  })
}
