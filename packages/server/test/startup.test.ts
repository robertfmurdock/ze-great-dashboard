import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { serverReadyEvent } from '../src/logger.ts'
import { deploymentSecurityState, selectBoard, startup } from '../src/startup.ts'
import { fetchTemplate, TemplateCache } from '../src/template.ts'

/**
 * A missing or unfetchable template is a startup failure, loudly — not a 500 per request. A
 * typo'd ASSET_PATH should fail like the misconfiguration it is, at the moment someone can still
 * see the logs.
 */
describe('startup refuses to proceed without a template', () => {
  const failing = (response: () => Promise<Response>) => response as unknown as typeof fetch

  it('names the bad asset path when the template 404s', async () => {
    const fetcher = failing(
      async () => new Response('nope', { status: 404, statusText: 'Not Found' }),
    )

    await expect(fetchTemplate('https://assets.example.com/typo', fetcher)).rejects.toThrow(
      /https:\/\/assets\.example\.com\/typo\/index\.html.*404/s,
    )
  })

  it('names the bad asset path when the host is unreachable', async () => {
    const fetcher = failing(async () => {
      throw new Error('ECONNREFUSED')
    })

    await expect(fetchTemplate('http://127.0.0.1:9/nothing', fetcher)).rejects.toThrow(
      /http:\/\/127\.0\.0\.1:9\/nothing.*ECONNREFUSED/s,
    )
  })

  it('treats an empty template as a failure rather than serving a blank page', async () => {
    const fetcher = failing(async () => new Response('   ', { status: 200 }))

    await expect(fetchTemplate('https://assets.example.com/1.0.0', fetcher)).rejects.toThrow(
      /empty/,
    )
  })

  it('suggests what to check, since this is a configuration problem', async () => {
    const fetcher = failing(async () => new Response('', { status: 500 }))

    await expect(fetchTemplate('https://assets.example.com/1.0.0', fetcher)).rejects.toThrow(
      /ASSET_PATH/,
    )
  })

  it('rejects a template with no <head> at boot rather than per request', async () => {
    const fetcher = failing(
      async () => new Response('<html><body>hi</body></html>', { status: 200 }),
    )

    // Otherwise every single request 500s, and the cause is discovered in production traffic
    // rather than in the startup logs of the deploy that introduced it.
    await expect(fetchTemplate('https://assets.example.com/1.0.0', fetcher)).rejects.toThrow(
      /no <head> element/,
    )
  })
})

describe('configured panel admission', () => {
  afterEach(() => vi.unstubAllEnvs())

  function withStartupEnvironment(
    boardConfigUrl: string,
    assetPath = 'https://assets.example.com/client-2.0.0',
  ) {
    vi.stubEnv('ASSET_PATH', assetPath)
    vi.stubEnv('BOARD_CONFIG_URL', boardConfigUrl)
  }

  it('admits an Azure DevOps pipeline-status panel before resolving credentials or reading Azure', async () => {
    withStartupEnvironment('packages/server/test/fixtures/ado-pipeline-board.yaml')
    const fetcher = vi.fn(
      async () => new Response('<html><head></head><body></body></html>'),
    ) as unknown as typeof fetch

    const result = await startup({ fetcher })

    expect(result.config.board).toBe('operations')
    // Startup fetches only the immutable client template. Its configured ADO operation is not
    // executed until the browser requests the panel (covered by the adapter route contract).
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('admits the release credential smoke board without invoking its configured source', async () => {
    withStartupEnvironment(
      'reference/credential-smoke-board.yaml',
      'https://public-assets.zegreatrob.com/dashboard/0.18.0',
    )
    const fetcher = vi.fn(
      async () => new Response('<html><head></head><body></body></html>'),
    ) as unknown as typeof fetch

    const result = await startup({ fetcher })

    expect(result.config.board).toBe('reference')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects a syntactically valid unsupported panel before credential or upstream access', async () => {
    withStartupEnvironment('packages/server/test/fixtures/unsupported-panel-board.yaml')
    const fetcher = vi.fn(
      async () => new Response('<html><head></head><body></body></html>'),
    ) as unknown as typeof fetch

    await expect(startup({ fetcher })).rejects.toThrow(
      /board "operations", panel "unavailable", source "mystery" \(unsupported-source\), signal "pipeline-status"/,
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('server identity logging', () => {
  it('records the image build identifier without requiring a matching client asset version', () => {
    const config = loadConfig({
      ASSET_PATH: 'https://assets.example.com/dashboard/client-2.0.0',
      SERVER_RELEASE: 'server-1.4.0',
    })

    expect(
      serverReadyEvent({
        board: 'operations',
        host: 'localhost',
        port: 3000,
        serverVersion: config.serverRelease,
      }),
    ).toEqual({
      event: 'server.ready',
      board: 'operations',
      host: 'localhost',
      port: 3000,
      serverVersion: 'server-1.4.0',
    })
  })
})

describe('the template cache', () => {
  it('fetches an immutable version once and reuses it', async () => {
    const fetcher = vi.fn(async () => new Response('<html><head></head></html>', { status: 200 }))
    const cache = new TemplateCache(fetcher as unknown as typeof fetch)

    await Promise.all([cache.get('https://cdn/1.0.0'), cache.get('https://cdn/1.0.0')])
    await cache.get('https://cdn/1.0.0')

    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('keys by asset path so repointing cannot serve the old version', async () => {
    const fetcher = vi.fn(
      async (url: string | URL | Request) =>
        new Response(`<html><head></head><!-- ${String(url)} --></html>`, { status: 200 }),
    )
    const cache = new TemplateCache(fetcher as unknown as typeof fetch)

    expect(await cache.get('https://cdn/1.0.0')).toContain('1.0.0')
    expect(await cache.get('https://cdn/2.0.0')).toContain('2.0.0')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure, so a transient blip is recoverable', async () => {
    let attempt = 0
    const fetcher = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('transient')
      return new Response('<html><head></head></html>', { status: 200 })
    })
    const cache = new TemplateCache(fetcher as unknown as typeof fetch)

    await expect(cache.get('https://cdn/1.0.0')).rejects.toThrow(/transient/)
    await expect(cache.get('https://cdn/1.0.0')).resolves.toContain('<head>')
  })
})

describe('server configuration', () => {
  it('selects the only board when BOARD is omitted', () => {
    expect(
      selectBoard(undefined, {
        sources: {},
        boards: { 'my-board': { panels: [{ id: 'p', type: 'x' }] } },
      }),
    ).toBe('my-board')
  })

  it('requires BOARD when a config contains multiple boards', () => {
    expect(() =>
      selectBoard(undefined, {
        sources: {},
        boards: {
          one: { panels: [{ id: 'p', type: 'x' }] },
          two: { panels: [{ id: 'q', type: 'x' }] },
        },
      }),
    ).toThrow(/BOARD is required/)
  })

  it('fails closed when ASSET_PATH is absent', () => {
    expect(() => loadConfig({})).toThrow(/ASSET_PATH is required/)
  })

  it('trims trailing slashes so the template URL never doubles up', () => {
    expect(loadConfig({ ASSET_PATH: 'https://cdn/1.0.0///' }).assetPath).toBe('https://cdn/1.0.0')
  })

  it('rejects a nonsense port rather than defaulting past it', () => {
    expect(() => loadConfig({ ASSET_PATH: 'https://cdn/1.0.0', PORT: 'banana' })).toThrow(
      /Invalid server configuration/,
    )
  })

  it('waits for no template by default, so a bad path fails immediately', () => {
    // The retry window exists for the local dev race and nothing else. A deployment that quietly
    // retried would turn a typo'd ASSET_PATH into a slow start instead of an error.
    expect(loadConfig({ ASSET_PATH: 'https://cdn/1.0.0' }).templateWaitMillis).toBe(0)
  })
})

describe('deployment security posture', () => {
  const baseConfig = loadConfig({ ASSET_PATH: 'https://cdn/1.0.0', HOST: '0.0.0.0' })
  const board = { sources: {}, boards: { operations: { panels: [{ id: 'demo', type: 'x' }] } } }

  it('defaults deployed authless boards to a warning, while loopback remains quiet', () => {
    expect(deploymentSecurityState(baseConfig, board)).toBe('warning')
    expect(deploymentSecurityState({ ...baseConfig, host: '127.0.0.1' }, board)).toBe('normal')
  })

  it('honors explicit unsecured and suppression only for soft mode', () => {
    expect(deploymentSecurityState(baseConfig, { ...board, security: 'unsecured' })).toBe('normal')
    expect(deploymentSecurityState({ ...baseConfig, allowUnprotectedDashboard: true }, board)).toBe(
      'normal',
    )
    expect(
      deploymentSecurityState(
        { ...baseConfig, allowUnprotectedDashboard: true },
        { ...board, security: 'required' },
      ),
    ).toBe('blocked')
  })

  it('blocks every API surface without reading source credentials or a client template', async () => {
    vi.stubEnv('ASSET_PATH', 'https://assets.example.test/client')
    vi.stubEnv('BOARD_CONFIG_URL', 'packages/server/test/fixtures/security-required-board.yaml')
    vi.stubEnv('HOST', '0.0.0.0')
    vi.stubEnv('ALLOW_UNPROTECTED_DASHBOARD', 'true')
    const fetcher = vi.fn() as unknown as typeof fetch

    const { app } = await startup({ fetcher })
    expect(fetcher).not.toHaveBeenCalled()
    expect((await app.request('/health')).status).toBe(200)
    for (const path of ['/api/client', '/api/boards/operations', '/api/panel/operations/build']) {
      const response = await app.request(path)
      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
    const entrypoint = await app.request('/')
    expect(entrypoint.status).toBe(503)
    expect(entrypoint.headers.get('cache-control')).toBe('no-store')
    expect(await entrypoint.text()).toMatch(/No dashboard data was loaded/)
  })
})

describe('startup failure classification', () => {
  afterEach(() => vi.unstubAllEnvs())

  const validBoard =
    '# yaml-language-server: $schema=https://assets.example/board-config.schema.json\nboards: {team: {panels: [{id: demo, type: pipeline-animation-demo}]}}'
  const template = '<html><head></head><body></body></html>'
  function fetcherFor(failures: { template?: unknown; board?: unknown }): typeof fetch {
    return async (url) => {
      const resource = String(url).endsWith('/index.html') ? 'template' : 'board'
      if (Object.hasOwn(failures, resource)) throw failures[resource]
      return new Response(resource === 'template' ? template : validBoard)
    }
  }

  it.each([
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
  ])('classifies $name at its startup boundary', async ({ category, env, failures }) => {
    vi.stubEnv('ASSET_PATH', 'https://private-assets.example')
    vi.stubEnv('BOARD_CONFIG_URL', 'https://private-config.example')
    vi.stubEnv('BOARD', 'team')
    vi.stubEnv('PORT', '3000')
    vi.stubEnv('SECRET_REFERENCE', undefined)
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value)
    const log = vi.fn()

    await expect(startup({ fetcher: fetcherFor(failures), logger: { log } })).rejects.toMatchObject(
      {
        name: 'StartupFailure',
        diagnostic: { category, supportReference: expect.any(String) },
      },
    )

    expect(log).toHaveBeenCalledTimes(2)
    expect(log.mock.calls[1]?.[0]).toEqual({
      event: 'server.startup_failed',
      serverVersion: process.env.SERVER_RELEASE ?? 'development',
      category,
      supportReference: expect.stringMatching(/^[a-f0-9-]{36}$/),
    })
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-|ASSET_PATH secret/)
  })
})
