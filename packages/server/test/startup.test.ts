import { mint } from '@continuous-excellence/testmints-js/vitest'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { serverReadyEvent } from '../src/logger.ts'
import { deploymentSecurityState, selectBoard, startup } from '../src/startup.ts'
import { fetchTemplate, TemplateCache } from '../src/template.ts'

function rejects<Input, Output>(action: (input: Input) => Promise<Output>) {
  return async (input: Input): Promise<unknown> => {
    try {
      await action(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected the exercise to reject.')
  }
}
function throws<Input>(action: (input: Input) => unknown) {
  return (input: Input): unknown => {
    try {
      action(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected the exercise to throw.')
  }
}
const failing = (response: () => Promise<Response>) => response as unknown as typeof fetch

describe('startup refuses to proceed without a template', () => {
  const cases = [
    {
      name: 'names the bad asset path when the template 404s',
      assetPath: 'https://assets.example.com/typo',
      response: async () => new Response('nope', { status: 404, statusText: 'Not Found' }),
      expectedMessage: /https:\/\/assets\.example\.com\/typo\/index\.html.*404/s,
    },
    {
      name: 'names the bad asset path when the host is unreachable',
      assetPath: 'http://127.0.0.1:9/nothing',
      response: async () => {
        throw new Error('ECONNREFUSED')
      },
      expectedMessage: /http:\/\/127\.0\.0\.1:9\/nothing.*ECONNREFUSED/s,
    },
    {
      name: 'treats an empty template as a failure rather than serving a blank page',
      assetPath: 'https://assets.example.com/1.0.0',
      response: async () => new Response('   ', { status: 200 }),
      expectedMessage: /empty/,
    },
    {
      name: 'suggests what to check, since this is a configuration problem',
      assetPath: 'https://assets.example.com/1.0.0',
      response: async () => new Response('', { status: 500 }),
      expectedMessage: /ASSET_PATH/,
    },
    {
      name: 'rejects a template with no <head> at boot rather than per request',
      assetPath: 'https://assets.example.com/1.0.0',
      response: async () => new Response('<html lang="en"><body>hi</body></html>', { status: 200 }),
      expectedMessage: /no <head> element/,
    },
  ] as const satisfies readonly {
    name: string
    assetPath: string
    response: () => Promise<Response>
    expectedMessage: RegExp
  }[]
  for (const { name, assetPath, response, expectedMessage } of cases)
    test(
      name,
      mint({
        setup: () => ({ assetPath, fetcher: failing(response) }),
        exercise: rejects(({ assetPath, fetcher }) => fetchTemplate(assetPath, fetcher)),
        verify: (error) =>
          expect(error).toMatchObject({ message: expect.stringMatching(expectedMessage) }),
      }),
    )
})

describe('configured panel admission', () => {
  afterEach(() => vi.unstubAllEnvs())
  function fixture(boardConfigUrl: string, assetPath = 'https://assets.example.com/client-2.0.0') {
    vi.stubEnv('ASSET_PATH', assetPath)
    vi.stubEnv('BOARD_CONFIG_URL', boardConfigUrl)
    return {
      fetcher: vi.fn(
        async () => new Response('<html lang="en"><head></head><body></body></html>'),
      ) as unknown as typeof fetch,
    }
  }
  test(
    'admits an Azure DevOps pipeline-status panel before resolving credentials or reading Azure',
    mint({
      setup: () => fixture('packages/server/test/fixtures/ado-pipeline-board.yaml'),
      exercise: ({ fetcher }) => startup({ fetcher }),
      verify: (result, { fetcher }) => {
        expect(result.config.board).toBe('operations')
        expect(fetcher).toHaveBeenCalledTimes(1)
      },
    }),
  )
  test(
    'admits the release credential smoke board without invoking its configured source',
    mint({
      setup: () =>
        fixture(
          'reference/credential-smoke-board.yaml',
          'https://public-assets.zegreatrob.com/dashboard/0.18.0',
        ),
      exercise: ({ fetcher }) => startup({ fetcher }),
      verify: (result, { fetcher }) => {
        expect(result.config.board).toBe('reference')
        expect(fetcher).toHaveBeenCalledTimes(1)
      },
    }),
  )
  test(
    'rejects a syntactically valid unsupported panel before credential or upstream access',
    mint({
      setup: () => fixture('packages/server/test/fixtures/unsupported-panel-board.yaml'),
      exercise: rejects(({ fetcher }) => startup({ fetcher })),
      verify: (error, { fetcher }) => {
        expect(error).toMatchObject({
          message: expect.stringMatching(
            /board "operations", panel "unavailable", source "mystery" \(unsupported-source\), signal "pipeline-status"/,
          ),
        })
        expect(fetcher).toHaveBeenCalledTimes(1)
      },
    }),
  )
})

describe('server identity logging', () => {
  test(
    'records the image build identifier without requiring a matching client asset version',
    mint({
      setup: () => ({
        config: loadConfig({
          ASSET_PATH: 'https://assets.example.com/dashboard/client-2.0.0',
          SERVER_RELEASE: 'server-1.4.0',
        }),
      }),
      exercise: ({ config }) =>
        serverReadyEvent({
          board: 'operations',
          host: 'localhost',
          port: 3000,
          serverVersion: config.serverRelease,
        }),
      verify: (event) =>
        expect(event).toEqual({
          event: 'server.ready',
          board: 'operations',
          host: 'localhost',
          port: 3000,
          serverVersion: 'server-1.4.0',
        }),
    }),
  )
})

describe('the template cache', () => {
  test(
    'fetches an immutable version once and reuses it',
    mint({
      setup: () => {
        const fetcher = vi.fn(async () => new Response('<html lang="en"><head></head></html>'))
        return { cache: new TemplateCache(fetcher as unknown as typeof fetch), fetcher }
      },
      exercise: async ({ cache }) => {
        await Promise.all([cache.get('https://cdn/1.0.0'), cache.get('https://cdn/1.0.0')])
        await cache.get('https://cdn/1.0.0')
      },
      verify: (_, { fetcher }) => expect(fetcher).toHaveBeenCalledTimes(1),
    }),
  )
  test(
    'keys by asset path so repointing cannot serve the old version',
    mint({
      setup: () => {
        const fetcher = vi.fn(
          async (url: string | URL | Request) =>
            new Response('<html lang="en"><head></head><!-- ' + String(url) + ' --></html>'),
        )
        return { cache: new TemplateCache(fetcher as unknown as typeof fetch), fetcher }
      },
      exercise: async ({ cache }) => ({
        one: await cache.get('https://cdn/1.0.0'),
        two: await cache.get('https://cdn/2.0.0'),
      }),
      verify: ({ one, two }, { fetcher }) => {
        expect(one).toContain('1.0.0')
        expect(two).toContain('2.0.0')
        expect(fetcher).toHaveBeenCalledTimes(2)
      },
    }),
  )
  test(
    'does not cache a failure, so a transient blip is recoverable',
    mint({
      setup: () => {
        let attempt = 0
        const fetcher = vi.fn(async () => {
          attempt += 1
          if (attempt === 1) throw new Error('transient')
          return new Response('<html lang="en"><head></head></html>')
        })
        return { cache: new TemplateCache(fetcher as unknown as typeof fetch) }
      },
      exercise: async ({ cache }) => ({
        failure: await rejects(() => cache.get('https://cdn/1.0.0'))(undefined),
        recovery: await cache.get('https://cdn/1.0.0'),
      }),
      verify: ({ failure, recovery }) => {
        expect(failure).toMatchObject({ message: expect.stringMatching(/transient/) })
        expect(recovery).toContain('<head>')
      },
    }),
  )
})

describe('server configuration', () => {
  describe('board selection', () => {
    test(
      'selects the only board when BOARD is omitted',
      mint({
        setup: () => ({
          config: { sources: {}, boards: { 'my-board': { panels: [{ id: 'p', type: 'x' }] } } },
        }),
        exercise: ({ config }) => selectBoard(undefined, config),
        verify: (board) => expect(board).toBe('my-board'),
      }),
    )
    test(
      'requires BOARD when a config contains multiple boards',
      mint({
        setup: () => ({
          config: {
            sources: {},
            boards: {
              one: { panels: [{ id: 'p', type: 'x' }] },
              two: { panels: [{ id: 'q', type: 'x' }] },
            },
          },
        }),
        exercise: throws(({ config }) => selectBoard(undefined, config)),
        verify: (error) =>
          expect(error).toMatchObject({ message: expect.stringMatching(/BOARD is required/) }),
      }),
    )
  })

  describe('environment parsing', () => {
    const successfulConfigCases = [
      {
        name: 'trims trailing slashes so the template URL never doubles up',
        env: { ASSET_PATH: 'https://cdn/1.0.0///' },
        expectedConfig: { assetPath: 'https://cdn/1.0.0' },
      },
      {
        name: 'waits for no template by default, so a bad path fails immediately',
        env: { ASSET_PATH: 'https://cdn/1.0.0' },
        expectedConfig: { templateWaitMillis: 0 },
      },
    ] as const
    for (const { name, env, expectedConfig } of successfulConfigCases)
      test(
        name,
        mint({
          setup: () => ({ env }),
          exercise: ({ env }) => loadConfig(env),
          verify: (config) => expect(config).toMatchObject(expectedConfig),
        }),
      )
    test(
      'fails closed when ASSET_PATH is absent',
      mint({
        setup: () => ({ env: {} }),
        exercise: throws(({ env }) => loadConfig(env)),
        verify: (error) =>
          expect(error).toMatchObject({
            message: expect.stringMatching(/ASSET_PATH is required/),
          }),
      }),
    )
    test(
      'rejects a nonsense port rather than defaulting past it',
      mint({
        setup: () => ({ env: { ASSET_PATH: 'https://cdn/1.0.0', PORT: 'banana' } }),
        exercise: throws(({ env }) => loadConfig(env)),
        verify: (error) =>
          expect(error).toMatchObject({
            message: expect.stringMatching(/Invalid server configuration/),
          }),
      }),
    )
  })
})

describe('deployment security posture', () => {
  afterEach(() => vi.unstubAllEnvs())
  const baseConfig = loadConfig({ ASSET_PATH: 'https://cdn/1.0.0', HOST: '0.0.0.0' })
  const board = { sources: {}, boards: { operations: { panels: [{ id: 'demo', type: 'x' }] } } }
  describe('policy resolution', () => {
    const postureCases = [
      {
        name: 'defaults deployed authless boards to a warning',
        config: baseConfig,
        board,
        expectedState: 'warning',
      },
      {
        name: 'keeps authless loopback boards quiet',
        config: { ...baseConfig, host: '127.0.0.1' },
        board,
        expectedState: 'normal',
      },
      {
        name: 'honors an explicitly unsecured board',
        config: baseConfig,
        board: { ...board, security: 'unsecured' as const },
        expectedState: 'normal',
      },
      {
        name: 'allows configured suppression only for soft mode',
        config: { ...baseConfig, allowUnprotectedDashboard: true },
        board,
        expectedState: 'normal',
      },
      {
        name: 'blocks required mode even when suppression is configured',
        config: { ...baseConfig, allowUnprotectedDashboard: true },
        board: { ...board, security: 'required' as const },
        expectedState: 'blocked',
      },
    ] as const
    for (const { name, config, board, expectedState } of postureCases)
      test(
        name,
        mint({
          setup: () => ({ config, board }),
          exercise: ({ config, board }) => deploymentSecurityState(config, board),
          verify: (state) => expect(state).toBe(expectedState),
        }),
      )
  })

  describe('startup and route behavior', () => {
    test(
      'passes the deployed authless warning through to the browser entrypoint',
      mint({
        setup: () => {
          vi.stubEnv('ASSET_PATH', 'https://assets.example.test/client')
          vi.stubEnv('BOARD_CONFIG_URL', 'https://config.example.test/board.yaml')
          vi.stubEnv('BOARD', 'operations')
          vi.stubEnv('HOST', '0.0.0.0')
          return {
            fetcher: vi.fn(async (url: string | URL) =>
              String(url).endsWith('/index.html')
                ? new Response('<html lang="en"><head></head><body></body></html>')
                : new Response(
                    '# yaml-language-server: $schema=https://assets.example.test/client/board-config.schema.json\nboards: {operations: {panels: [{id: demo, type: http-value, url: https://example.invalid/value}]}}\nsources: {}',
                  ),
            ) as unknown as typeof fetch,
          }
        },
        exercise: async ({ fetcher }) => (await startup({ fetcher })).app.request('/'),
        verify: async (entrypoint) => {
          expect(entrypoint.status).toBe(200)
          expect(await entrypoint.text()).toContain('"security":"warning"')
        },
      }),
    )
    test(
      'blocks every API surface without reading source credentials or a client template',
      mint({
        setup: () => {
          vi.stubEnv('ASSET_PATH', 'https://assets.example.test/client')
          vi.stubEnv(
            'BOARD_CONFIG_URL',
            'packages/server/test/fixtures/security-required-board.yaml',
          )
          vi.stubEnv('HOST', '0.0.0.0')
          vi.stubEnv('ALLOW_UNPROTECTED_DASHBOARD', 'true')
          return { fetcher: vi.fn() as unknown as typeof fetch }
        },
        exercise: async ({ fetcher }) => {
          const { app } = await startup({ fetcher })
          return {
            health: await app.request('/health'),
            api: await Promise.all(
              ['/api/client', '/api/boards/operations', '/api/panel/operations/build'].map((path) =>
                app.request(path),
              ),
            ),
            entrypoint: await app.request('/'),
          }
        },
        verify: async ({ health, api, entrypoint }, { fetcher }) => {
          expect(fetcher).not.toHaveBeenCalled()
          expect(health.status).toBe(200)
          for (const response of api) {
            expect(response.status).toBe(503)
            expect(response.headers.get('cache-control')).toBe('no-store')
          }
          expect(entrypoint.status).toBe(503)
          expect(entrypoint.headers.get('cache-control')).toBe('no-store')
          expect(await entrypoint.text()).toMatch(/No dashboard data was loaded/)
        },
      }),
    )
  })
})

describe('startup failure classification', () => {
  afterEach(() => vi.unstubAllEnvs())
  const validBoard =
    '# yaml-language-server: $schema=https://assets.example/board-config.schema.json\nboards: {team: {panels: [{id: demo, type: pipeline-animation-demo}]}}'
  const fetcherFor =
    (failures: { template?: unknown; board?: unknown }): typeof fetch =>
    async (url) => {
      const resource = String(url).endsWith('/index.html') ? 'template' : 'board'
      if (Object.hasOwn(failures, resource)) throw failures[resource]
      return new Response(
        resource === 'template' ? '<html lang="en"><head></head><body></body></html>' : validBoard,
      )
    }
  const cases = [
    {
      name: 'invalid server settings',
      category: 'configuration',
      env: { PORT: 'private-invalid-port' },
      failures: {},
    },
    {
      name: 'template failure with misleading error text',
      category: 'template',
      env: {},
      failures: { template: new Error('secret board credentials private-template') },
    },
    {
      name: 'board read failure with a non-Error rejection',
      category: 'board-config',
      env: {},
      failures: { board: 'ASSET_PATH secret private-board' },
    },
    {
      name: 'credential resolution failure',
      category: 'credentials',
      env: { SECRET_REFERENCE: 'private-invalid-reference' },
      failures: {},
    },
  ] as const
  for (const { name, category, env, failures } of cases)
    test(
      'classifies ' + name + ' at its startup boundary',
      mint({
        setup: () => {
          vi.stubEnv('ASSET_PATH', 'https://private-assets.example')
          vi.stubEnv('BOARD_CONFIG_URL', 'https://private-config.example')
          vi.stubEnv('BOARD', 'team')
          vi.stubEnv('PORT', '3000')
          vi.stubEnv('SECRET_REFERENCE', undefined)
          for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
          return { category, failures, log: vi.fn() }
        },
        exercise: rejects(({ failures, log }) =>
          startup({ fetcher: fetcherFor(failures), logger: { log } }),
        ),
        verify: (error, { category, log }) => {
          expect(error).toMatchObject({
            name: 'StartupFailure',
            diagnostic: { category, supportReference: expect.any(String) },
          })
          expect(log).toHaveBeenCalledTimes(2)
          expect(log.mock.calls[1]?.[0]).toEqual({
            event: 'server.startup_failed',
            serverVersion: process.env.SERVER_RELEASE ?? 'development',
            category,
            supportReference: expect.stringMatching(/^[a-f0-9-]{36}$/),
          })
          expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|ASSET_PATH secret/)
        },
      }),
    )
})
