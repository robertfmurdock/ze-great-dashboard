import { createServer } from 'node:http'
import { functionalAuth0 } from './auth0-functional-config.mjs'

export async function startFunctionalFixtures(allowedToken) {
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
  const auth = allowedToken
    ? `auth:\n  issuer: https://${functionalAuth0.domain}/\n  client_id: ${functionalAuth0.testRunnerClientId}\n  audience: ${functionalAuth0.audience}\n  allow:\n    subjects:\n      - ${tokenSubject(allowedToken)}\n`
    : ''
  boardConfig = `# yaml-language-server: $schema=${asset.dockerOrigin}/board-config.schema.json\n${auth}sources: {}\nboards:\n  ${functionalAuth0.board}:\n    panels:\n      - id: value\n        type: http-value\n        url: ${upstream.dockerOrigin}/value\n        json_path: $.value\n`
  return {
    assetOrigin: asset.dockerOrigin,
    upstreamReads: () => upstreamReads,
    close: async () => {
      await asset.close()
      await upstream.close()
    },
  }
}

export async function exercisePackagedServer(origin, fixtures, tokens) {
  equal((await fetch(`${origin}/health`)).status, 200, 'health endpoint')
  equal(
    (await fetch(`${origin}/boards/${functionalAuth0.board}`)).status,
    200,
    'rendered entrypoint',
  )
  const request = tokens ? bearer(tokens.allowedToken) : undefined
  if (tokens)
    equal(
      (await fetch(`${origin}/api/boards/${functionalAuth0.board}`)).status,
      401,
      'missing token',
    )
  const board = await fetch(`${origin}/api/boards/${functionalAuth0.board}`, request)
  equal(board.status, 200, 'board endpoint')
  equal((await board.json()).panels[0].id, 'value', 'board content')
  const panelResponse = await fetch(`${origin}/api/panel/${functionalAuth0.board}/value`, request)
  equal(panelResponse.status, 200, 'panel endpoint')
  const panel = await panelResponse.json()
  equal(panel.state, 'ok', 'normalized panel state')
  equal(panel.signal?.value, 'functional evidence', 'normalized panel value')
  equal(fixtures.upstreamReads(), 1, 'allowed upstream reads')
  if (!tokens) return
  equal(
    (await fetch(`${origin}/api/boards/${functionalAuth0.board}`, bearer(tokens.unlistedToken)))
      .status,
    403,
    'unlisted board',
  )
  equal(
    (
      await fetch(
        `${origin}/api/panel/${functionalAuth0.board}/value`,
        bearer(tokens.unlistedToken),
      )
    ).status,
    403,
    'unlisted panel',
  )
  equal(fixtures.upstreamReads(), 1, 'denied request upstream reads')
}

function tokenSubject(token) {
  try {
    const subject = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).sub
    if (typeof subject === 'string' && subject) return subject
  } catch {}
  throw new Error('Auth0 user access token has no subject.')
}

function bearer(token) {
  return { headers: { authorization: `Bearer ${token}` } }
}

function equal(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, received ${actual}.`)
}

function listen(handler) {
  const server = createServer(handler)
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen({ port: 0, host: '::', ipv6Only: false }, () => {
      const address = server.address()
      if (address === null || typeof address === 'string')
        return reject(new Error('Could not determine fixture port.'))
      resolve({
        dockerOrigin: `http://host.docker.internal:${address.port}`,
        close: () =>
          new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
      })
    })
  })
}
