import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BoardConfig } from '@ze-great-dashboard/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchAzureDevOpsPipeline,
  permittedAzureDevOpsCalls,
} from '../src/adapters/azure-devops.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { CredentialResolver } from '../src/credentials.ts'

const panel = {
  id: 'service-build',
  type: 'pipeline-status',
  source: 'ado',
  pipeline: 42,
} as const
const source = {
  type: 'azure-devops',
  organization: 'example-org',
  project: 'Example Project',
  branch: 'main',
  token_env: 'ADO_PAT',
} as const
const credentials: CredentialResolver = {
  get: (name) => (name === 'ADO_PAT' ? 'read-token' : undefined),
}
const entraSource = {
  type: 'azure-devops',
  organization: 'example-org',
  project: 'Example Project',
  branch: 'main',
  entra_token_file_env: 'ADO_ENTRA_TOKEN_FILE',
} as const

function build(overrides: Record<string, unknown> = {}) {
  return {
    id: 812,
    buildNumber: '20260831.2',
    status: 'completed',
    result: 'succeeded',
    sourceBranch: 'refs/heads/main',
    startTime: '2026-08-31T12:00:00Z',
    finishTime: '2026-08-31T12:02:14Z',
    lastChangedDate: '2026-08-31T12:02:14Z',
    ...overrides,
  }
}

function upstream(
  value: unknown,
  headers = new Headers({ date: '2026-08-31T12:03:00Z' }),
): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify({ value }), { headers }),
  ) as unknown as typeof fetch
}

describe('the Azure DevOps pipeline adapter', () => {
  it('uses the configured definition and ref-qualified branch in a bounded API call', () => {
    const [call] = permittedAzureDevOpsCalls(panel, source)

    expect(call?.url).toBe(
      'https://dev.azure.com/example-org/Example%20Project/_apis/build/builds?api-version=7.1&definitions=42&branchName=refs%2Fheads%2Fmain&queryOrder=queueTimeDescending&%24top=1',
    )
    expect(call?.headers.get('authorization')).toBeNull()
  })

  it.each([
    ['succeeded', 'completed', 'passed'],
    ['failed', 'completed', 'failed'],
    ['canceled', 'completed', 'cancelled'],
    ['partiallySucceeded', 'completed', 'warning'],
    [null, 'inProgress', 'running'],
    ['unrecognised', 'completed', 'unknown'],
  ] as const)('normalizes ADO result %s and status %s as %s', async (result, status, expected) => {
    const response = await fetchAzureDevOpsPipeline({
      panel,
      source,
      credentials,
      requestHeaders: new Headers(),
      fetcher: upstream([build({ result, status })]),
    })

    expect(response.envelope).toMatchObject({
      panelId: 'service-build',
      state: 'ok',
      observedAt: '2026-08-31T12:03:00.000Z',
      link: 'https://dev.azure.com/example-org/Example%20Project/_build/results?buildId=812',
      signal: {
        type: 'pipeline-status',
        status: expected,
        rawStatus: result ?? status,
        sourceRunId: '812',
        branch: 'refs/heads/main',
        runStartedAt: '2026-08-31T12:00:00Z',
        sourceUpdatedAt: '2026-08-31T12:02:14Z',
        ...(status === 'completed' ? { durationMs: 134_000 } : {}),
      },
    })
  })

  it('attaches a Basic PAT, forwards validators, and derives active timeline work', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('/timeline?')) {
        return new Response(
          JSON.stringify({
            records: [
              { id: 'stage', type: 'Stage', name: 'Deploy', state: 'completed' },
              {
                id: 'task',
                parentId: 'stage',
                type: 'Task',
                name: 'Deploy service',
                state: 'inProgress',
              },
            ],
          }),
        )
      }
      return new Response(
        JSON.stringify({ value: [build({ status: 'inProgress', result: null })] }),
        {
          headers: { etag: 'W/"ado"' },
        },
      )
    }) as unknown as typeof fetch

    const response = await fetchAzureDevOpsPipeline({
      panel,
      source,
      credentials,
      requestHeaders: new Headers({ 'if-none-match': 'W/"browser"' }),
      fetcher,
    })

    expect(response.envelope).toMatchObject({
      signal: { activity: { kind: 'step', name: 'Deploy service', parent: 'Deploy' } },
    })
    const primaryHeaders = vi.mocked(fetcher).mock.calls[0]?.[1]?.headers as Headers
    expect(primaryHeaders.get('authorization')).toBe('Basic OnJlYWQtdG9rZW4=')
    expect(primaryHeaders.get('if-none-match')).toBe('W/"browser"')
    expect(response.response.headers.get('etag')).toBe('W/"ado"')
  })

  it('passes an upstream 304 through unchanged', async () => {
    const response = await fetchAzureDevOpsPipeline({
      panel,
      source,
      credentials,
      requestHeaders: new Headers(),
      fetcher: vi.fn(
        async () => new Response(null, { status: 304, headers: { etag: 'W/"ado"' } }),
      ) as unknown as typeof fetch,
    })

    expect(response.envelope).toBeUndefined()
    expect(response.response.status).toBe(304)
  })

  it('reads a renewable local Entra token file for every request and sends it as Bearer auth', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dashboard-ado-entra-'))
    const tokenFile = join(directory, 'token.json')
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ value: [build()] })),
    ) as unknown as typeof fetch
    const entraCredentials: CredentialResolver = {
      get: (name) => (name === 'ADO_ENTRA_TOKEN_FILE' ? tokenFile : undefined),
    }
    try {
      await writeFile(
        tokenFile,
        JSON.stringify({ accessToken: 'first-token', expiresAt: '2099-01-01T00:00:00.000Z' }),
      )
      await fetchAzureDevOpsPipeline({
        panel,
        source: entraSource,
        credentials: entraCredentials,
        requestHeaders: new Headers(),
        fetcher,
      })
      await writeFile(
        tokenFile,
        JSON.stringify({ accessToken: 'second-token', expiresAt: '2099-01-01T00:00:00.000Z' }),
      )
      await fetchAzureDevOpsPipeline({
        panel,
        source: entraSource,
        credentials: entraCredentials,
        requestHeaders: new Headers(),
        fetcher,
      })
      expect(vi.mocked(fetcher).mock.calls).toHaveLength(2)
      expect(authorizationForCall(fetcher, 0)).toBe('Bearer first-token')
      expect(authorizationForCall(fetcher, 1)).toBe('Bearer second-token')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each([
    ['absent', undefined],
    ['malformed', '{not json'],
    [
      'expired',
      JSON.stringify({ accessToken: 'expired-token', expiresAt: '2000-01-01T00:00:00.000Z' }),
    ],
  ] as const)(
    'reports a %s Entra token file as a non-disclosing unauthorized envelope',
    async (_name, contents) => {
      const directory = await mkdtemp(join(tmpdir(), 'dashboard-ado-entra-'))
      const tokenFile = join(directory, 'sensitive-token-file.json')
      const entraCredentials: CredentialResolver = { get: () => tokenFile }
      try {
        if (contents) await writeFile(tokenFile, contents)
        const result = await fetchAzureDevOpsPipeline({
          panel,
          source: entraSource,
          credentials: entraCredentials,
          requestHeaders: new Headers(),
          fetcher: vi.fn() as unknown as typeof fetch,
        })
        expect(result.response.status).toBe(200)
        const body = await result.response.text()
        expect(body).toContain('"kind":"unauthorized"')
        expect(body).not.toContain(tokenFile)
        expect(body).not.toContain('expired-token')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    },
  )

  it.each([
    ['empty', upstream([]), 'no-runs'],
    [
      'forbidden',
      vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
      'unauthorized',
    ],
    [
      'missing',
      vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
      'not-found',
    ],
    [
      'offline',
      vi.fn(async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
      'unreachable',
    ],
  ] as const)('discloses %s failures as an HTTP-200 envelope', async (_name, fetcher, kind) => {
    const response = await fetchAzureDevOpsPipeline({
      panel,
      source,
      credentials,
      requestHeaders: new Headers(),
      fetcher,
    })

    expect(response.response.status).toBe(200)
    await expect(response.response.json()).resolves.toMatchObject({
      state: 'error',
      link: 'https://dev.azure.com/example-org/Example%20Project/_build',
      error: { kind },
    })
  })
})

function authorizationForCall(fetcher: typeof fetch, callIndex: number): string | null {
  const request = vi.mocked(fetcher).mock.calls.at(callIndex)?.[1]
  const headers = request?.headers
  if (!(headers instanceof Headers)) throw new Error(`request ${callIndex} did not include Headers`)
  return headers.get('authorization')
}

describe('the Azure DevOps panel route', () => {
  const boardConfig: BoardConfig = {
    sources: { ado: source },
    boards: { operations: { panels: [panel] } },
  }

  it('uses the same public panel contract and does not expose undeclared calls', async () => {
    const fetcher = upstream(
      [build()],
      new Headers({ etag: 'W/"ado"', 'cache-control': 'max-age=60' }),
    )
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig,
      credentials,
      fetcher,
    })

    const response = await app.request('/api/panel/operations/service-build')
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('W/"ado"')
    await expect(response.json()).resolves.toMatchObject({
      state: 'ok',
      signal: { status: 'passed' },
    })
    expect((await app.request('/api/panel/operations/not-configured')).status).toBe(404)
  })

  it('keeps the PAT out of the public envelope and rendered entrypoint', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.endsWith('/index.html'))
        return new Response('<!doctype html><html><head></head><body></body></html>')
      return new Response(JSON.stringify({ value: [build()] }))
    }) as unknown as typeof fetch
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig,
      credentials,
      fetcher,
    })

    expect(await (await app.request('/api/panel/operations/service-build')).text()).not.toContain(
      'read-token',
    )
    expect(await (await app.request('/')).text()).not.toContain('read-token')
  })
})
