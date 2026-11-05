import { mint } from '@continuous-excellence/testmints-js/vitest'
import { zipSync } from 'fflate/browser'
import { describe, expect, test, vi } from 'vitest'
import { fetchGithubActionsTestCount } from '../src/adapters/github-actions.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const panel = {
  id: 'tests',
  type: 'test-count',
  source: 'github',
  pipeline: 'main.yml',
  test_results: { artifact: 'ci-evidence', entry: 'test-summary.json' },
} as const
const source = { type: 'github-actions', repo: 'example/repo' } as const
const run = {
  id: 42,
  run_attempt: 2,
  head_sha: 'abc123',
  status: 'completed',
  conclusion: 'success',
  name: 'CI',
  html_url: 'https://github.com/example/repo/actions/runs/42',
  created_at: '2026-10-27T12:00:00Z',
  updated_at: '2026-10-27T12:05:00Z',
}

function archive(summary: object, extras: Record<string, Uint8Array> = {}) {
  return zipSync({
    'test-summary.json': new TextEncoder().encode(JSON.stringify(summary)),
    ...extras,
  })
}

describe('GitHub Actions test-count evidence', () => {
  test(
    'an expired current artifact remains unavailable rather than silently unreported',
    mint({
      setup: () => {
        const fetcher = vi.fn(async (url: string) =>
          url.includes('/runs?')
            ? Response.json({ workflow_runs: [run] })
            : Response.json({
                artifacts: [{ id: 8, name: panel.test_results.artifact, expired: true }],
              }),
        ) as unknown as typeof fetch
        return { fetcher }
      },
      exercise: ({ fetcher }) =>
        fetchGithubActionsTestCount({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({ state: 'error', error: { kind: 'upstream-error' } })
        expect(fetcher).toHaveBeenCalledTimes(2)
      },
    }),
  )
  test(
    'reads and binds one configured artifact summary to its selected workflow run',
    mint({
      setup: () => {
        const counts = { total: 12, passed: 10, failed: 1, skipped: 1 }
        const summary = {
          schemaVersion: 1,
          runId: run.id,
          runAttempt: run.run_attempt,
          headSha: run.head_sha,
          ...counts,
        }
        const fetcher = vi.fn(async (url: string) => {
          if (url.includes('/runs?')) return Response.json({ workflow_runs: [run] })
          if (url.includes('/artifacts?'))
            return Response.json({ artifacts: [{ id: 8, name: 'ci-evidence', expired: false }] })
          return new Response(archive(summary))
        }) as unknown as typeof fetch
        return { fetcher, counts }
      },
      exercise: ({ fetcher }) =>
        fetchGithubActionsTestCount({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result, { fetcher, counts }) => {
        expect(result.envelope).toMatchObject({
          state: 'ok',
          link: run.html_url,
          signal: {
            type: 'test-count',
            status: 'reported',
            run: {
              id: String(run.id),
              attempt: run.run_attempt,
              updatedAt: run.updated_at,
            },
            ...counts,
          },
        })
        expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(3)
      },
    }),
  )

  test(
    'reports an absent configured artifact without inventing a zero total',
    mint({
      setup: () => ({
        fetcher: vi.fn(async (url: string) =>
          url.includes('/runs?')
            ? Response.json({ workflow_runs: [run] })
            : Response.json({ artifacts: [] }),
        ) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsTestCount({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          state: 'ok',
          signal: { type: 'test-count', status: 'not-reported' },
        }),
    }),
  )

  test(
    'rejects a summary that claims a different workflow run',
    mint({
      setup: () => ({
        fetcher: vi.fn(async (url: string) => {
          if (url.includes('/runs?')) return Response.json({ workflow_runs: [run] })
          if (url.includes('/artifacts?'))
            return Response.json({ artifacts: [{ id: 8, name: 'ci-evidence', expired: false }] })
          return new Response(
            archive({
              schemaVersion: 1,
              runId: run.id - 1,
              runAttempt: run.run_attempt,
              headSha: run.head_sha,
              total: 12,
            }),
          )
        }) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsTestCount({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          state: 'error',
          error: { kind: 'upstream-error' },
        }),
    }),
  )

  test(
    'rejects an artifact archive with extra entries before trusting its summary',
    mint({
      setup: () => ({
        fetcher: vi.fn(async (url: string) => {
          if (url.includes('/runs?')) return Response.json({ workflow_runs: [run] })
          if (url.includes('/artifacts?'))
            return Response.json({ artifacts: [{ id: 8, name: 'ci-evidence', expired: false }] })
          return new Response(
            archive(
              {
                schemaVersion: 1,
                runId: run.id,
                runAttempt: run.run_attempt,
                headSha: run.head_sha,
                total: 12,
              },
              { 'untrusted.txt': new TextEncoder().encode('not part of the contract') },
            ),
          )
        }) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsTestCount({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          state: 'error',
          error: { kind: 'upstream-error' },
        }),
    }),
  )

  test(
    'serves the configured test-count panel through the bounded panel route',
    mint({
      setup: () => {
        const total = 12
        const fetcher = vi.fn(async (url: string) => {
          if (url.includes('/runs?')) return Response.json({ workflow_runs: [run] })
          if (url.includes('/artifacts?'))
            return Response.json({ artifacts: [{ id: 8, name: 'ci-evidence', expired: false }] })
          return new Response(
            archive({
              schemaVersion: 1,
              runId: run.id,
              runAttempt: run.run_attempt,
              headSha: run.head_sha,
              total,
            }),
          )
        }) as unknown as typeof fetch
        return {
          total,
          path: `/api/panel/team/${panel.id}`,
          app: createApp({
            config: loadConfig({ ASSET_PATH: 'https://assets.example.test/1.0.0' }),
            boardConfig: {
              sources: { github: source },
              boards: { team: { panels: [panel] } },
            },
            fetcher,
          }),
        }
      },
      exercise: ({ app, path }) => app.request(path),
      verify: async (response, { total }) => {
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          panelId: panel.id,
          state: 'ok',
          signal: { type: 'test-count', status: 'reported', total },
        })
      },
    }),
  )
})

function embeddedRunFixture(
  selectedRun: Omit<typeof run, 'conclusion'> & { conclusion: string | null },
  artifacts: Array<{ id: number; name: string; expired: boolean }>,
  archiveBody = new Uint8Array(),
) {
  const validator = 'run-validator'
  const requestHeaders = { 'if-none-match': validator }
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes('/runs?'))
      return Response.json(
        { workflow_runs: [selectedRun] },
        {
          headers: { etag: validator, 'cache-control': 'max-age=300' },
        },
      )
    if (url.includes(`/runs/${selectedRun.id}/artifacts?`)) return Response.json({ artifacts })
    if (url.includes(`/runs/${selectedRun.id}/jobs?`)) return Response.json({ jobs: [] })
    if (artifacts.some(({ id }) => url.endsWith(`/artifacts/${id}/zip`)))
      return new Response(archiveBody)
    throw new Error(`Unexpected GitHub request: ${url}`)
  }) as unknown as typeof fetch
  const configuredPanel = { ...panel, type: 'pipeline-status' }
  return {
    selectedRun,
    fetcher,
    requestHeaders,
    path: `/api/panel/team/${configuredPanel.id}`,
    app: createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.test/1.0.0' }),
      boardConfig: { sources: { github: source }, boards: { team: { panels: [configuredPanel] } } },
      fetcher,
    }),
  }
}

function expectUncachedSingleRun(response: Response, fetcher: typeof fetch) {
  expect(response.status).toBe(200)
  expect(response.headers.get('etag')).toBeNull()
  expect(response.headers.get('cache-control')).toBeNull()
  const calls = vi.mocked(fetcher).mock.calls
  expect(calls.filter(([url]) => String(url).includes('/runs?'))).toHaveLength(1)
  expect(new Headers(calls[0]?.[1]?.headers).has('if-none-match')).toBe(false)
}

describe('test evidence embedded in a run panel', () => {
  test(
    'reports totals from the selected run without forwarding its cache validator',
    mint({
      setup: () => {
        const selectedRun = { ...run }
        const artifact = { id: 83, name: panel.test_results.artifact, expired: false }
        const counts = { total: 37, passed: 35, failed: 1, skipped: 1 }
        const summary = {
          schemaVersion: 1,
          runId: selectedRun.id,
          runAttempt: selectedRun.run_attempt,
          headSha: selectedRun.head_sha,
          ...counts,
        }
        return {
          counts,
          artifact,
          ...embeddedRunFixture(selectedRun, [artifact], archive(summary)),
        }
      },
      exercise: ({ app, path, requestHeaders }) => app.request(path, { headers: requestHeaders }),
      verify: async (response, { fetcher, selectedRun, counts, artifact }) => {
        expectUncachedSingleRun(response, fetcher)
        expect(await response.json()).toMatchObject({
          state: 'ok',
          link: selectedRun.html_url,
          signal: {
            type: 'pipeline-status',
            status: 'passed',
            sourceRunId: String(selectedRun.id),
            testResults: {
              state: 'ok',
              signal: {
                type: 'test-count',
                status: 'reported',
                ...counts,
                run: {
                  id: String(selectedRun.id),
                  attempt: selectedRun.run_attempt,
                  updatedAt: selectedRun.updated_at,
                },
              },
            },
          },
        })
        const requests = vi.mocked(fetcher).mock.calls.map(([url]) => new URL(String(url)))
        expect(requests.map(({ pathname }) => pathname)).toEqual([
          `/repos/${source.repo}/actions/workflows/${panel.pipeline}/runs`,
          `/repos/${source.repo}/actions/runs/${selectedRun.id}/artifacts`,
          `/repos/${source.repo}/actions/artifacts/${artifact.id}/zip`,
        ])
        expect(requests[1]?.searchParams.get('name')).toBe(artifact.name)
      },
    }),
  )
  test(
    'discloses missing reporting without reading an archive',
    mint({
      setup: () => embeddedRunFixture({ ...run }, []),
      exercise: ({ app, path, requestHeaders }) => app.request(path, { headers: requestHeaders }),
      verify: async (response, { fetcher, selectedRun }) => {
        expectUncachedSingleRun(response, fetcher)
        expect(await response.json()).toMatchObject({
          state: 'ok',
          link: selectedRun.html_url,
          signal: {
            status: 'passed',
            sourceRunId: String(selectedRun.id),
            testResults: { state: 'ok', signal: { type: 'test-count', status: 'not-reported' } },
          },
        })
        const requests = vi.mocked(fetcher).mock.calls.map(([url]) => new URL(String(url)).pathname)
        expect(requests).toEqual([
          `/repos/${source.repo}/actions/workflows/${panel.pipeline}/runs`,
          `/repos/${source.repo}/actions/runs/${selectedRun.id}/artifacts`,
        ])
      },
    }),
  )
  test(
    'keeps queued run evidence pending without requesting artifacts',
    mint({
      setup: () => embeddedRunFixture({ ...run, status: 'queued', conclusion: null }, []),
      exercise: ({ app, path, requestHeaders }) => app.request(path, { headers: requestHeaders }),
      verify: async (response, { fetcher, selectedRun }) => {
        expectUncachedSingleRun(response, fetcher)
        expect(await response.json()).toMatchObject({
          state: 'ok',
          link: selectedRun.html_url,
          signal: {
            status: 'running',
            sourceRunId: String(selectedRun.id),
            testResults: { state: 'ok', signal: { type: 'test-count', status: 'pending' } },
          },
        })
        expect(
          vi.mocked(fetcher).mock.calls.filter(([url]) => String(url).includes('/artifacts')),
        ).toEqual([])
      },
    }),
  )
  test(
    'preserves build status while rejecting a manifest from a different run',
    mint({
      setup: () => {
        const selectedRun = { ...run }
        const summary = {
          schemaVersion: 1,
          runId: selectedRun.id - 1,
          runAttempt: selectedRun.run_attempt,
          headSha: selectedRun.head_sha,
          total: 37,
        }
        return embeddedRunFixture(
          selectedRun,
          [{ id: 8, name: panel.test_results.artifact, expired: false }],
          archive(summary),
        )
      },
      exercise: ({ app, path, requestHeaders }) => app.request(path, { headers: requestHeaders }),
      verify: async (response, { fetcher, selectedRun }) => {
        expectUncachedSingleRun(response, fetcher)
        expect(await response.json()).toMatchObject({
          state: 'ok',
          link: selectedRun.html_url,
          signal: {
            status: 'passed',
            sourceRunId: String(selectedRun.id),
            testResults: { state: 'error', error: { kind: 'upstream-error' } },
          },
        })
      },
    }),
  )
})
