import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { test } from 'vitest'
import {
  deferUnavailablePlaywrightUpgrade,
  playwrightImageIsPublished,
} from './update-dependencies.mjs'

async function registryFixture(scope, status) {
  const version = '1.64.0'
  const requests = []
  const server = createServer((request, response) => {
    requests.push({ url: request.url, accept: request.headers.accept })
    response.writeHead(status).end()
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  scope.defer(
    'registry server',
    () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  )
  return {
    version,
    requests,
    options: { registryUrl: `http://127.0.0.1:${server.address().port}` },
  }
}

for (const { name, status, published } of [
  { name: 'recognizes the exact published Noble Playwright image', status: 200, published: true },
  { name: 'defers an image tag that MCR has not published', status: 404, published: false },
]) {
  test(
    name,
    mint({
      setup: ({ scope }) => registryFixture(scope, status),
      exercise: ({ version, options }) => playwrightImageIsPublished(version, options),
      verify: (result, { version, requests }) => {
        assert.equal(result, published)
        assert.equal(requests.length, 1)
        assert.equal(requests[0].url, `/v2/playwright/manifests/v${version}-noble`)
        assert.match(
          requests[0].accept ?? '',
          /application\/vnd\.docker\.distribution\.manifest\.v2\+json/,
        )
      },
    }),
  )
}

test(
  'does not conceal an unavailable registry',
  mint({
    setup: ({ scope }) => registryFixture(scope, 503),
    exercise: async ({ version, options }) => {
      try {
        await playwrightImageIsPublished(version, options)
      } catch (error) {
        return error
      }
      throw new Error('Expected the registry lookup to reject.')
    },
    verify: (error) =>
      assert.match(error.message, /could not confirm the Playwright Docker image/i),
  }),
)

for (const { name, published, retained } of [
  {
    name: 'restores the previous Playwright constraint when its image is unavailable',
    published: false,
    retained: 'previous',
  },
  {
    name: 'keeps an update after its exact image is available',
    published: true,
    retained: 'updated',
  },
]) {
  test(
    name,
    mint({
      setup: () => {
        const previous = '^1.63.0'
        const updated = '^1.64.0'
        return {
          constraints: { previous, updated },
          before: { devDependencies: { '@playwright/test': previous } },
          after: { devDependencies: { '@playwright/test': updated } },
        }
      },
      exercise: ({ before, after }) =>
        deferUnavailablePlaywrightUpgrade(before, after, async () => published),
      verify: (deferred, { after, constraints }) => {
        assert.equal(deferred, !published)
        assert.equal(after.devDependencies['@playwright/test'], constraints[retained])
      },
    }),
  )
}
