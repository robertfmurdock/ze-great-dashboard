import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { BoardConfig, Panel } from '@ze-great-dashboard/shared'
import { testHistoryHeader, testHistorySchema } from '@ze-great-dashboard/shared'
import { zipSync } from 'fflate/browser'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const panel: Panel = {
  id: 'tests',
  type: 'test-count',
  source: 'github',
  pipeline: 'ci.yml',
  test_results: { artifact: 'evidence', entry: 'tests.json' },
}
const source = { type: 'github-actions', repo: 'example/repo', branch: 'main' } as const
function run(id: number) {
  return {
    id,
    run_attempt: 1,
    head_sha: `sha-${id}`,
    status: 'completed',
    conclusion: 'success',
    name: 'CI',
    html_url: `https://github.com/example/repo/actions/runs/${id}`,
    updated_at: new Date(Date.UTC(2026, 10, 4, 12, id)).toISOString(),
    created_at: '2026-11-04T12:00:00Z',
  }
}
function archive(selected: ReturnType<typeof run>, total: number, headSha = selected.head_sha) {
  return zipSync({
    'tests.json': new TextEncoder().encode(
      JSON.stringify({
        schemaVersion: 1,
        runId: selected.id,
        runAttempt: selected.run_attempt,
        headSha,
        total,
      }),
    ),
  })
}
function appFixture(
  fetcher: typeof fetch,
  configuredPanel = panel,
  extra: Partial<Parameters<typeof createApp>[0]> = {},
) {
  const boardConfig: BoardConfig = {
    sources: { github: source },
    boards: { team: { panels: [configuredPanel] } },
  }
  return {
    app: createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.test/1.0.0' }),
      boardConfig,
      fetcher,
      ...extra,
    }),
    path: `/api/panel/team/${configuredPanel.id}/test-history`,
  }
}
afterEach(() => vi.useRealTimers())
function clock() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
}

describe('bounded source test history', () => {
  test(
    'reads at most eight runs using configured workflow and branch without validators',
    mint({
      setup: () => {
        clock()
        const runs = Array.from({ length: 10 }, (_, i) => run(i + 1))
        const totals = runs.map((selected) => selected.id * 10)
        const fetcher = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
          const url = new URL(String(input))
          if (url.pathname.endsWith('/runs'))
            return Response.json(
              { workflow_runs: runs },
              { headers: { etag: 'private-validator' } },
            )
          const selected = runs.find(
            (item) =>
              url.pathname.includes(`/runs/${item.id}/`) ||
              url.pathname.includes(`/artifacts/${item.id}/`),
          )
          if (!selected) throw new Error('Unexpected request')
          if (url.pathname.endsWith('/artifacts'))
            return Response.json({
              artifacts: [{ id: selected.id, name: panel.test_results?.artifact, expired: false }],
            })
          return new Response(archive(selected, totals[selected.id - 1] ?? 0))
        })
        return { ...appFixture(fetcher), fetcher, runs, totals }
      },
      exercise: ({ app, path }) =>
        app.request(`${path}?workflow=untrusted.yml&branch=other&limit=100`, {
          headers: { 'if-none-match': 'client-validator' },
        }),
      verify: async (response, { fetcher, runs, totals }) => {
        const result = testHistorySchema.parse(await response.json())
        expect(result).toMatchObject({
          complete: true,
          inspectedRuns: 8,
          samples: runs.slice(0, 8).map((selected, index) => ({
            id: String(selected.id),
            attempt: selected.run_attempt,
            updatedAt: selected.updated_at,
            total: totals[index],
          })),
        })
        expect(fetcher).toHaveBeenCalledTimes(17)
        const first = new URL(String(fetcher.mock.calls[0]?.[0]))
        expect(first.pathname).toBe(
          `/repos/${source.repo}/actions/workflows/${panel.pipeline}/runs`,
        )
        expect(Object.fromEntries(first.searchParams)).toEqual({
          branch: source.branch,
          per_page: '8',
          created: '>=2026-10-22T00:00:00.000Z',
          status: 'completed',
        })
        expect(response.headers.get('etag')).toBeNull()
        expect(response.headers.get('cache-control')).toBe('no-store')
        for (const call of fetcher.mock.calls)
          expect(
            new Headers((call[1] as RequestInit | undefined)?.headers).has('if-none-match'),
          ).toBe(false)
      },
    }),
  )
  const missingCases = [
    { name: 'absent', artifacts: [] },
    { name: 'expired', artifacts: [{ id: 1, name: 'evidence', expired: true }] },
  ]
  for (const scenario of missingCases)
    test(
      `${scenario.name} artifacts leave an empty completed inspection rather than zero`,
      mint({
        setup: () => {
          clock()
          const fetcher = vi.fn(async (input: string | URL | Request) =>
            String(input).includes('/runs?')
              ? Response.json({ workflow_runs: [run(1)] })
              : Response.json({ artifacts: scenario.artifacts }),
          )
          return { ...appFixture(fetcher), fetcher }
        },
        exercise: ({ app, path }) => app.request(path),
        verify: async (response, { fetcher }) => {
          expect(await response.json()).toMatchObject({
            complete: true,
            inspectedRuns: 1,
            samples: [],
          })
          expect(fetcher).toHaveBeenCalledTimes(2)
        },
      }),
    )
  test(
    'a mismatched manifest leaves partial history and continues inspecting later runs',
    mint({
      setup: () => {
        clock()
        const runs = [run(1), run(2)]
        const total = 37
        const fetcher = vi.fn(async (input: string | URL | Request) => {
          const url = String(input)
          if (url.includes('/runs?')) return Response.json({ workflow_runs: runs })
          if (url.includes('/runs/1/artifacts'))
            return Response.json({ artifacts: [{ id: 1, name: 'evidence', expired: false }] })
          if (url.includes('/runs/2/artifacts'))
            return Response.json({ artifacts: [{ id: 2, name: 'evidence', expired: false }] })
          if (url.includes('/artifacts/1/zip'))
            return new Response(archive(runs[0] ?? run(1), total, 'wrong-commit'))
          return new Response(archive(runs[1] ?? run(2), total))
        })
        return { ...appFixture(fetcher), fetcher, total, retained: runs[1] }
      },
      exercise: ({ app, path }) => app.request(path),
      verify: async (response, { total, retained, fetcher }) => {
        expect(await response.json()).toMatchObject({
          complete: false,
          inspectedRuns: 2,
          samples: [{ id: String(retained?.id), total }],
        })
        expect(fetcher).toHaveBeenCalledTimes(5)
      },
    }),
  )
  for (const status of [401, 403, 429])
    test(
      `upstream ${status} stops further artifact requests and exposes retry timing`,
      mint({
        setup: () => {
          clock()
          const retrySeconds = 7200
          const fetcher = vi.fn(async (input: string | URL | Request) =>
            String(input).includes('/runs?')
              ? Response.json({ workflow_runs: [run(1), run(2)] })
              : new Response(null, { status, headers: { 'retry-after': String(retrySeconds) } }),
          )
          return {
            ...appFixture(fetcher),
            fetcher,
            retryAt: new Date(Date.now() + retrySeconds * 1000).toISOString(),
          }
        },
        exercise: ({ app, path }) => app.request(path),
        verify: async (response, { fetcher, retryAt }) => {
          expect(await response.json()).toMatchObject({
            complete: false,
            inspectedRuns: 1,
            samples: [],
            retryAt,
          })
          expect(fetcher).toHaveBeenCalledTimes(2)
        },
      }),
    )
})

describe('test-history operation admission', () => {
  const unsupported: { name: string; panel: Panel }[] = [
    {
      name: 'pipeline without configured test results',
      panel: { id: 'build', type: 'pipeline-status', source: 'github', pipeline: 'ci.yml' },
    },
    {
      name: 'unrelated panel type',
      panel: { id: 'value', type: 'http-value', url: 'https://example.test/version' },
    },
  ]
  for (const scenario of unsupported)
    test(
      `rejects ${scenario.name} before any source request`,
      mint({
        setup: () => {
          const fetcher = vi.fn<typeof fetch>()
          return { ...appFixture(fetcher, scenario.panel), fetcher }
        },
        exercise: ({ app, path }) => app.request(path),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(404)
          expect(fetcher).not.toHaveBeenCalled()
        },
      }),
    )
  test(
    'requires authentication before any source request',
    mint({
      setup: () => {
        const fetcher = vi.fn<typeof fetch>()
        const boardConfig: BoardConfig = {
          auth: {
            issuer: 'https://issuer.example.test',
            client_id: 'dashboard',
            audience: 'api',
            allow: { subjects: ['allowed'] },
          },
          sources: { github: source },
          boards: { team: { panels: [panel] } },
        }
        return {
          ...appFixture(fetcher, panel, {
            boardConfig,
            accessTokenVerifier: async () => ({ subject: 'allowed' }),
          }),
          fetcher,
        }
      },
      exercise: ({ app, path }) => app.request(path),
      verify: (response, { fetcher }) => {
        expect(response.status).toBe(401)
        expect(fetcher).not.toHaveBeenCalled()
      },
    }),
  )
  for (const type of ['test-count', 'pipeline-status'])
    test(
      `${type} advertises its configured history operation`,
      mint({
        setup: () => {
          const fetcher = vi.fn(async () => Response.json({ workflow_runs: [] }))
          return appFixture(fetcher, { ...panel, type })
        },
        exercise: ({ app, path }) => app.request(path.replace('/test-history', '')),
        verify: (response) => expect(response.headers.get(testHistoryHeader)).toBe('supported'),
      }),
    )
})
