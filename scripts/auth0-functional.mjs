import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auth0FunctionalEnvironment, functionalAuth0 } from './auth0-functional-env.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = auth0FunctionalEnvironment()
const issuer = `https://${functionalAuth0.domain}/`
let child
let dashboard

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child?.kill(signal))
}

try {
  const allowedToken = await passwordToken(run.allowedUser)
  const unlistedToken = await passwordToken(run.unlistedUser)
  await exerciseDashboard(tokenSubject(allowedToken), allowedToken, unlistedToken)
  console.log('Auth0 functional API checks passed.')
} finally {
  await dashboard?.stop()
}

async function exerciseDashboard(allowedSubject, allowedToken, unlistedToken) {
  let boardConfig = ''
  const asset = await listen((request, response) => {
    if (request.url === '/index.html') {
      response
        .writeHead(200, { 'content-type': 'text/html' })
        .end('<html><head></head><body>fixture</body></html>')
      return
    }
    if (request.url === '/board.yaml') {
      response.writeHead(200, { 'content-type': 'text/yaml; charset=utf-8' }).end(boardConfig)
      return
    }
    response.writeHead(404).end()
  })
  let upstreamReads = 0
  const upstream = await listen((_request, response) => {
    upstreamReads += 1
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end('{"value":"functional evidence"}')
  })
  try {
    boardConfig = `# yaml-language-server: $schema=${asset.dockerOrigin}/board-config.schema.json\nauth:\n  issuer: ${issuer}\n  client_id: ${functionalAuth0.testRunnerClientId}\n  audience: ${functionalAuth0.audience}\n  allow:\n    subjects:\n      - ${allowedSubject}\nsources: {}\nboards:\n  ${functionalAuth0.board}:\n    panels:\n      - id: value\n        type: http-value\n        url: ${upstream.dockerOrigin}/value\n        json_path: $.value\n`
    dashboard = await startDashboard(asset.dockerOrigin)
    const origin = dashboard.origin

    equal((await fetch(`${origin}/health`)).status, 200, 'health endpoint')
    equal(
      (await fetch(`${origin}/api/boards/${functionalAuth0.board}`)).status,
      401,
      'missing token',
    )

    const allowedBoard = await fetch(
      `${origin}/api/boards/${functionalAuth0.board}`,
      bearer(allowedToken),
    )
    equal(allowedBoard.status, 200, 'allowed board')
    equal((await allowedBoard.json()).panels[0].id, 'value', 'allowed board content')
    const allowedPanel = await fetch(
      `${origin}/api/panel/${functionalAuth0.board}/value`,
      bearer(allowedToken),
    )
    equal(allowedPanel.status, 200, 'allowed panel')
    const panel = await allowedPanel.json()
    equal(panel.state, 'ok', 'allowed panel state')
    equal(panel.signal?.value, 'functional evidence', 'allowed panel value')
    equal(upstreamReads, 1, 'allowed upstream reads')

    equal(
      (await fetch(`${origin}/api/boards/${functionalAuth0.board}`, bearer(unlistedToken))).status,
      403,
      'unlisted board',
    )
    equal(
      (await fetch(`${origin}/api/panel/${functionalAuth0.board}/value`, bearer(unlistedToken)))
        .status,
      403,
      'unlisted panel',
    )
    equal(upstreamReads, 1, 'denied request upstream reads')
  } finally {
    await dashboard?.stop()
    dashboard = undefined
    await asset.close()
    await upstream.close()
  }
}

function bearer(token) {
  return { headers: { authorization: `Bearer ${token}` } }
}
function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}.`)
}

async function passwordToken(user) {
  const json = await auth0Json('/oauth/token', {
    grant_type: 'http://auth0.com/oauth/grant-type/password-realm',
    realm: functionalAuth0.connection,
    username: user.login,
    password: user.password,
    audience: functionalAuth0.audience,
    scope: 'openid profile read:dashboard',
    client_id: functionalAuth0.testRunnerClientId,
    client_secret: run.testRunner.clientSecret,
  })
  if (typeof json.access_token !== 'string')
    throw new Error('Auth0 did not return a user access token.')
  return json.access_token
}

async function auth0Json(path, body) {
  const response = await fetch(`https://${functionalAuth0.domain}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Auth0 request failed: ${response.status}.`)
  return response.json()
}

function tokenSubject(token) {
  try {
    const payload = token.split('.')[1]
    const subject = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).sub
    if (typeof subject === 'string' && subject) return subject
  } catch {
    // The server remains responsible for signature validation; this only prepares its test board.
  }
  throw new Error('Auth0 user access token has no subject.')
}

function listen(handler) {
  const server = createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    // Docker Desktop may use either address family for host.docker.internal. Binding dual-stack
    // keeps the fixture reachable from the Compose server without weakening its host-only port.
    server.listen({ port: 0, host: '::', ipv6Only: false }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('Could not determine the fixture port.'))
        return
      }
      resolve({
        dockerOrigin: `http://host.docker.internal:${address.port}`,
        close: () =>
          new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      })
    })
  })
}

async function startDashboard(assetPath) {
  const project = `auth0-functional-${process.pid}`
  const environment = {
    ...process.env,
    ASSET_PATH: assetPath,
    BOARD_CONFIG_URL: `${assetPath}/board.yaml`,
    FUNCTIONAL_BOARD: functionalAuth0.board,
  }

  try {
    await dockerCompose(project, environment, ['up', '--detach', '--build', '--wait'])
    const port = await dockerCompose(project, environment, ['port', 'server', '3000'])
    return {
      origin: composeOrigin(port),
      stop: () =>
        dockerCompose(project, environment, ['down', '--remove-orphans'], { allowFailure: true }),
    }
  } catch (error) {
    // `compose up --wait` reports only that a container stopped. Capture its structured startup
    // diagnostic before teardown, while filtering the caller's Password-grant credentials.
    const diagnostic = await composeFailureDiagnostic(project, environment)
    await dockerCompose(project, environment, ['down', '--remove-orphans'], { allowFailure: true })
    const detail = redactServerDiagnostic(diagnostic).trim()
    if (detail) console.error(`\nAuth0 functional startup diagnostics:\n${detail.slice(-4_000)}\n`)
    throw new Error(error instanceof Error ? error.message : 'Docker Compose startup failed.', {
      cause: error,
    })
  }
}

async function composeFailureDiagnostic(project, environment) {
  const status = await dockerCompose(project, environment, ['ps', '--all', '--format', 'json'], {
    allowFailure: true,
  })
  const containers = (() => {
    try {
      const parsed = JSON.parse(status)
      return Array.isArray(parsed) ? parsed : [parsed]
    } catch {
      return status.split('\n').flatMap((line) => {
        try {
          return [JSON.parse(line)]
        } catch {
          return []
        }
      })
    }
  })()
  const server = containers.find(
    (container) => container.Service === 'server' && typeof container.ID === 'string',
  )

  if (!server) return status

  // Go straight to the Docker container rather than Compose' log formatter. In particular this
  // retains runtime state errors for a container that exited before Node could write a log line.
  const [logs, stateError] = await Promise.all([
    docker(['logs', server.ID], environment, { allowFailure: true }),
    docker(['inspect', server.ID, '--format', '{{.State.Error}}'], environment, {
      allowFailure: true,
    }),
  ])
  return [status, stateError, logs].filter(Boolean).join('\n')
}

function dockerCompose(project, environment, command, { allowFailure = false } = {}) {
  return docker(
    [
      'compose',
      '-p',
      project,
      '-f',
      'docker-compose.yml',
      '-f',
      'docker-compose.local.yml',
      '-f',
      'docker-compose.auth0-functional.yml',
      ...command,
    ],
    environment,
    { allowFailure, label: `Docker Compose ${command[0]}` },
  )
}

function docker(command, environment, { allowFailure = false, label = 'Docker' } = {}) {
  return new Promise((resolve, reject) => {
    child = spawn('docker', command, {
      cwd: root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    child.once('error', (error) => {
      child = undefined
      reject(error)
    })
    child.once('exit', (code) => {
      child = undefined
      if (code === 0 || allowFailure) {
        resolve(output)
        return
      }
      reject(
        new Error(
          `${label} failed.${output ? `\n${redactServerDiagnostic(output).trim().slice(-4_000)}` : ''}`,
        ),
      )
    })
  })
}

function composeOrigin(output) {
  const match = /(?:127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d+)\s*$/.exec(output.trim())
  if (!match) throw new Error('Docker Compose did not report the dashboard server port.')
  return `http://127.0.0.1:${match[1]}`
}

/** Startup receives the caller environment; never echo its test credentials on a failure path. */
function redactServerDiagnostic(output) {
  return [
    process.env.AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET,
    process.env.AUTH0_FUNCTIONAL_ALLOWED_PASSWORD,
    process.env.AUTH0_FUNCTIONAL_UNLISTED_PASSWORD,
  ].reduce(
    (redacted, secret) => (secret ? redacted.replaceAll(secret, '[redacted]') : redacted),
    output,
  )
}
