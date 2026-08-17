import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
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
  let cdn: StaticServer

  beforeAll(async () => {
    cdn = await startStaticServer(fixturesDir)
  })

  afterAll(async () => {
    await cdn.close()
  })

  const renderAgainst = async (version: string) => {
    const assetPath = `${cdn.origin}/client-${version}`
    // Deliberately goes through the real env-parsing path: what a deployment actually changes is
    // an environment variable, so that's what the test changes.
    const config = loadConfig({ ASSET_PATH: assetPath })
    const app = createApp({ config })

    const response = await app.request('/')
    expect(response.status).toBe(200)
    return { html: await response.text(), assetPath }
  }

  it('serves version 1.0.0 with its own hashed filenames, made absolute', async () => {
    const { html, assetPath } = await renderAgainst('1.0.0')

    expect(html).toContain('FIXTURE VERSION ONE')
    expect(html).toContain(`src="${assetPath}/assets/index-aaaa1111.js"`)
    expect(html).toContain(`href="${assetPath}/assets/index-aaaa1111.css"`)
  })

  it('serves version 2.0.0 after only the asset path changed', async () => {
    const { html, assetPath } = await renderAgainst('2.0.0')

    expect(html).toContain('FIXTURE VERSION TWO — VISIBLY DIFFERENT')
    expect(html).toContain(`src="${assetPath}/assets/index-bbbb2222.js"`)
  })

  it('never serves one version’s filenames from another version’s path', async () => {
    const one = await renderAgainst('1.0.0')
    const two = await renderAgainst('2.0.0')

    // The whole failure mode this design avoids: correct-looking path, wrong build's filenames.
    expect(one.html).not.toContain('index-bbbb2222')
    expect(two.html).not.toContain('index-aaaa1111')
    expect(one.html).not.toContain('client-2.0.0')
    expect(two.html).not.toContain('client-1.0.0')
  })

  it('leaves no sentinel behind in the served document', async () => {
    const { html } = await renderAgainst('1.0.0')

    // A surviving sentinel means a relative URL resolving against the wrong host at runtime.
    expect(html).not.toContain('__ASSET_PATH__')
  })
})
