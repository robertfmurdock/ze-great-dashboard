import { type BoardConfig, clientEnvSchema } from '@ze-great-dashboard/shared'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const TEMPLATE = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Trust Dashboard</title>
<script type="module" src="/__ASSET_PATH__/assets/app.js"></script></head>
<body><div id="root"></div></body></html>`

function appWith(overrides: Record<string, string | undefined> = {}, template = TEMPLATE) {
  const config = loadConfig({
    ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7',
    ...overrides,
  })
  const fetcher = (async () => new Response(template, { status: 200 })) as typeof fetch
  return createApp({ config, fetcher })
}

/** Pulls the injected `window.env` object back out of the rendered document. */
function extractClientEnv(html: string): unknown {
  const match = /<script>window\.env = (.*?);<\/script>/s.exec(html)
  if (!match?.[1]) throw new Error(`No window.env block found in:\n${html}`)
  return JSON.parse(match[1].replaceAll('\\u003c', '<'))
}

describe('the entrypoint document', () => {
  it('injects window.env as the first element of <head>', async () => {
    const html = await (await appWith().request('/')).text()

    // It has to run before anything else on the page loads — the client's modules read it during
    // their initial evaluation, so a block placed after them is a race.
    expect(html).toMatch(/<head[^>]*><script>window\.env = /)
  })

  it('injects only public values, and ones the client can actually parse', async () => {
    const html = await (await appWith().request('/')).text()

    const parsed = clientEnvSchema.safeParse(extractClientEnv(html))
    expect(parsed.success).toBe(true)
    expect(parsed.data).toMatchObject({
      assetPath: 'https://assets.example.com/dashboard/1.0.7',
      proxyPath: '/api',
      board: 'ze-great-team',
      clientVersion: '1.0.7',
    })
  })

  it('is never cached, so configuration can change on a dime', async () => {
    const response = await appWith().request('/')

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('resolves the board name server-side from the URL', async () => {
    const html = await (await appWith().request('/boards/team-beta')).text()

    // The board is injected rather than parsed from the URL by the client, which is what makes
    // any path serveable without static-hosting SPA fallback.
    expect(extractClientEnv(html)).toMatchObject({ board: 'team-beta' })
  })

  it('does not leak server-only environment values into the document', async () => {
    const html = await (
      await appWith({
        BOARD_CONFIG_URL: 'https://internal.example.com/private-board.yaml',
      }).request('/')
    ).text()

    // window.env is browser-visible by definition, so anything that isn't public must not reach
    // it. The config location is the proxy's business; the browser fetches config through /api.
    expect(html).not.toContain('internal.example.com')
    expect(html).not.toContain('private-board.yaml')
  })

  it('escapes values that could otherwise break out of the script tag', async () => {
    const html = await (
      await appWith({ BOARD: 'evil</script><script>alert(1)' }).request('/')
    ).text()

    expect(html).not.toContain('</script><script>alert(1)')
    expect(extractClientEnv(html)).toMatchObject({ board: 'evil</script><script>alert(1)' })
  })

  it('refuses a template with nowhere to put configuration', async () => {
    const app = appWith({}, '<html><body>no head here</body></html>')

    // Reserving 5xx for the proxy's own breakage is deliberate: a template with no <head> is the
    // proxy being unable to do its job, not a report about an upstream. (Startup catches this
    // first in practice — see startup.test.ts — so this path is the belt to that suspenders.)
    const response = await app.request('/')
    expect(response.status).toBe(500)
  })

  it('labels a local dev asset path as "dev" rather than as the sentinel', async () => {
    const app = appWith({ ASSET_PATH: 'http://localhost:5173/__ASSET_PATH__' })

    const html = await (await app.request('/')).text()

    // Purely cosmetic, but the version label is on screen during all the cosmetic work, and
    // "__ASSET_PATH__" reads as a bug.
    expect(extractClientEnv(html)).toMatchObject({ clientVersion: 'dev' })
  })

  it('answers health checks without touching the template', async () => {
    const response = await appWith().request('/health')

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })

  it('reports the server-selected client identity without caching it', async () => {
    const response = await appWith().request('/api/client')

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      assetPath: 'https://assets.example.com/dashboard/1.0.7',
      clientVersion: '1.0.7',
    })
  })
})

describe('legal board layout download', () => {
  it('normalizes the selected board into a reusable twelve-by-twelve YAML', async () => {
    const boardConfig: BoardConfig = {
      sources: {
        github: {
          type: 'github-actions',
          repo: 'team/repo',
          token_env: 'GITHUB_TOKEN',
        },
      },
      boards: {
        operations: {
          panels: [
            {
              id: 'first',
              type: 'pipeline-status',
              source: 'github',
              pipeline: 'main.yml',
              position: { x: 0, y: 0, w: 8, h: 3 },
            },
            {
              id: 'second',
              type: 'pipeline-status',
              source: 'github',
              pipeline: 'main.yml',
              position: { x: 4, y: 12, w: 8, h: 2 },
            },
          ],
        },
      },
    }
    const config = loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7' })
    const app = createApp({
      config,
      boardConfig,
      fetcher: (async () => new Response(TEMPLATE)) as typeof fetch,
    })

    const response = await app.request('/api/boards/operations/rendered')
    const corrected = parseYaml(await response.text())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/yaml')
    expect(corrected.boards.operations.panels[1].position).toEqual({ x: 4, y: 10, w: 8, h: 2 })
    expect(corrected.sources.github).toMatchObject({ repo: 'team/repo', token_env: 'GITHUB_TOKEN' })
    expect(JSON.stringify(corrected)).not.toContain('secret-value')
  })

  it('returns an authored layout with the original coordinates unchanged', async () => {
    const boardConfig: BoardConfig = {
      sources: {},
      boards: {
        operations: {
          panels: [
            { id: 'first', type: 'test', position: { x: 0, y: 0, w: 8, h: 3 } },
            { id: 'second', type: 'test', position: { x: 4, y: 12, w: 8, h: 2 } },
          ],
        },
      },
    }
    const config = loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7' })
    const app = createApp({ config, boardConfig })

    const response = await app.request('/api/boards/operations/authored')
    const authored = parseYaml(await response.text())

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('operations-layout-authored.yaml')
    expect(authored.boards.operations.panels[1].position).toEqual({ x: 4, y: 12, w: 8, h: 2 })
  })

  it('does not expose an unknown board', async () => {
    const config = loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7' })
    const app = createApp({
      config,
      boardConfig: {
        sources: {},
        boards: { operations: { panels: [{ id: 'x', type: 'test' }] } },
      },
    })

    expect((await app.request('/api/boards/missing/rendered')).status).toBe(404)
    expect((await app.request('/api/boards/missing/authored')).status).toBe(404)
  })

  it('sanitizes board names in download filenames', async () => {
    const config = loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7' })
    const app = createApp({
      config,
      boardConfig: {
        sources: {},
        boards: { 'ops%/west': { panels: [{ id: 'x', type: 'test' }] } },
      },
    })

    const response = await app.request('/api/boards/ops%25%2Fwest/authored')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('ops__west-layout-authored.yaml')
  })
})
