import { fileURLToPath } from 'node:url'
import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect } from 'vitest'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { type StaticServer, startStaticServer } from './static-server.ts'

/**
 * The Immutable Web Application proof.
 *
 * The design doc's Stage 1 exit criterion is: repointing the server at a different pre-built
 * client version — changing one environment value, rebuilding nothing — visibly changes the page.
 * Stated that way it's a thing you do once by hand and never again. Here it's a permanent gate,
 * and it needs no AWS, no network, and no credentials.
 *
 * Two fixture "published builds" are served from a real HTTP origin. Each names differently
 * hashed filenames, which is the detail that makes baking the template into the server image a
 * bug rather than an inconvenience: version 2's assets under version 1's filenames would 404.
 */
describe('immutable web app: one variable repoints the client', () => {
  const fixturesDir = fileURLToPath(new URL('./fixtures', import.meta.url))

  async function publishedClientFixture(scope: ResourceScope) {
    return scope.using(
      'published client fixture server',
      () => startStaticServer(fixturesDir),
      (server) => server.close(),
    )
  }

  function immutableWebAppFixture(version: string, cdn: StaticServer) {
    const assetPath = `${cdn.origin}/client-${version}`
    // Deliberately goes through the real env-parsing path: what a deployment actually changes is
    // an environment variable, so that's what the test changes.
    const config = loadConfig({ ASSET_PATH: assetPath })
    return { app: createApp({ config }), assetPath }
  }

  mintTest('serves version 1.0.0 with its own hashed filenames, made absolute', {
    setup: async ({ scope }) =>
      immutableWebAppFixture('1.0.0', await publishedClientFixture(scope)),
    exercise: ({ app }) => app.request('/'),
    verify: async (response, { assetPath }) => {
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('FIXTURE VERSION ONE')
      expect(html).toContain(`src="${assetPath}/assets/index-aaaa1111.js"`)
      expect(html).toContain(`href="${assetPath}/assets/index-aaaa1111.css"`)
    },
  })

  mintTest('serves version 2.0.0 after only the asset path changed', {
    setup: async ({ scope }) =>
      immutableWebAppFixture('2.0.0', await publishedClientFixture(scope)),
    exercise: ({ app }) => app.request('/'),
    verify: async (response, { assetPath }) => {
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('FIXTURE VERSION TWO — VISIBLY DIFFERENT')
      expect(html).toContain(`src="${assetPath}/assets/index-bbbb2222.js"`)
    },
  })

  mintTest('never serves one version’s filenames from another version’s path', {
    setup: async ({ scope }) => {
      const cdn = await publishedClientFixture(scope)
      return {
        one: immutableWebAppFixture('1.0.0', cdn),
        two: immutableWebAppFixture('2.0.0', cdn),
      }
    },
    exercise: async ({ one, two }) => ({
      one: await one.app.request('/'),
      two: await two.app.request('/'),
    }),
    verify: async ({ one, two }) => {
      expect(one.status).toBe(200)
      expect(two.status).toBe(200)
      const [oneHtml, twoHtml] = await Promise.all([one.text(), two.text()])
      expect(oneHtml).not.toContain('index-bbbb2222')
      expect(twoHtml).not.toContain('index-aaaa1111')
      expect(oneHtml).not.toContain('client-2.0.0')
      expect(twoHtml).not.toContain('client-1.0.0')
    },
  })

  mintTest('leaves no sentinel behind in the served document', {
    setup: async ({ scope }) =>
      immutableWebAppFixture('1.0.0', await publishedClientFixture(scope)),
    exercise: ({ app }) => app.request('/'),
    verify: async (response) => {
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).not.toContain('__ASSET_PATH__')
    },
  })
})
