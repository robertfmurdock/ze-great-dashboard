import { fileURLToPath } from 'node:url'
import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
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

  const versions = [
    {
      version: '1.0.0',
      marker: 'FIXTURE VERSION ONE',
      hash: 'aaaa1111',
      otherVersion: '2.0.0',
      otherHash: 'bbbb2222',
    },
    {
      version: '2.0.0',
      marker: 'FIXTURE VERSION TWO — VISIBLY DIFFERENT',
      hash: 'bbbb2222',
      otherVersion: '1.0.0',
      otherHash: 'aaaa1111',
    },
  ]
  for (const scenario of versions) {
    test(
      `serves only version ${scenario.version}'s assets after changing the asset path`,
      mint({
        setup: async ({ scope }) => ({
          ...scenario,
          ...immutableWebAppFixture(scenario.version, await publishedClientFixture(scope)),
        }),
        exercise: ({ app }) => app.request('/'),
        verify: async (response, { assetPath, marker, hash, otherVersion, otherHash }) => {
          expect(response.status).toBe(200)
          const html = await response.text()
          expect(html).toContain(marker)
          expect(html).toContain(`src="${assetPath}/assets/index-${hash}.js"`)
          expect(html).toContain(`href="${assetPath}/assets/index-${hash}.css"`)
          expect(html).not.toContain(`index-${otherHash}`)
          expect(html).not.toContain(`client-${otherVersion}`)
          expect(html).not.toContain('__ASSET_PATH__')
        },
      }),
    )
  }
})
