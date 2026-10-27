import { mint } from '@continuous-excellence/testmints-js/vitest'
import { type BoardConfig, clientEnvSchema } from '@ze-great-dashboard/shared'
import { describe, expect, test, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

// noinspection HtmlUnknownTarget
const TEMPLATE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Trust Dashboard</title>
<script type="module" src="/__ASSET_PATH__/assets/app.js"></script></head>
<body><div id="root"></div></body></html>`

function entrypointFixture(
  overrides: Record<string, string | undefined> = {},
  template = TEMPLATE,
) {
  const config = loadConfig({
    ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7',
    ...overrides,
  })
  const fetcher = vi.fn<typeof fetch>(async () => new Response(template, { status: 200 }))
  return { app: createApp({ config, fetcher }), fetcher }
}

function appWith(overrides: Record<string, string | undefined> = {}, template = TEMPLATE) {
  return entrypointFixture(overrides, template).app
}

function readInjectedClientEnv(html: string): unknown {
  const match = /<script>window\.env = (.*?);<\/script>/s.exec(html)
  if (!match?.[1]) throw new Error(`No window.env block found in:\n${html}`)
  return JSON.parse(match[1].replaceAll('\\u003c', '<'))
}

describe('the entrypoint document', () => {
  describe('rendering and client configuration', () => {
    test(
      'injects window.env as the first element of <head>',
      mint({
        setup: () => ({ app: appWith() }),
        exercise: async ({ app }) => (await app.request('/')).text(),
        verify: (html) => expect(html).toMatch(/<head[^>]*><script>window\.env = /),
      }),
    )

    test(
      'injects only public values, and ones the client can actually parse',
      mint({
        setup: () => ({ app: appWith() }),
        exercise: async ({ app }) => (await app.request('/')).text(),
        verify: (html) => {
          const parsed = clientEnvSchema.safeParse(readInjectedClientEnv(html))
          expect(parsed.success).toBe(true)
          expect(parsed.data).toMatchObject({
            assetPath: 'https://assets.example.com/dashboard/1.0.7',
            proxyPath: '/api',
            board: 'ze-great-team',
          })
        },
      }),
    )

    test(
      'is never cached, so configuration can change on a dime',
      mint({
        setup: () => ({ app: appWith() }),
        exercise: ({ app }) => app.request('/'),
        verify: (response) => {
          expect(response.headers.get('cache-control')).toBe('no-store')
          expect(response.headers.get('content-type')).toContain('text/html')
        },
      }),
    )

    test(
      'resolves the board name server-side from the URL',
      mint({
        setup: () => ({ app: appWith() }),
        exercise: async ({ app }) => (await app.request('/boards/team-beta')).text(),
        verify: (html) => expect(readInjectedClientEnv(html)).toMatchObject({ board: 'team-beta' }),
      }),
    )

    test(
      'does not leak server-only environment values into the document',
      mint({
        setup: () => ({
          app: appWith({
            BOARD_CONFIG_URL: 'https://internal.example.com/private-board.yaml',
          }),
        }),
        exercise: async ({ app }) => (await app.request('/')).text(),
        verify: (html) => {
          expect(html).not.toContain('internal.example.com')
          expect(html).not.toContain('private-board.yaml')
        },
      }),
    )

    test(
      'escapes values that could otherwise break out of the script tag',
      mint({
        setup: () => ({ app: appWith({ BOARD: 'evil</script><script>alert(1)' }) }),
        exercise: async ({ app }) => (await app.request('/')).text(),
        verify: (html) => {
          expect(html).not.toContain('</script><script>alert(1)')
          expect(readInjectedClientEnv(html)).toMatchObject({
            board: 'evil</script><script>alert(1)',
          })
        },
      }),
    )

    test(
      'does not infer a client version from a local dev asset path',
      mint({
        setup: () => ({ app: appWith({ ASSET_PATH: 'http://localhost:5173/__ASSET_PATH__' }) }),
        exercise: async ({ app }) => (await app.request('/')).text(),
        verify: (html) => expect(readInjectedClientEnv(html)).not.toHaveProperty('clientVersion'),
      }),
    )
  })

  describe('template failures', () => {
    test(
      'refuses a template with nowhere to put configuration',
      mint({
        setup: ({ scope }) => {
          const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
          scope.defer('restore console error', () => error.mockRestore())
          return { app: appWith({}, '<html lang="en"><body>no head here</body></html>') }
        },
        exercise: ({ app }) => app.request('/'),
        verify: (response) => expect(response.status).toBe(500),
      }),
    )
  })

  describe('operational endpoints', () => {
    test(
      'answers health checks without touching the template',
      mint({
        setup: () => entrypointFixture(),
        exercise: async ({ app }) => {
          const response = await app.request('/health')
          return { response, body: await response.json() }
        },
        verify: ({ response, body }, { fetcher }) => {
          expect(response.status).toBe(200)
          expect(body).toEqual({ status: 'ok' })
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )

    test(
      'reports the server-selected client identity without caching it',
      mint({
        setup: () => ({ app: appWith() }),
        exercise: async ({ app }) => {
          const response = await app.request('/api/client')
          return { response, body: await response.json() }
        },
        verify: ({ response, body }) => {
          expect(response.status).toBe(200)
          expect(response.headers.get('cache-control')).toBe('no-store')
          expect(body).toEqual({
            assetPath: 'https://assets.example.com/dashboard/1.0.7',
            assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
            serverVersion: 'development',
          })
        },
      }),
    )
  })
})

describe('legal board layout download', () => {
  describe('layout representations', () => {
    test(
      'normalizes the selected board into a reusable twelve-by-twelve YAML',
      mint({
        setup: () => {
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
          return {
            app: createApp({
              config,
              boardConfig,
              fetcher: (async () => new Response(TEMPLATE)) as typeof fetch,
            }),
          }
        },
        exercise: async ({ app }) => {
          const response = await app.request('/api/boards/operations/rendered')
          return { response, board: parseYaml(await response.text()) }
        },
        verify: ({ response, board }) => {
          expect(response.status).toBe(200)
          expect(response.headers.get('content-type')).toContain('text/yaml')
          expect(board.boards.operations.panels[1].position).toEqual({ x: 4, y: 10, w: 8, h: 2 })
          expect(board.sources.github).toMatchObject({
            repo: 'team/repo',
            token_env: 'GITHUB_TOKEN',
          })
          expect(JSON.stringify(board)).not.toContain('secret-value')
        },
      }),
    )

    test(
      'returns an authored layout with the original coordinates unchanged',
      mint({
        setup: () => {
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
          return { app: createApp({ config, boardConfig }) }
        },
        exercise: async ({ app }) => {
          const response = await app.request('/api/boards/operations/authored')
          return { response, board: parseYaml(await response.text()) }
        },
        verify: ({ response, board }) => {
          expect(response.status).toBe(200)
          expect(response.headers.get('content-disposition')).toContain(
            'operations-layout-authored.yaml',
          )
          expect(board.boards.operations.panels[1].position).toEqual({ x: 4, y: 12, w: 8, h: 2 })
        },
      }),
    )
  })

  const unknownBoardFixture = () => {
    const config = loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7' })
    return {
      app: createApp({
        config,
        boardConfig: {
          sources: {},
          boards: { operations: { panels: [{ id: 'x', type: 'test' }] } },
        },
      }),
    }
  }

  describe('route admission and download names', () => {
    test(
      'does not expose an unknown rendered board',
      mint({
        setup: unknownBoardFixture,
        exercise: ({ app }) => app.request('/api/boards/missing/rendered'),
        verify: (response) => expect(response.status).toBe(404),
      }),
    )

    test(
      'does not expose an unknown authored board',
      mint({
        setup: unknownBoardFixture,
        exercise: ({ app }) => app.request('/api/boards/missing/authored'),
        verify: (response) => expect(response.status).toBe(404),
      }),
    )

    test(
      'sanitizes board names in download filenames',
      mint({
        setup: () => {
          const config = loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.7' })
          return {
            app: createApp({
              config,
              boardConfig: {
                sources: {},
                boards: { 'ops%/west': { panels: [{ id: 'x', type: 'test' }] } },
              },
            }),
          }
        },
        exercise: ({ app }) => app.request('/api/boards/ops%25%2Fwest/authored'),
        verify: (response) => {
          expect(response.status).toBe(200)
          expect(response.headers.get('content-disposition')).toContain(
            'ops__west-layout-authored.yaml',
          )
        },
      }),
    )
  })
})
