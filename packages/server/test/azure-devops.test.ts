import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { BoardConfig, PipelineStatus } from '@ze-great-dashboard/shared'
import { describe, expect, test, vi } from 'vitest'
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

function expectAzureDevOpsPipelineStatus(
  response: Awaited<ReturnType<typeof fetchAzureDevOpsPipeline>>,
  result: string | null,
  status: string,
  expectedStatus: PipelineStatus['status'],
) {
  expect(response.envelope).toMatchObject({
    panelId: 'service-build',
    state: 'ok',
    observedAt: '2026-08-31T12:03:00.000Z',
    link: 'https://dev.azure.com/example-org/Example%20Project/_build/results?buildId=812',
    signal: {
      type: 'pipeline-status',
      status: expectedStatus,
      rawStatus: result ?? status,
      sourceRunId: '812',
      branch: 'refs/heads/main',
      runStartedAt: '2026-08-31T12:00:00Z',
      sourceUpdatedAt: '2026-08-31T12:02:14Z',
      ...(status === 'completed' ? { durationMs: 134_000 } : {}),
    },
  })
}

describe('the Azure DevOps pipeline adapter', () => {
  describe('permitted-call derivation', () => {
    test(
      'derives a bounded definition call for the configured ref-qualified branch',
      mint({
        setup: () => ({ panel, source }),
        exercise: ({ panel, source }) => permittedAzureDevOpsCalls(panel, source),
        verify: ([call]) => {
          expect(call?.url).toBe(
            'https://dev.azure.com/example-org/Example%20Project/_apis/build/builds?api-version=7.1&definitions=42&branchName=refs%2Fheads%2Fmain&queryOrder=queueTimeDescending&%24top=1',
          )
          expect(call?.headers.get('authorization')).toBeNull()
        },
      }),
    )
  })

  describe('pipeline observations', () => {
    const azureStatusCases: ReadonlyArray<{
      result: string | null
      status: string
      expectedStatus: PipelineStatus['status']
    }> = [
      { result: 'succeeded', status: 'completed', expectedStatus: 'passed' },
      { result: 'failed', status: 'completed', expectedStatus: 'failed' },
      { result: 'canceled', status: 'completed', expectedStatus: 'cancelled' },
      { result: 'partiallySucceeded', status: 'completed', expectedStatus: 'warning' },
      { result: null, status: 'inProgress', expectedStatus: 'running' },
      { result: 'unrecognised', status: 'completed', expectedStatus: 'unknown' },
    ]

    for (const { result, status, expectedStatus } of azureStatusCases)
      test(
        `normalizes ADO result ${result} and status ${status} as ${expectedStatus}`,
        mint({
          setup: () => ({ fetcher: upstream([build({ result, status })]) }),
          exercise: ({ fetcher }) =>
            fetchAzureDevOpsPipeline({
              panel,
              source,
              credentials,
              requestHeaders: new Headers(),
              fetcher,
            }),
          verify: (response) =>
            expectAzureDevOpsPipelineStatus(response, result, status, expectedStatus),
        }),
      )

    test(
      'sends Basic PAT authentication, relays validators, and derives active timeline work',
      mint({
        setup: () => {
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

          return { fetcher }
        },
        exercise: ({ fetcher }) =>
          fetchAzureDevOpsPipeline({
            panel,
            source,
            credentials,
            requestHeaders: new Headers({ 'if-none-match': 'W/"browser"' }),
            fetcher,
          }),
        verify: (response, { fetcher }) => {
          expect(response.envelope).toMatchObject({
            signal: { activity: { kind: 'step', name: 'Deploy service', parent: 'Deploy' } },
          })
          const primaryHeaders = vi.mocked(fetcher).mock.calls[0]?.[1]?.headers as Headers
          expect(primaryHeaders.get('authorization')).toBe('Basic OnJlYWQtdG9rZW4=')
          expect(primaryHeaders.get('if-none-match')).toBe('W/"browser"')
          expect(response.response.headers.get('etag')).toBe('W/"ado"')
        },
      }),
    )

    test(
      'passes an upstream 304 through unchanged',
      mint({
        setup: () => ({
          fetcher: vi.fn(
            async () => new Response(null, { status: 304, headers: { etag: 'W/"ado"' } }),
          ) as unknown as typeof fetch,
        }),
        exercise: ({ fetcher }) =>
          fetchAzureDevOpsPipeline({
            panel,
            source,
            credentials,
            requestHeaders: new Headers(),
            fetcher,
          }),
        verify: (response) => {
          expect(response.envelope).toBeUndefined()
          expect(response.response.status).toBe(304)
        },
      }),
    )
  })

  describe('renewable Entra file credentials', () => {
    test(
      'reads a renewable local token file for each call and sends fresh Bearer authentication',
      mint({
        setup: async ({ scope }) => {
          const directory = await scope.using(
            'Entra token directory',
            () => mkdtemp(join(tmpdir(), 'dashboard-ado-entra-')),
            (value) => rm(value, { recursive: true, force: true }),
          )
          const tokenFile = join(directory, 'token.json')
          const fetcher = vi.fn(
            async () => new Response(JSON.stringify({ value: [build()] })),
          ) as unknown as typeof fetch
          const entraCredentials: CredentialResolver = {
            get: (name) => (name === 'ADO_ENTRA_TOKEN_FILE' ? tokenFile : undefined),
          }
          await writeFile(
            tokenFile,
            JSON.stringify({ accessToken: 'first-token', expiresAt: '2099-01-01T00:00:00.000Z' }),
          )
          return { tokenFile, fetcher, entraCredentials }
        },
        exercise: async ({ tokenFile, fetcher, entraCredentials }) => {
          const first = await fetchAzureDevOpsPipeline({
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
          const second = await fetchAzureDevOpsPipeline({
            panel,
            source: entraSource,
            credentials: entraCredentials,
            requestHeaders: new Headers(),
            fetcher,
          })
          return { first, second }
        },
        verify: ({ first, second }, { fetcher }) => {
          expect(first.response.status).toBe(200)
          expect(second.response.status).toBe(200)
          expect(vi.mocked(fetcher).mock.calls).toHaveLength(2)
          expect(authorizationForCall(fetcher, 0)).toBe('Bearer first-token')
          expect(authorizationForCall(fetcher, 1)).toBe('Bearer second-token')
        },
      }),
    )

    for (const { condition, contents } of [
      { condition: 'absent', contents: undefined },
      { condition: 'malformed', contents: '{not json' },
      {
        condition: 'expired',
        contents: JSON.stringify({
          accessToken: 'expired-token',
          expiresAt: '2000-01-01T00:00:00.000Z',
        }),
      },
    ] as const)
      test(
        `renders a ${condition} Entra token file as a non-disclosing unauthorized envelope`,
        mint({
          setup: async ({ scope }) => {
            const directory = await scope.using(
              'Entra token directory',
              () => mkdtemp(join(tmpdir(), 'dashboard-ado-entra-')),
              (value) => rm(value, { recursive: true, force: true }),
            )
            const tokenFile = join(directory, 'sensitive-token-file.json')
            if (contents) await writeFile(tokenFile, contents)
            return {
              tokenFile,
              entraCredentials: { get: () => tokenFile } satisfies CredentialResolver,
            }
          },
          exercise: ({ entraCredentials }) =>
            fetchAzureDevOpsPipeline({
              panel,
              source: entraSource,
              credentials: entraCredentials,
              requestHeaders: new Headers(),
              fetcher: vi.fn() as unknown as typeof fetch,
            }),
          verify: async (result, { tokenFile }) => {
            const body = await result.response.text()
            expect(result.response.status).toBe(200)
            expect(body).toContain('"kind":"unauthorized"')
            expect(body).not.toContain(tokenFile)
            expect(body).not.toContain('expired-token')
          },
        }),
      )
  })

  describe('public upstream failures', () => {
    const upstreamFailureCases: ReadonlyArray<{
      failure: string
      response: () => Promise<Response>
      errorKind: string
    }> = [
      {
        failure: 'empty result',
        response: async () => new Response(JSON.stringify({ value: [] })),
        errorKind: 'no-runs',
      },
      {
        failure: 'forbidden upstream response',
        response: async () => new Response(null, { status: 403 }),
        errorKind: 'unauthorized',
      },
      {
        failure: 'missing upstream response',
        response: async () => new Response(null, { status: 404 }),
        errorKind: 'not-found',
      },
      {
        failure: 'offline upstream',
        response: async () => Promise.reject(new Error('offline')),
        errorKind: 'unreachable',
      },
    ]

    for (const { failure, response, errorKind } of upstreamFailureCases)
      test(
        `returns a public HTTP-200 error envelope for ${failure}`,
        mint({
          setup: () => ({ fetcher: vi.fn(response) as unknown as typeof fetch }),
          exercise: ({ fetcher }) =>
            fetchAzureDevOpsPipeline({
              panel,
              source,
              credentials,
              requestHeaders: new Headers(),
              fetcher,
            }),
          verify: async (response) => {
            expect(response.response.status).toBe(200)
            await expect(response.response.json()).resolves.toMatchObject({
              state: 'error',
              link: 'https://dev.azure.com/example-org/Example%20Project/_build',
              error: { kind: errorKind },
            })
          },
        }),
      )
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

  test(
    'serves a configured panel through the shared public contract',
    mint({
      setup: () => {
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

        return { app }
      },
      exercise: ({ app }) => app.request('/api/panel/operations/service-build'),
      verify: async (response) => {
        expect(response.status).toBe(200)
        expect(response.headers.get('etag')).toBe('W/"ado"')
        await expect(response.json()).resolves.toMatchObject({
          state: 'ok',
          signal: { status: 'passed' },
        })
      },
    }),
  )

  test(
    'rejects an undeclared panel without exposing an Azure DevOps call',
    mint({
      setup: () => {
        const fetcher = upstream([build()])
        return {
          fetcher,
          app: createApp({
            config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
            boardConfig,
            credentials,
            fetcher,
          }),
        }
      },
      exercise: ({ app }) => app.request('/api/panel/operations/not-configured'),
      verify: (response, { fetcher }) => {
        expect(response.status).toBe(404)
        expect(fetcher).not.toHaveBeenCalled()
      },
    }),
  )

  test(
    'keeps the PAT out of the public panel envelope',
    mint({
      setup: () => {
        const fetcher = upstream([build()])
        const app = createApp({
          config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
          boardConfig,
          credentials,
          fetcher,
        })

        return { app }
      },
      exercise: ({ app }) => app.request('/api/panel/operations/service-build'),
      verify: async (response) => expect(await response.text()).not.toContain('read-token'),
    }),
  )

  test(
    'keeps the PAT out of the rendered entrypoint',
    mint({
      setup: () => {
        const fetcher = vi.fn(async (url: string) => {
          if (url.endsWith('/index.html'))
            return new Response('<!doctype html><html lang="en"><head></head><body></body></html>')
          return new Response(JSON.stringify({ value: [build()] }))
        }) as unknown as typeof fetch
        return {
          app: createApp({
            config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
            boardConfig,
            credentials,
            fetcher,
          }),
        }
      },
      exercise: ({ app }) => app.request('/'),
      verify: async (response) => expect(await response.text()).not.toContain('read-token'),
    }),
  )
})
