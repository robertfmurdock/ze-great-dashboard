import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import test from 'node:test'
import {
  deferUnavailablePlaywrightUpgrade,
  playwrightImageIsPublished,
} from './update-dependencies.mjs'

async function withRegistry(handler, run) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  try {
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Registry test server has no TCP port.')
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    server.close()
    await once(server, 'close')
  }
}

test('recognizes the exact published Noble Playwright image', async () => {
  const requests = []
  await withRegistry(
    (request, response) => {
      requests.push({ url: request.url, accept: request.headers.accept })
      response.writeHead(200).end()
    },
    async (registryUrl) => {
      assert.equal(await playwrightImageIsPublished('1.64.0', { registryUrl }), true)
    },
  )
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, '/v2/playwright/manifests/v1.64.0-noble')
  assert.match(
    requests[0].accept ?? '',
    /application\/vnd\.docker\.distribution\.manifest\.v2\+json/,
  )
})

test('defers an image tag that MCR has not published', async () => {
  const paths = []
  await withRegistry(
    (request, response) => {
      paths.push(request.url)
      response.writeHead(404).end()
    },
    async (registryUrl) => {
      assert.equal(await playwrightImageIsPublished('1.64.0', { registryUrl }), false)
    },
  )
  assert.deepEqual(paths, ['/v2/playwright/manifests/v1.64.0-noble'])
})

test('does not conceal an unavailable registry', async () => {
  await withRegistry(
    (_request, response) => {
      response.writeHead(503).end()
    },
    async (registryUrl) => {
      await assert.rejects(
        playwrightImageIsPublished('1.64.0', { registryUrl }),
        /could not confirm the Playwright Docker image/i,
      )
    },
  )
})

test('restores the previous Playwright constraint when its image is unavailable', async () => {
  const before = { devDependencies: { '@playwright/test': '^1.63.0' } }
  const after = { devDependencies: { '@playwright/test': '^1.64.0' } }

  assert.equal(await deferUnavailablePlaywrightUpgrade(before, after, async () => false), true)
  assert.equal(after.devDependencies['@playwright/test'], '^1.63.0')
})

test('keeps an update after its exact image is available', async () => {
  const before = { devDependencies: { '@playwright/test': '^1.63.0' } }
  const after = { devDependencies: { '@playwright/test': '^1.64.0' } }

  assert.equal(await deferUnavailablePlaywrightUpgrade(before, after, async () => true), false)
  assert.equal(after.devDependencies['@playwright/test'], '^1.64.0')
})
