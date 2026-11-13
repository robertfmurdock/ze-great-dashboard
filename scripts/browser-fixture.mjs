import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, get } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { stringify } from 'yaml'
import { auth0Endpoint } from './auth0-functional-config.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const hostnames = {
  public: 'public.dashboard.test',
  warning: 'warning.dashboard.test',
  blocked: 'blocked.dashboard.test',
  authenticated: 'authenticated.dashboard.test',
  auth0: 'local.ze-great-dashboard.test',
}

/** Starts one packaged dashboard process with immutable fixtures on a separate origin. */
export async function startBrowserFixture({ auth0, sensitiveValues, network, signal }) {
  const assets = await startAssets()
  const image = `ze-great-dashboard:browser-${process.pid}`
  const name = `ze-great-dashboard-browser-app-${process.pid}`
  let directory
  let containerAttempted = false
  const close = async () => {
    try {
      if (containerAttempted) await docker(['rm', '--force', name], sensitiveValues, true)
      await docker(['image', 'rm', image], sensitiveValues, true)
    } finally {
      await Promise.all([
        assets.close(),
        directory && rm(directory, { recursive: true, force: true }),
      ])
    }
  }

  try {
    directory = await mkdtemp(join(tmpdir(), 'dashboard-browser-'))
    const hostsFile = join(directory, 'hosts.json')
    const deployments = {
      public: 'build',
      warning: 'client-2.0.0',
      blocked: 'build',
      authenticated: 'client-1.0.0',
      ...(auth0 ? { auth0: 'build' } : {}),
    }
    await writeFile(
      hostsFile,
      JSON.stringify(
        Object.fromEntries(
          Object.entries(deployments).map(([deployment, version]) => [
            hostnames[deployment],
            {
              ASSET_PATH: `${assets.dockerOrigin}/${version}`,
              BOARD_CONFIG_URL: `${assets.dockerOrigin}/${deployment}.yaml`,
              BOARD: deployment === 'auth0' ? 'auth0-browser' : deployment,
            },
          ]),
        ),
      ),
    )
    await docker(
      ['build', '--tag', image, '--build-arg', 'ASSET_PATH=unused', '.'],
      sensitiveValues,
      false,
      signal,
    )
    signal.throwIfAborted()
    containerAttempted = true
    const containerId = await docker(
      [
        'run',
        '--detach',
        '--name',
        name,
        '--add-host',
        'host.docker.internal:host-gateway',
        '--publish',
        '127.0.0.1::3000',
        ...(network
          ? [
              '--network',
              network,
              ...Object.keys(deployments).flatMap((deployment) => [
                '--network-alias',
                hostnames[deployment],
              ]),
            ]
          : []),
        '--mount',
        `type=bind,source=${hostsFile},target=/app/hosts.json,readonly`,
        '--env',
        'DASHBOARD_HOSTS_FILE=/app/hosts.json',
        image,
      ],
      sensitiveValues,
      false,
      signal,
    )
    const httpOrigin = await publishedOrigin(containerId.trim(), name, sensitiveValues, signal)
    const port = network ? '3000' : new URL(httpOrigin).port
    return {
      httpOrigin,
      hostnames,
      browserOrigin: `http://${hostnames.public}:${port}`,
      auth0Origin: auth0 ? `http://${hostnames.auth0}:${port}` : undefined,
      assetOrigin: assets.dockerOrigin,
      fixtureBearer: assets.fixtureBearer,
      close,
    }
  } catch (error) {
    await close()
    throw error
  }
}

async function publishedOrigin(containerId, container, sensitiveValues, signal) {
  const port = await docker(['port', containerId, '3000'], sensitiveValues, false, signal)
  const match = /^127\.0\.0\.1:(\d+)\s*$/.exec(port)
  if (!match) throw new Error('Docker did not report the dashboard browser server port.')
  const origin = `http://127.0.0.1:${match[1]}`
  for (let attempt = 0; attempt < 80; attempt += 1) {
    signal.throwIfAborted()
    try {
      const status = await new Promise((resolveStatus, reject) => {
        get(
          `${origin}/health`,
          {
            headers: { host: hostnames.public },
            signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]),
          },
          (response) => {
            response.resume()
            resolveStatus(response.statusCode)
          },
        ).once('error', reject)
      })
      if (status === 200) return origin
    } catch {
      // The packaged server may still be loading its deployments.
    }
    if (
      (await docker(
        ['inspect', '--format', '{{.State.Running}}', container],
        sensitiveValues,
        false,
        signal,
      )) === 'false'
    )
      break
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  const logs = await docker(['logs', container], sensitiveValues, true)
  throw new Error(`Dashboard browser server did not become ready.${logs ? `\n${logs}` : ''}`)
}

function boardConfiguration(deployment, origin) {
  const panel = { id: 'demo', type: 'pipeline-animation-demo', label: 'Demo' }
  const configs = {
    public: {
      security: 'unsecured',
      boards: {
        public: { panels: [panel] },
        release: {
          panels: [
            {
              id: 'version',
              type: 'http-value',
              label: 'Release version',
              url: `${origin}/upstream/release.json`,
              json_path: '$.version',
            },
          ],
        },
      },
    },
    warning: { boards: { warning: { panels: [panel] } } },
    blocked: { security: 'required', boards: { blocked: { panels: [panel] } } },
    authenticated: {
      auth: {
        issuer: `${origin}/oidc`,
        client_id: 'browser-fixture',
        audience: 'dashboard-fixture',
        authorization: { mode: 'authenticated' },
      },
      boards: { authenticated: { panels: [panel] }, 'private-operations': { panels: [panel] } },
    },
    auth0: {
      auth: {
        issuer: `https://${auth0Endpoint.domain}/`,
        client_id: auth0Endpoint.browserSpaClientId,
        audience: auth0Endpoint.audience,
        authorization: { mode: 'authenticated' },
      },
      boards: {
        'auth0-browser': {
          panels: [{ ...panel, label: 'Authenticated demo', running_animation: 'telemetry-bloom' }],
        },
      },
    },
  }
  const config = Object.hasOwn(configs, deployment) ? configs[deployment] : undefined
  if (!config) return
  const version = { warning: 'client-2.0.0', authenticated: 'client-1.0.0' }[deployment] ?? 'build'
  return `# yaml-language-server: $schema=${origin}/${version}/board-config.schema.json\n${stringify({ sources: {}, ...config })}`
}

async function startAssets() {
  const dist = join(root, 'packages/client/dist')
  await stat(join(dist, 'index.html'))
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const publicJwk = await exportJWK(publicKey)
  let origin
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    response.setHeader('access-control-allow-origin', '*')
    if (url.pathname === '/oidc/.well-known/openid-configuration') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          issuer: `${origin}/oidc`,
          jwks_uri: `${origin}/oidc/keys`,
        }),
      )
      return
    }
    if (url.pathname === '/oidc/keys') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ keys: [publicJwk] }))
      return
    }
    if (url.pathname === '/upstream/release.json') {
      response
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ version: '2026.11.13' }))
      return
    }
    const yaml = /^\/([a-z0-9]+)\.yaml$/.exec(url.pathname)
    if (yaml) {
      const config = boardConfiguration(yaml[1], origin)
      if (config)
        response.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8' }).end(config)
      else response.writeHead(404).end()
      return
    }
    const path = /^\/(build|client-[12]\.0\.0)\/(.*)$/.exec(url.pathname)
    if (!path) {
      response.writeHead(404).end()
      return
    }
    const [, version, relative] = path
    const directory =
      version === 'build' ? dist : join(root, 'packages/server/test/fixtures', version)
    const file = resolve(directory, normalize(relative))
    if (!file.startsWith(`${directory}/`)) {
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
  const fixtureBearer = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(`${origin}/oidc`)
    .setAudience('dashboard-fixture')
    .setSubject('fixture-user')
    .setExpirationTime('1h')
    .sign(privateKey)
  return {
    dockerOrigin: origin,
    fixtureBearer,
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

function docker(args, sensitiveValues = [], allowFailure = false, signal) {
  return new Promise((resolveRun, reject) => {
    const child = spawn('docker', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], signal })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.once('error', (error) => {
      if (error.name !== 'AbortError') reject(error)
    })
    child.once('close', (code) => {
      if (signal?.aborted) return reject(signal.reason)
      if (code === 0 || allowFailure) return resolveRun(output.trim())
      const redacted = sensitiveValues.reduce(
        (text, value) => text.replaceAll(value, '[redacted]'),
        output,
      )
      reject(new Error(`Docker command failed.${redacted ? `\n${redacted.slice(-4000)}` : ''}`))
    })
  })
}
