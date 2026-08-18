import type { BoardConfig } from '@ze-great-dashboard/shared'
import { describe, expect, it, vi } from 'vitest'
import { fetchHttpValue, permittedHttpValueCalls } from '../src/adapters/http-value.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

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

  it('reports missing paths, unreachable sources, and 304 without inventing a value', async () => {
    const missing = await fetchHttpValue({
      panel,
      requestHeaders: new Headers(),
      fetcher: upstream(JSON.stringify({ version: '1.2.3' })),
    })
    await expect(missing.response.json()).resolves.toMatchObject({
      state: 'error',
      error: { kind: 'upstream-error' },
    })

    const unreachable = await fetchHttpValue({
      panel,
      requestHeaders: new Headers(),
      fetcher: vi.fn(async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
    })
    expect(unreachable.response.status).toBe(200)
    await expect(unreachable.response.json()).resolves.toMatchObject({
      state: 'error',
      error: { kind: 'unreachable' },
    })

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
})
