import type { BoardConfig } from '@ze-great-dashboard/shared'
import { describe, expect, it, vi } from 'vitest'
import { fetchHttpValue, permittedHttpValueCalls } from '../src/adapters/http-value.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { ServerLogEvent } from '../src/logger.ts'

const panel = {
  id: 'version',
  type: 'http-value',
  url: 'https://service.example.com/version.json',
  json_path: '$.deployment.version',
} as const

function upstream(
  body: string,
  headers: HeadersInit = { date: '2026-08-18T12:00:00Z' },
): typeof fetch {
  return vi.fn(async () => new Response(body, { headers })) as unknown as typeof fetch
}

describe('the http-value adapter', () => {
  it('constructs the exact configured call and extracts a nested scalar', async () => {
    const fetcher = upstream(JSON.stringify({ deployment: { version: '1.2.3' } }))
    const result = await fetchHttpValue({ panel, requestHeaders: new Headers(), fetcher })

    expect(permittedHttpValueCalls(panel)[0]?.url).toBe(panel.url)
    expect(result.envelope).toMatchObject({
      panelId: 'version',
      state: 'ok',
      observedAt: '2026-08-18T12:00:00.000Z',
      link: panel.url,
      signal: { type: 'http-value', value: '1.2.3' },
    })
  })

  it('extracts a scalar from a numeric JSON array index', async () => {
    const result = await fetchHttpValue({
      panel: { ...panel, json_path: '$.response.docs[0].latestVersion' },
      requestHeaders: new Headers(),
      fetcher: upstream(JSON.stringify({ response: { docs: [{ latestVersion: '2.0.0' }] } })),
    })

    expect(result.envelope).toMatchObject({ signal: { type: 'http-value', value: '2.0.0' } })
  })

  it('supports plain text and forwards validators', async () => {
    const fetcher = upstream('healthy', { etag: 'W/"fixture"' })
    await fetchHttpValue({
      panel: { ...panel, json_path: undefined },
      requestHeaders: new Headers({ 'if-none-match': 'W/"client"' }),
      fetcher,
    })
    const headers = vi.mocked(fetcher).mock.calls[0]?.[1]?.headers
    expect(headers).toBeInstanceOf(Headers)
    expect((headers as Headers).get('if-none-match')).toBe('W/"client"')
  })

  it('reports a missing JSON path with the endpoint as its fallback link', async () => {
    const missing = await fetchHttpValue({
      panel,
      requestHeaders: new Headers(),
      fetcher: upstream(JSON.stringify({ version: '1.2.3' })),
    })
    await expect(missing.response.json()).resolves.toMatchObject({
      state: 'error',
      link: panel.url,
      error: { kind: 'upstream-error' },
    })
  })

  it('reports an unreachable source with the configured fallback link', async () => {
    const unreachable = await fetchHttpValue({
      panel: { ...panel, link: 'https://service.example.com/status' },
      requestHeaders: new Headers(),
      fetcher: vi.fn(async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
    })
    expect(unreachable.response.status).toBe(200)
    await expect(unreachable.response.json()).resolves.toMatchObject({
      state: 'error',
      link: 'https://service.example.com/status',
      error: { kind: 'unreachable' },
    })
  })

  it('passes through a 304 without inventing a value', async () => {
    const notModified = await fetchHttpValue({
      panel,
      requestHeaders: new Headers(),
      fetcher: vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch,
    })
    expect(notModified.response.status).toBe(304)
  })
})

describe('the http-value panel route', () => {
  it('serves a source-agnostic panel without a named source', async () => {
    const boardConfig: BoardConfig = { sources: {}, boards: { example: { panels: [panel] } } }
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig,
      fetcher: upstream(JSON.stringify({ deployment: { version: '1.2.3' } })),
    })
    const response = await app.request('/api/panel/example/version')
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ signal: { value: '1.2.3' } })
  })

  it('does not turn an unknown panel into an arbitrary URL call', async () => {
    const fetcher = upstream('not called')
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: { sources: {}, boards: { example: { panels: [panel] } } },
      fetcher,
    })
    expect((await app.request('/api/panel/example/other')).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns an opaque support reference and logs only safe failure metadata', async () => {
    const events: ServerLogEvent[] = []
    const secret = 'token-like-value-must-not-escape'
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: {
        sources: {},
        boards: {
          example: {
            panels: [{ ...panel, url: `https://service.example.com/version?token=${secret}` }],
          },
        },
      },
      fetcher: vi.fn(async () => {
        throw new Error(`upstream failed with ${secret}`)
      }) as unknown as typeof fetch,
      logger: { log: (event) => events.push(event) },
    })

    const response = await app.request('/api/panel/example/version')
    const reference = response.headers.get('x-dashboard-request-id')
    expect(reference).toMatch(/^[0-9a-f-]{36}$/)
    await expect(response.json()).resolves.toMatchObject({
      error: { kind: 'unreachable', message: expect.stringContaining('could not be reached') },
    })
    expect(events).toEqual([
      expect.objectContaining({
        event: 'panel.observation_failed',
        requestId: reference,
        boardId: 'example',
        panelId: 'version',
        operation: 'read',
        errorKind: 'unreachable',
        destinationOrigin: 'https://service.example.com',
      }),
    ])
    expect(JSON.stringify({ events, reference })).not.toContain(secret)
  })

  it('correlates rejected operations with their API response', async () => {
    const events: ServerLogEvent[] = []
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: { sources: {}, boards: { example: { panels: [panel] } } },
      logger: { log: (event) => events.push(event) },
    })

    const response = await app.request('/api/panel/example/not-configured')
    expect(response.status).toBe(404)
    expect(events).toEqual([
      expect.objectContaining({
        event: 'api.operation_rejected',
        requestId: response.headers.get('x-dashboard-request-id'),
        boardId: 'example',
        panelId: 'not-configured',
        operation: 'read',
      }),
    ])
  })

  it('records an upstream HTTP status without retaining its response body', async () => {
    const events: ServerLogEvent[] = []
    const body = 'token-like-response-body'
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: { sources: {}, boards: { example: { panels: [panel] } } },
      fetcher: vi.fn(async () => new Response(body, { status: 503 })) as unknown as typeof fetch,
      logger: { log: (event) => events.push(event) },
    })

    const response = await app.request('/api/panel/example/version')
    expect(response.status).toBe(200)
    expect(events).toEqual([
      expect.objectContaining({
        event: 'panel.observation_failed',
        requestId: response.headers.get('x-dashboard-request-id'),
        errorKind: 'upstream-error',
        upstreamStatus: 503,
      }),
    ])
    expect(JSON.stringify({ events, response: await response.text() })).not.toContain(body)
  })

  it('correlates an unexpected API exception with one safe event', async () => {
    const events: ServerLogEvent[] = []
    const brokenConfig: BoardConfig = {
      sources: {},
      boards: { example: { panels: [panel] } },
    }
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: brokenConfig,
      logger: { log: (event) => events.push(event) },
    })
    Object.defineProperty(brokenConfig.boards.example, 'panels', {
      get() {
        throw new Error('raw upstream and credential text must not be logged')
      },
    })

    const response = await app.request('/api/boards/example')
    const reference = response.headers.get('x-dashboard-request-id')
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'The dashboard could not complete this request.',
    })
    expect(events).toEqual([
      expect.objectContaining({
        event: 'server.unhandled_exception',
        requestId: reference,
        operation: 'route-handler',
      }),
    ])
    expect(JSON.stringify(events)).not.toContain('credential text')
  })
})
