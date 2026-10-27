import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { BoardConfig, PipelineStatus } from '@ze-great-dashboard/shared'
import { describe, expect, test, vi } from 'vitest'
import {
  fetchGithubActionsPipeline,
  fetchGithubActionsPullRequestBuild,
  fetchGithubActionsPullRequestCandidates,
  fetchGithubActionsUpdateWorkflow,
  permittedGithubActionsCalls,
} from '../src/adapters/github-actions.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { CredentialResolver } from '../src/credentials.ts'

const fixtureDirectory = new URL('../../../fixtures/github-actions/', import.meta.url)
const panel = {
  id: 'web-build',
  type: 'pipeline-status',
  source: 'github',
  pipeline: 'build.yml',
} as const
const source = { type: 'github-actions', repo: 'example-org/example-repo' } as const
const TEMPLATE = '<!doctype html><html><head></head><body></body></html>'
const githubCredentials: CredentialResolver = {
  get: (name) => (name === 'GITHUB_TOKEN' ? 'secret-token' : undefined),
}

function fixture(name: string): unknown {
  const file = new URL(`workflow-run-${name}.json`, fixtureDirectory)
  return JSON.parse(readFileSync(fileURLToPath(file), 'utf-8'))
}

function upstream(
  name: string,
  headers = new Headers({ date: '2026-08-17T14:32:05Z' }),
): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify({ workflow_runs: [fixture(name)] }), { headers }),
  ) as unknown as typeof fetch
}

function upstreamRuns(runs: unknown[]): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ workflow_runs: runs }), {
        headers: { date: '2026-08-17T14:32:05Z' },
      }),
  ) as unknown as typeof fetch
}

function upstreamRunWithJobs(run: unknown, jobs: unknown[], jobsStatus = 200): typeof fetch {
  return vi.fn(async (url: string) => {
    if (url.includes('/actions/runs/'))
      return new Response(JSON.stringify({ jobs }), { status: jobsStatus })
    return new Response(JSON.stringify({ workflow_runs: [run] }), {
      headers: { date: '2026-08-17T14:32:05Z' },
    })
  }) as unknown as typeof fetch
}

describe('the GitHub Actions adapter', () => {
  const recordedRunCases: ReadonlyArray<{
    fixtureName: string
    expectedSignal: Partial<PipelineStatus>
  }> = [
    {
      fixtureName: 'success',
      expectedSignal: {
        status: 'passed',
        durationMs: 134_000,
        sourceRunId: expect.any(String),
        sourceUpdatedAt: expect.any(String),
      },
    },
    {
      fixtureName: 'failure',
      expectedSignal: {
        status: 'failed',
        durationMs: 53_000,
        sourceUpdatedAt: expect.any(String),
      },
    },
    {
      fixtureName: 'in-progress',
      expectedSignal: { status: 'running', sourceUpdatedAt: expect.any(String) },
    },
    {
      fixtureName: 'cancelled',
      expectedSignal: {
        status: 'cancelled',
        durationMs: 550_000,
        sourceUpdatedAt: expect.any(String),
      },
    },
  ]

  for (const { fixtureName, expectedSignal } of recordedRunCases)
    test(
      `normalizes the recorded ${fixtureName} run as ${expectedSignal.status}`,
      mint({
        setup: () => ({ fetcher: upstream(fixtureName) }),
        exercise: ({ fetcher }) =>
          fetchGithubActionsPipeline({
            panel,
            source,
            requestHeaders: new Headers(),
            fetcher,
          }),
        verify: (result) => {
          expect(result.envelope).toMatchObject({
            panelId: 'web-build',
            state: 'ok',
            observedAt: '2026-08-17T14:32:05.000Z',
            signal: {
              type: 'pipeline-status',
              ...expectedSignal,
            },
          })
        },
      }),
    )

  test(
    'uses the configured workflow without filtering when no branch is configured',
    mint({
      setup: () => ({ panel, source }),
      exercise: ({ panel, source }) => permittedGithubActionsCalls(panel, source),
      verify: ([call]) => {
        expect(call?.url).toBe(
          'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs?per_page=1',
        )
      },
    }),
  )

  test(
    'filters workflow runs to the configured branch',
    mint({
      setup: () => ({ panel, source: { ...source, branch: 'trunk' } }),
      exercise: ({ panel, source }) => permittedGithubActionsCalls(panel, source),
      verify: ([call]) => {
        expect(call?.url).toBe(
          'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs?branch=trunk&per_page=1',
        )
      },
    }),
  )

  test(
    'first requests up to 100 workflow runs created in the last 30 UTC days',
    mint({
      setup: ({ scope }) => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-31T12:00:00.000Z'))
        scope.defer('real clock', () => vi.useRealTimers())
        return { fetcher: upstream('success'), source: { ...source, branch: 'trunk' } }
      },
      exercise: ({ fetcher, source }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (_, { fetcher }) => {
        expect(vi.mocked(fetcher).mock.calls[0]?.[0]).toBe(
          'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs?branch=trunk&created=%3E%3D2026-08-01T12%3A00%3A00.000Z&per_page=100',
        )
      },
    }),
  )

  test(
    'selects the newest created run when GitHub returns an unordered bounded page',
    mint({
      setup: () => {
        const run = (id: number, createdAt: string, conclusion: 'success' | 'failure') => ({
          id,
          status: 'completed',
          conclusion,
          name: 'Build',
          html_url: `https://github.com/example-org/example-repo/actions/runs/${id}`,
          created_at: createdAt,
        })
        return {
          fetcher: upstreamRuns([
            run(1, '2026-08-17T10:00:00Z', 'success'),
            run(3, '2026-08-17T12:00:00Z', 'failure'),
            run(2, '2026-08-17T11:00:00Z', 'success'),
          ]),
        }
      },
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          link: 'https://github.com/example-org/example-repo/actions/runs/3',
          signal: { status: 'failed', sourceRunId: '3' },
        }),
    }),
  )

  test(
    'falls back once to the original unbounded lookup only when the recent window is empty',
    mint({
      setup: () => ({
        fetcher: vi
          .fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ workflow_runs: [] })))
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ workflow_runs: [fixture('success')] })),
          ) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({ state: 'ok', signal: { status: 'passed' } })
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(vi.mocked(fetcher).mock.calls[1]?.[0]).toBe(
          'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs?per_page=1',
        )
      },
    }),
  )

  test(
    'exposes the actual run branch when the source is not branch-filtered',
    mint({
      setup: () => ({
        fetcher: upstreamRuns([
          {
            status: 'completed',
            conclusion: 'success',
            name: 'Build',
            html_url: 'https://github.com/example-org/example-repo/actions/runs/1',
            head_branch: 'feature/ship-it',
          },
        ]),
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({ signal: { branch: 'feature/ship-it' } }),
    }),
  )

  test(
    'keeps credentials out of the pure permitted-call declaration',
    mint({
      setup: () => ({ panel, source: { ...source, token_env: 'GITHUB_TOKEN' } }),
      exercise: ({ panel, source }) =>
        permittedGithubActionsCalls(panel, source, githubCredentials),
      verify: ([call]) => expect(call?.headers.get('authorization')).toBeNull(),
    }),
  )

  test(
    'forwards validators upstream',
    mint({
      setup: () => ({
        fetcher: upstream('success'),
        requestHeaders: new Headers({ 'if-none-match': 'W/"fixture"' }),
      }),
      exercise: ({ fetcher, requestHeaders }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders, fetcher }),
      verify: (_, { fetcher }) => {
        expect(fetcher).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ headers: expect.any(Headers) }),
        )
        const options = vi.mocked(fetcher).mock.calls[0]?.[1]
        expect(options?.headers).toBeInstanceOf(Headers)
        expect((options?.headers as Headers | undefined)?.get('if-none-match')).toBe('W/"fixture"')
      },
    }),
  )

  test(
    'uses the newest run without deriving client timing history on the server',
    mint({
      setup: () => {
        const run = (status: string, started: string | null, updated: string | undefined) => ({
          status,
          conclusion: status === 'completed' ? 'success' : null,
          name: 'Build',
          html_url: 'https://github.com/example-org/example-repo/actions/runs/1',
          run_started_at: started,
          ...(updated ? { updated_at: updated } : {}),
        })
        return {
          fetcher: upstreamRuns([
            run('in_progress', '2026-08-17T14:00:00Z', '2026-08-17T14:32:00Z'),
            run('completed', '2026-08-17T12:00:00Z', '2026-08-17T12:01:40Z'),
            run('completed', '2026-08-17T12:00:00Z', '2026-08-17T12:03:20Z'),
            run('completed', '2026-08-17T12:00:00Z', '2026-08-17T12:05:00Z'),
            run('completed', 'not-a-date', '2026-08-17T12:05:00Z'),
          ]),
        }
      },
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) => {
        expect(result.envelope).toMatchObject({
          signal: { status: 'running', runStartedAt: '2026-08-17T14:00:00Z' },
        })
        expect(
          result.envelope?.state === 'ok' ? result.envelope.signal : undefined,
        ).not.toHaveProperty('estimatedDurationMs')
      },
    }),
  )

  test(
    'extracts the active job and step from one bounded jobs request',
    mint({
      setup: () => {
        const run = {
          id: 42,
          status: 'in_progress',
          conclusion: null,
          name: 'Build',
          html_url: 'https://github.com/example-org/example-repo/actions/runs/42',
          run_started_at: '2026-08-17T14:00:00Z',
          updated_at: '2026-08-17T14:32:00Z',
        }
        return {
          fetcher: upstreamRunWithJobs(run, [
            { name: 'deploy', status: 'queued', steps: [] },
            {
              name: 'build',
              status: 'in_progress',
              steps: [
                { name: 'checkout', status: 'completed' },
                { name: 'integration tests', status: 'in_progress' },
              ],
            },
          ]),
        }
      },
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({
          signal: {
            status: 'running',
            activity: { kind: 'step', name: 'integration tests', parent: 'build' },
          },
        })
        expect(fetcher).toHaveBeenCalledTimes(2)
        expect(fetcher).toHaveBeenCalledWith(
          'https://api.github.com/repos/example-org/example-repo/actions/runs/42/jobs?per_page=100',
          expect.anything(),
        )
      },
    }),
  )

  const activeRun = {
    id: 42,
    status: 'in_progress',
    conclusion: null,
    name: 'Build',
    html_url: 'https://github.com/example-org/example-repo/actions/runs/42',
  }

  test(
    'falls back to a queued job when no step is active',
    mint({
      setup: () => ({
        fetcher: upstreamRunWithJobs(activeRun, [{ name: 'integration tests', status: 'queued' }]),
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          signal: { activity: { kind: 'job', name: 'integration tests' } },
        }),
    }),
  )

  test(
    'falls back to the active job name when its steps are complete',
    mint({
      setup: () => ({
        fetcher: upstreamRunWithJobs(activeRun, [
          { name: 'build', status: 'in_progress', steps: [{ name: 'setup', status: 'completed' }] },
        ]),
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          signal: { activity: { kind: 'job', name: 'build' } },
        }),
    }),
  )

  test(
    'keeps the running signal when the jobs request fails',
    mint({
      setup: () => ({ fetcher: upstreamRunWithJobs(activeRun, [], 503) }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) => {
        expect(result.envelope).toMatchObject({ signal: { status: 'running' } })
        expect(
          result.envelope?.state === 'ok' ? result.envelope.signal : undefined,
        ).not.toHaveProperty('activity')
      },
    }),
  )

  test(
    'does not request jobs for completed runs',
    mint({
      setup: () => ({
        fetcher: upstreamRunWithJobs(
          {
            id: 42,
            status: 'completed',
            conclusion: 'success',
            name: 'Build',
            html_url: 'https://github.com/example-org/example-repo/actions/runs/42',
          },
          [{ name: 'should not be read', status: 'in_progress' }],
        ),
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (_, { fetcher }) => expect(fetcher).toHaveBeenCalledTimes(1),
    }),
  )

  test(
    'omits timing advice when completed history has missing or invalid timestamps',
    mint({
      setup: () => ({
        fetcher: upstreamRuns([
          {
            status: 'in_progress',
            conclusion: null,
            name: 'Build',
            html_url: 'https://github.com/example-org/example-repo/actions/runs/1',
            run_started_at: 'not-a-date',
          },
          {
            status: 'completed',
            conclusion: 'success',
            name: 'Build',
            html_url: 'https://github.com/example-org/example-repo/actions/runs/2',
            run_started_at: null,
            updated_at: '2026-08-17T12:05:00Z',
          },
        ]),
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result) => {
        expect(result.envelope).toMatchObject({ signal: { status: 'running' } })
        expect(result.envelope?.state === 'ok' && result.envelope.signal).not.toHaveProperty(
          'estimatedDurationMs',
        )
      },
    }),
  )

  test(
    'reports an unreachable upstream as data, not a proxy 5xx',
    mint({
      setup: () => ({
        fetcher: vi.fn(async () => {
          throw new Error('offline')
        }) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: async (result) => {
        expect(result.response.status).toBe(200)
        await expect(result.response.json()).resolves.toMatchObject({
          state: 'error',
          link: 'https://github.com/example-org/example-repo/actions/workflows/build.yml',
          error: { kind: 'unreachable' },
        })
      },
    }),
  )

  test(
    'identifies an empty branch result without exposing a schema error',
    mint({
      setup: () => ({
        fetcher: vi.fn(
          async () =>
            new Response(JSON.stringify({ workflow_runs: [] }), {
              headers: { date: '2026-08-17T14:32:05Z' },
            }),
        ) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPipeline({
          panel,
          source: { ...source, branch: 'master' },
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: async (result) => {
        await expect(result.response.json()).resolves.toMatchObject({
          state: 'error',
          error: {
            kind: 'no-runs',
            message:
              'No matching workflow runs were found. Check the configured workflow and branch.',
          },
        })
      },
    }),
  )
})

describe('the panel route', () => {
  const boardConfig: BoardConfig = {
    sources: { github: source },
    boards: { 'ze-great-team': { panels: [panel] } },
  }

  test(
    'serves a normalized envelope and relays cache metadata',
    mint({
      setup: () => ({
        app: createApp({
          config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
          boardConfig,
          fetcher: upstream(
            'success',
            new Headers({
              date: '2026-08-17T14:32:05Z',
              etag: 'W/"fixture"',
              'cache-control': 'max-age=60',
            }),
          ),
        }),
      }),
      exercise: ({ app }) => app.request('/api/panel/ze-great-team/web-build'),
      verify: async (response) => {
        expect(response.status).toBe(200)
        expect(response.headers.get('etag')).toBe('W/"fixture"')
        expect(response.headers.get('cache-control')).toBe('max-age=60')
        await expect(response.json()).resolves.toMatchObject({
          state: 'ok',
          signal: { status: 'passed' },
        })
      },
    }),
  )

  function privateGithubAppFixture() {
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://assets.example.com/1.0.0/index.html') return new Response(TEMPLATE)
      return new Response(JSON.stringify({ workflow_runs: [fixture('success')] }))
    }) as unknown as typeof fetch
    return createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: {
        sources: { github: { ...source, token_env: 'GITHUB_TOKEN' } },
        boards: { 'ze-great-team': { panels: [panel] } },
      },
      credentials: githubCredentials,
      fetcher,
    })
  }

  test(
    'keeps a resolved token out of the panel response',
    mint({
      setup: () => ({ app: privateGithubAppFixture() }),
      exercise: ({ app }) => app.request('/api/panel/ze-great-team/web-build'),
      verify: async (response) => {
        expect(response.status).toBe(200)
        expect(await response.text()).not.toContain('secret-token')
      },
    }),
  )

  test(
    'keeps a resolved token out of the entrypoint document',
    mint({
      setup: () => ({ app: privateGithubAppFixture() }),
      exercise: ({ app }) => app.request('/'),
      verify: async (response) => expect(await response.text()).not.toContain('secret-token'),
    }),
  )

  test(
    'does not turn unknown panel names into arbitrary upstream calls',
    mint({
      setup: () => {
        const fetcher = upstream('success')
        return {
          fetcher,
          app: createApp({
            config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
            boardConfig,
            fetcher,
          }),
        }
      },
      exercise: ({ app }) => app.request('/api/panel/ze-great-team/not-configured'),
      verify: (response, { fetcher }) => {
        expect(response.status).toBe(404)
        expect(fetcher).not.toHaveBeenCalled()
      },
    }),
  )
})

describe('pull-request-health observations', () => {
  const healthPanel = {
    id: 'updates',
    type: 'pull-request-health',
    source: 'github',
    base_branch: 'master',
    update_workflows: [
      { workflow: 'dependency-update.yml', branch_prefixes: ['cpr-gradle-update/'] },
    ],
    build_workflow: 'main.yml',
  } as const
  const healthSource = { type: 'github-actions', repo: 'example-org/example-repo' } as const
  const successfulRun = {
    status: 'completed',
    conclusion: 'success',
    name: 'Build',
    html_url: 'https://github.com/example-org/example-repo/actions/runs/1',
    head_branch: 'cpr-gradle-update/create-update-branch/42',
  }

  function healthObservationFetcher(): typeof fetch {
    return vi.fn(async (url: string) => {
      if (url.includes('/pulls?'))
        return new Response(
          JSON.stringify([
            {
              number: 42,
              html_url: 'https://github.com/example-org/example-repo/pull/42',
              head: { ref: 'cpr-gradle-update/create-update-branch/42' },
              base: { ref: 'master' },
            },
            {
              number: 99,
              html_url: 'https://github.com/example-org/example-repo/pull/99',
              head: { ref: 'feature/manual' },
              base: { ref: 'master' },
            },
          ]),
        )
      return new Response(JSON.stringify({ workflow_runs: [successfulRun] }))
    }) as unknown as typeof fetch
  }

  test(
    'normalizes configured pull-request candidates',
    mint({
      setup: () => ({ fetcher: healthObservationFetcher() }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPullRequestCandidates({
          panel: healthPanel,
          source: healthSource,
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          state: 'ok',
          link: 'https://github.com/example-org/example-repo',
          signal: { type: 'pull-request-candidates', pullRequests: [{ number: 42 }] },
        }),
    }),
  )

  test(
    'normalizes the configured update workflow',
    mint({
      setup: () => ({ fetcher: healthObservationFetcher() }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsUpdateWorkflow({
          panel: healthPanel,
          source: healthSource,
          workflow: 'dependency-update.yml',
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          signal: { type: 'pull-request-workflow', item: { status: 'passed' } },
        }),
    }),
  )

  test(
    'normalizes a prefix-authorized pull-request build',
    mint({
      setup: () => ({ fetcher: healthObservationFetcher() }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPullRequestBuild({
          panel: healthPanel,
          source: healthSource,
          branch: 'cpr-gradle-update/create-update-branch/42',
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({
          signal: {
            type: 'pull-request-build',
            branch: 'cpr-gradle-update/create-update-branch/42',
            item: { status: 'passed' },
          },
        })
        expect(fetcher).toHaveBeenCalledWith(
          expect.stringContaining('branch=cpr-gradle-update%2Fcreate-update-branch%2F42'),
          expect.anything(),
        )
        expect(fetcher).toHaveBeenCalledWith(
          expect.not.stringContaining('event='),
          expect.anything(),
        )
      },
    }),
  )

  test(
    'uses the bearer header on private observation requests',
    mint({
      setup: () => ({
        fetcher: vi.fn(async (url: string) =>
          url.includes('/pulls?')
            ? new Response(JSON.stringify([]))
            : new Response(JSON.stringify({ workflow_runs: [successfulRun] })),
        ) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPullRequestCandidates({
          panel: healthPanel,
          source: { ...healthSource, token_env: 'GITHUB_TOKEN' },
          requestHeaders: new Headers(),
          fetcher,
          credentials: githubCredentials,
        }),
      verify: (_, { fetcher }) => {
        for (const [, options] of vi.mocked(fetcher).mock.calls) {
          const headers = options?.headers
          if (!(headers instanceof Headers)) throw new Error('GitHub call had no Headers')
          expect(headers.get('authorization')).toBe('Bearer secret-token')
        }
      },
    }),
  )

  test(
    'uses an update workflow run only when its branch matches that workflow prefix',
    mint({
      setup: () => ({
        fetcher: vi.fn(async (url: string) =>
          url.includes('/pulls?')
            ? new Response(JSON.stringify([]))
            : new Response(
                JSON.stringify({
                  workflow_runs: [
                    { ...successfulRun, conclusion: 'failure', head_branch: 'master' },
                    {
                      ...successfulRun,
                      html_url: 'https://github.com/example-org/example-repo/actions/runs/2',
                      head_branch: 'cpr-gradle-update/create-update-branch/42',
                    },
                  ],
                }),
              ),
        ) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsUpdateWorkflow({
          panel: healthPanel,
          source: healthSource,
          workflow: 'dependency-update.yml',
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({
          state: 'ok',
          signal: { type: 'pull-request-workflow', item: { status: 'passed' } },
        })
        expect(fetcher).toHaveBeenCalledWith(
          expect.stringContaining('dependency-update.yml/runs?per_page=100'),
          expect.anything(),
        )
      },
    }),
  )

  test(
    'normalizes a failing PR build from an allowed update branch',
    mint({
      setup: () => ({
        fetcher: vi.fn(async (url: string) => {
          if (url.includes('/pulls?'))
            return new Response(
              JSON.stringify([
                {
                  number: 42,
                  html_url: 'https://github.com/example-org/example-repo/pull/42',
                  head: { ref: 'cpr-gradle-update/create-update-branch/42' },
                  base: { ref: 'master' },
                },
              ]),
            )
          const run = url.includes('branch=')
            ? { ...successfulRun, conclusion: 'failure' }
            : successfulRun
          return new Response(JSON.stringify({ workflow_runs: [run] }))
        }) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPullRequestBuild({
          panel: healthPanel,
          source: healthSource,
          branch: 'cpr-gradle-update/create-update-branch/42',
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          state: 'ok',
          signal: { type: 'pull-request-build', item: { status: 'failed' } },
        }),
    }),
  )

  test(
    "uses the configured workflow's branch push as PR-build evidence by default",
    mint({
      setup: () => ({
        fetcher: vi.fn(
          async (url: string) =>
            new Response(
              JSON.stringify({
                workflow_runs: url.includes('event=pull_request')
                  ? []
                  : [{ ...successfulRun, event: 'push', conclusion: 'failure' }],
              }),
            ),
        ) as unknown as typeof fetch,
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPullRequestBuild({
          panel: healthPanel,
          source: healthSource,
          branch: 'cpr-gradle-update/create-update-branch/42',
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({
          signal: {
            type: 'pull-request-build',
            item: { status: 'failed', detail: expect.stringContaining('push') },
          },
        })
        expect(fetcher).toHaveBeenCalledWith(
          expect.not.stringContaining('event=pull_request'),
          expect.anything(),
        )
      },
    }),
  )

  test(
    'uses only explicitly accepted events when a board restricts PR-build evidence',
    mint({
      setup: () => ({
        fetcher: upstreamRuns([
          { ...successfulRun, event: 'push', conclusion: 'failure' },
          { ...successfulRun, event: 'pull_request', conclusion: 'success' },
        ]),
      }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPullRequestBuild({
          panel: { ...healthPanel, build_events: ['pull_request'] },
          source: healthSource,
          branch: 'cpr-gradle-update/create-update-branch/42',
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({
          signal: {
            type: 'pull-request-build',
            item: { status: 'passed', detail: expect.stringContaining('pull_request') },
          },
        })
        expect(fetcher).toHaveBeenCalledWith(
          expect.stringContaining('per_page=100'),
          expect.anything(),
        )
      },
    }),
  )

  test(
    'reports missing evidence when no run has an explicitly accepted event',
    mint({
      setup: () => ({ fetcher: upstreamRuns([{ ...successfulRun, event: 'push' }]) }),
      exercise: ({ fetcher }) =>
        fetchGithubActionsPullRequestBuild({
          panel: { ...healthPanel, build_events: ['workflow_dispatch'] },
          source: healthSource,
          branch: 'cpr-gradle-update/create-update-branch/42',
          requestHeaders: new Headers(),
          fetcher,
        }),
      verify: (result) =>
        expect(result.envelope).toMatchObject({
          signal: { type: 'pull-request-build', item: { status: 'unknown' } },
        }),
    }),
  )

  function healthRoutesFixture() {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          headers: { etag: 'W/"prs"', date: '2026-08-29T12:00:00Z' },
        }),
    ) as unknown as typeof fetch
    return createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: {
        sources: { github: healthSource },
        boards: { team: { panels: [healthPanel] } },
      },
      fetcher,
    })
  }

  test(
    'serves the named pull-request observation route and relays validators',
    mint({
      setup: () => ({ app: healthRoutesFixture() }),
      exercise: ({ app }) => app.request('/api/panel/team/updates/pull-requests'),
      verify: async (response) => {
        expect(response.status).toBe(200)
        expect(response.headers.get('etag')).toBe('W/"prs"')
        await expect(response.json()).resolves.toMatchObject({
          signal: { type: 'pull-request-candidates' },
        })
      },
    }),
  )

  test(
    'rejects a pull-request build route for a non-authorized branch',
    mint({
      setup: () => ({ app: healthRoutesFixture() }),
      exercise: ({ app }) =>
        app.request('/api/panel/team/updates/pull-request-build?branch=feature/manual'),
      verify: (response) => expect(response.status).toBe(404),
    }),
  )

  test(
    'rejects an unconfigured update-workflow route',
    mint({
      setup: () => ({ app: healthRoutesFixture() }),
      exercise: ({ app }) =>
        app.request('/api/panel/team/updates/update-workflow/not-configured.yml'),
      verify: (response) => expect(response.status).toBe(404),
    }),
  )
})
