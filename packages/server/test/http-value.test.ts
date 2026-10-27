import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { BoardConfig } from '@ze-great-dashboard/shared'
import { describe, expect, test, vi } from 'vitest'
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

function groupedFactFixture() {
  const grouped = {
    id: 'versions',
    type: 'http-value',
    facts: [
      {
        id: 'api',
        label: 'API',
        url: 'https://api.example.com/version?read-token=private#reading',
        json_path: '$.version',
      },
      {
        id: 'web',
        label: 'Web',
        url: 'https://web.example.com/version',
        link: 'https://status.example.com/web?viewer=private#details',
      },
    ],
  }
  const fetcher = vi.fn(async (url: string | URL) =>
    String(url).includes('api.')
      ? new Response(JSON.stringify({ version: '2.0.0' }), { headers: { etag: 'W/"fact"' } })
      : new Response('unavailable', { status: 503, statusText: 'Unavailable' }),
  ) as unknown as typeof fetch
  return {
    app: createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: { sources: {}, boards: { example: { panels: [grouped] } } },
      fetcher,
    }),
    fetcher,
  }
}

function diagnosticAppFixture() {
  const events: ServerLogEvent[] = []
  return {
    app: createApp({
      config: loadConfig({
        ASSET_PATH: 'https://assets.example.com/1.0.0',
        SERVER_RELEASE: '1.4.0',
      }),
      boardConfig: { sources: {}, boards: { example: { panels: [panel] } } },
      logger: { log: (event) => events.push(event) },
    }),
    events,
  }
}

function sourceAgnosticPanelApp({
  boardConfig = { sources: {}, boards: { example: { panels: [panel] } } },
  fetcher,
  events,
}: {
  boardConfig?: BoardConfig
  fetcher?: typeof fetch
  events?: ServerLogEvent[]
} = {}) {
  return createApp({
    config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
    boardConfig,
    fetcher,
    logger: events ? { log: (event) => events.push(event) } : undefined,
  })
}

describe('the http-value adapter', () => {
  test(
    'constructs the exact configured call and extracts a nested scalar',
    mint({
      setup: () => ({
        panel,
        requestHeaders: new Headers(),
        fetcher: upstream(JSON.stringify({ deployment: { version: '1.2.3' } })),
      }),
      exercise: ({ panel, requestHeaders, fetcher }) =>
        fetchHttpValue({ panel, requestHeaders, fetcher }),
      verify: (result, { panel }) => {
        expect(permittedHttpValueCalls(panel)[0]?.url).toBe(panel.url)
        expect(result.envelope).toMatchObject({
          panelId: 'version',
          state: 'ok',
          observedAt: '2026-08-18T12:00:00.000Z',
          link: panel.url,
          signal: { type: 'http-value', value: '1.2.3' },
        })
      },
    }),
  )

  test(
    'extracts a scalar from a numeric JSON array index',
    mint({
      setup: () => ({
        panel: { ...panel, json_path: '$.response.docs[0].latestVersion' },
        requestHeaders: new Headers(),
        fetcher: upstream(JSON.stringify({ response: { docs: [{ latestVersion: '2.0.0' }] } })),
      }),
      exercise: ({ panel, requestHeaders, fetcher }) =>
        fetchHttpValue({ panel, requestHeaders, fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({ signal: { type: 'http-value', value: '2.0.0' } }),
    }),
  )

  test(
    'supports plain text and forwards validators',
    mint({
      setup: () => ({
        panel: { ...panel, json_path: undefined },
        requestHeaders: new Headers({ 'if-none-match': 'W/"client"' }),
        fetcher: upstream('healthy', { etag: 'W/"fixture"' }),
      }),
      exercise: ({ panel, requestHeaders, fetcher }) =>
        fetchHttpValue({ panel, requestHeaders, fetcher }),
      verify: (_result, { fetcher }) => {
        const headers = vi.mocked(fetcher).mock.calls[0]?.[1]?.headers
        expect(headers).toBeInstanceOf(Headers)
        expect((headers as Headers).get('if-none-match')).toBe('W/"client"')
      },
    }),
  )

  test(
    'reports a missing JSON path with the endpoint as its fallback link',
    mint({
      setup: () => ({
        panel,
        requestHeaders: new Headers(),
        fetcher: upstream(JSON.stringify({ version: '1.2.3' })),
      }),
      exercise: ({ panel, requestHeaders, fetcher }) =>
        fetchHttpValue({ panel, requestHeaders, fetcher }),
      verify: async (missing) => {
        await expect(missing.response.json()).resolves.toMatchObject({
          state: 'error',
          link: panel.url,
          error: { kind: 'upstream-error' },
        })
      },
    }),
  )

  test(
    'reports an unreachable source with the configured fallback link',
    mint({
      setup: () => ({
        panel: { ...panel, link: 'https://service.example.com/status' },
        requestHeaders: new Headers(),
        fetcher: vi.fn(async () => {
          throw new Error('offline')
        }) as unknown as typeof fetch,
      }),
      exercise: ({ panel, requestHeaders, fetcher }) =>
        fetchHttpValue({ panel, requestHeaders, fetcher }),
      verify: async (unreachable) => {
        expect(unreachable.response.status).toBe(200)
        await expect(unreachable.response.json()).resolves.toMatchObject({
          state: 'error',
          link: 'https://service.example.com/status',
          error: { kind: 'unreachable' },
        })
      },
    }),
  )

  test(
    'passes through a 304 without inventing a value',
    mint({
      setup: () => ({
        panel,
        requestHeaders: new Headers(),
        fetcher: vi.fn(async () => new Response(null, { status: 304 })) as unknown as typeof fetch,
      }),
      exercise: ({ panel, requestHeaders, fetcher }) =>
        fetchHttpValue({ panel, requestHeaders, fetcher }),
      verify: (notModified) => expect(notModified.response.status).toBe(304),
    }),
  )
})

describe('the http-value panel route', () => {
  describe('grouped facts', () => {
    test(
      'reads the API fact only at its stable configured address',
      mint({
        setup: groupedFactFixture,
        exercise: ({ app }) => app.request('/api/panel/example/versions/facts/api'),
        verify: async (response, { fetcher }) => {
          expect(response.headers.get('etag')).toBe('W/"fact"')
          await expect(response.json()).resolves.toMatchObject({
            link: 'https://api.example.com/version',
            signal: { value: '2.0.0' },
          })
          expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1)
          expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(
            'https://api.example.com/version?read-token=private#reading',
          )
        },
      }),
    )

    test(
      'renders the web fact failure with its stable configured link',
      mint({
        setup: groupedFactFixture,
        exercise: ({ app }) => app.request('/api/panel/example/versions/facts/web'),
        verify: async (response, { fetcher }) => {
          await expect(response.json()).resolves.toMatchObject({
            state: 'error',
            link: 'https://status.example.com/web',
            error: { kind: 'upstream-error' },
          })
          expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1)
          expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe('https://web.example.com/version')
        },
      }),
    )

    test(
      'rejects an unknown fact without an upstream call',
      mint({
        setup: groupedFactFixture,
        exercise: ({ app }) => app.request('/api/panel/example/versions/facts/unknown'),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(404)
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )

    test(
      'rejects the grouped panel address without an upstream call',
      mint({
        setup: groupedFactFixture,
        exercise: ({ app }) => app.request('/api/panel/example/versions'),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(404)
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )
  })

  test(
    'serves a source-agnostic panel without a named source',
    mint({
      setup: () => ({
        app: sourceAgnosticPanelApp({
          fetcher: upstream(JSON.stringify({ deployment: { version: '1.2.3' } })),
        }),
      }),
      exercise: ({ app }) => app.request('/api/panel/example/version'),
      verify: async (response) => {
        expect(response.status).toBe(200)
        await expect(response.json()).resolves.toMatchObject({ signal: { value: '1.2.3' } })
      },
    }),
  )

  test(
    'does not turn an unknown panel into an arbitrary URL call',
    mint({
      setup: () => {
        const fetcher = upstream('not called')
        return {
          app: sourceAgnosticPanelApp({ fetcher }),
          fetcher,
        }
      },
      exercise: ({ app }) => app.request('/api/panel/example/other'),
      verify: (response, { fetcher }) => {
        expect(response.status).toBe(404)
        expect(fetcher).not.toHaveBeenCalled()
      },
    }),
  )

  test(
    'returns an opaque support reference and logs only safe failure metadata',
    mint({
      setup: () => {
        const events: ServerLogEvent[] = []
        const secret = 'token-like-value-must-not-escape'
        return {
          app: createApp({
            config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
            boardConfig: {
              sources: {},
              boards: {
                example: {
                  panels: [
                    { ...panel, url: `https://service.example.com/version?token=${secret}` },
                  ],
                },
              },
            },
            fetcher: vi.fn(async () => {
              throw new Error(`upstream failed with ${secret}`)
            }) as unknown as typeof fetch,
            logger: { log: (event) => events.push(event) },
          }),
          events,
          secret,
        }
      },
      exercise: ({ app }) => app.request('/api/panel/example/version'),
      verify: async (response, { events, secret }) => {
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
      },
    }),
  )

  test(
    'correlates rejected operations with their API response',
    mint({
      setup: () => {
        const events: ServerLogEvent[] = []
        return {
          app: sourceAgnosticPanelApp({ events }),
          events,
        }
      },
      exercise: ({ app }) => app.request('/api/panel/example/not-configured'),
      verify: (response, { events }) => {
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
      },
    }),
  )

  describe('browser diagnostic claims', () => {
    test(
      'retains normalized public browser diagnostic claims',
      mint({
        setup: () => ({
          ...diagnosticAppFixture(),
          headers: {
            'x-dashboard-client-version': 'client-2.0.0',
            'x-dashboard-client-origin': 'https://dashboard.example.test/a/path?secret=value',
            'x-dashboard-client-asset-id':
              'sha256:376cc4dda23ff1ff5498cfe206fbbb6495b4d0085a939aa53e1335521b0eed1c',
          },
        }),
        exercise: ({ app, headers }) =>
          app.request('/api/panel/example/not-configured', { headers }),
        verify: (_response, { events }) => {
          expect(events).toEqual([
            expect.objectContaining({
              serverVersion: '1.4.0',
              clientVersion: 'client-2.0.0',
              clientOrigin: 'https://dashboard.example.test',
              clientAssetPathMatchesConfigured: true,
            }),
          ])
          expect(JSON.stringify(events)).not.toContain('secret=value')
        },
      }),
    )

    test(
      'drops malformed browser version and origin claims',
      mint({
        setup: () => ({
          ...diagnosticAppFixture(),
          headers: {
            'x-dashboard-client-version': 'bad value with spaces',
            'x-dashboard-client-origin': 'not a URL /private',
            'x-dashboard-client-asset-id':
              'sha256:6d9f5ba76e4d4d1a0a35deca7d74f1ce8b77c02ea7d38be38868e6b224ac7994',
          },
        }),
        exercise: ({ app, headers }) =>
          app.request('/api/panel/example/not-configured', { headers }),
        verify: (_response, { events }) => {
          expect(events).toEqual([
            expect.objectContaining({
              serverVersion: '1.4.0',
              clientAssetPathMatchesConfigured: false,
            }),
          ])
          expect(events[0]).not.toHaveProperty('clientVersion')
          expect(events[0]).not.toHaveProperty('clientOrigin')
        },
      }),
    )

    test(
      'drops an invalid browser asset identifier without retaining its value',
      mint({
        setup: () => ({
          ...diagnosticAppFixture(),
          headers: { 'x-dashboard-client-asset-id': 'https://assets.example.test/private-client' },
        }),
        exercise: ({ app, headers }) =>
          app.request('/api/panel/example/not-configured', { headers }),
        verify: (_response, { events }) => {
          expect(events).toEqual([expect.objectContaining({ serverVersion: '1.4.0' })])
          expect(events[0]).not.toHaveProperty('clientAssetPathMatchesConfigured')
          expect(JSON.stringify(events)).not.toContain('private-client')
        },
      }),
    )
  })

  test(
    'records an upstream HTTP status without retaining its response body',
    mint({
      setup: () => {
        const events: ServerLogEvent[] = []
        const body = 'token-like-response-body'
        return {
          app: sourceAgnosticPanelApp({
            fetcher: vi.fn(
              async () => new Response(body, { status: 503 }),
            ) as unknown as typeof fetch,
            events,
          }),
          body,
          events,
        }
      },
      exercise: ({ app }) => app.request('/api/panel/example/version'),
      verify: async (response, { body, events }) => {
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
      },
    }),
  )

  test(
    'correlates an unexpected API exception with one safe event',
    mint({
      setup: () => {
        const events: ServerLogEvent[] = []
        const brokenConfig: BoardConfig = { sources: {}, boards: { example: { panels: [panel] } } }
        const app = sourceAgnosticPanelApp({
          boardConfig: brokenConfig,
          events,
        })
        Object.defineProperty(brokenConfig.boards.example, 'panels', {
          get() {
            throw new Error('raw upstream and credential text must not be logged')
          },
        })
        return { app, events }
      },
      exercise: ({ app }) => app.request('/api/boards/example'),
      verify: async (response, { events }) => {
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
      },
    }),
  )
})
