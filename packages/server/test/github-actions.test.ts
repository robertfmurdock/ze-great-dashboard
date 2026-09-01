import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BoardConfig } from '@ze-great-dashboard/shared'
import { describe, expect, it, vi } from 'vitest'
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
  it.each([
    ['success', 'passed', 134_000],
    ['failure', 'failed', 53_000],
    ['in-progress', 'running', undefined],
    ['cancelled', 'cancelled', 550_000],
  ])('normalizes the recorded %s run as %s', async (name, expected, durationMs) => {
    const result = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher: upstream(name),
    })

    expect(result.envelope).toMatchObject({
      panelId: 'web-build',
      state: 'ok',
      observedAt: '2026-08-17T14:32:05.000Z',
      signal: {
        type: 'pipeline-status',
        status: expected,
        ...(name === 'success' ? { sourceRunId: expect.any(String) } : {}),
        sourceUpdatedAt: expect.any(String),
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    })
  })

  it('uses the configured workflow without filtering when no branch is configured', () => {
    const [call] = permittedGithubActionsCalls(panel, source)
    expect(call?.url).toBe(
      'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs?per_page=1',
    )
  })

  it('filters workflow runs to the configured branch', () => {
    const [call] = permittedGithubActionsCalls(panel, { ...source, branch: 'trunk' })
    expect(call?.url).toBe(
      'https://api.github.com/repos/example-org/example-repo/actions/workflows/build.yml/runs?branch=trunk&per_page=1',
    )
  })

  it('exposes the actual run branch when the source is not branch-filtered', async () => {
    const result = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher: upstreamRuns([
        {
          status: 'completed',
          conclusion: 'success',
          name: 'Build',
          html_url: 'https://github.com/example-org/example-repo/actions/runs/1',
          head_branch: 'feature/ship-it',
        },
      ]),
    })

    expect(result.envelope).toMatchObject({ signal: { branch: 'feature/ship-it' } })
  })

  it('keeps credentials out of the pure permitted-call declaration', () => {
    const [call] = permittedGithubActionsCalls(
      panel,
      { ...source, token_env: 'GITHUB_TOKEN' },
      githubCredentials,
    )
    expect(call?.headers.get('authorization')).toBeNull()
  })

  it('forwards validators upstream', async () => {
    const fetcher = upstream('success')
    await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers({ 'if-none-match': 'W/"fixture"' }),
      fetcher,
    })

    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: expect.any(Headers) }),
    )
    const options = vi.mocked(fetcher).mock.calls[0]?.[1]
    expect(options?.headers).toBeInstanceOf(Headers)
    expect((options?.headers as Headers | undefined)?.get('if-none-match')).toBe('W/"fixture"')
  })

  it('uses the newest run without deriving client timing history on the server', async () => {
    const run = (status: string, started: string | null, updated: string | undefined) => ({
      status,
      conclusion: status === 'completed' ? 'success' : null,
      name: 'Build',
      html_url: 'https://github.com/example-org/example-repo/actions/runs/1',
      run_started_at: started,
      ...(updated ? { updated_at: updated } : {}),
    })
    const result = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher: upstreamRuns([
        run('in_progress', '2026-08-17T14:00:00Z', '2026-08-17T14:32:00Z'),
        run('completed', '2026-08-17T12:00:00Z', '2026-08-17T12:01:40Z'),
        run('completed', '2026-08-17T12:00:00Z', '2026-08-17T12:03:20Z'),
        run('completed', '2026-08-17T12:00:00Z', '2026-08-17T12:05:00Z'),
        run('completed', 'not-a-date', '2026-08-17T12:05:00Z'),
      ]),
    })

    expect(result.envelope).toMatchObject({
      signal: {
        status: 'running',
        runStartedAt: '2026-08-17T14:00:00Z',
      },
    })
    expect(result.envelope?.state === 'ok' ? result.envelope.signal : undefined).not.toHaveProperty(
      'estimatedDurationMs',
    )
  })

  it('extracts the active job and step from one bounded jobs request', async () => {
    const run = {
      id: 42,
      status: 'in_progress',
      conclusion: null,
      name: 'Build',
      html_url: 'https://github.com/example-org/example-repo/actions/runs/42',
      run_started_at: '2026-08-17T14:00:00Z',
      updated_at: '2026-08-17T14:32:00Z',
    }
    const fetcher = upstreamRunWithJobs(run, [
      { name: 'deploy', status: 'queued', steps: [] },
      {
        name: 'build',
        status: 'in_progress',
        steps: [
          { name: 'checkout', status: 'completed' },
          { name: 'integration tests', status: 'in_progress' },
        ],
      },
    ])

    const result = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher,
    })

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
  })

  it('falls back to a queued job or the job name when no step is active', async () => {
    const run = {
      id: 42,
      status: 'in_progress',
      conclusion: null,
      name: 'Build',
      html_url: 'https://github.com/example-org/example-repo/actions/runs/42',
    }
    const queued = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher: upstreamRunWithJobs(run, [{ name: 'integration tests', status: 'queued' }]),
    })
    expect(queued.envelope).toMatchObject({
      signal: { activity: { kind: 'job', name: 'integration tests' } },
    })

    const jobOnly = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher: upstreamRunWithJobs(run, [
        { name: 'build', status: 'in_progress', steps: [{ name: 'setup', status: 'completed' }] },
      ]),
    })
    expect(jobOnly.envelope).toMatchObject({ signal: { activity: { kind: 'job', name: 'build' } } })
  })

  it('keeps the running signal when the jobs request fails', async () => {
    const run = {
      id: 42,
      status: 'in_progress',
      conclusion: null,
      name: 'Build',
      html_url: 'https://github.com/example-org/example-repo/actions/runs/42',
    }
    const result = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher: upstreamRunWithJobs(run, [], 503),
    })
    expect(result.envelope).toMatchObject({ signal: { status: 'running' } })
    expect(result.envelope?.state === 'ok' ? result.envelope.signal : undefined).not.toHaveProperty(
      'activity',
    )
  })

  it('does not request jobs for completed runs', async () => {
    const fetcher = upstreamRunWithJobs(
      {
        id: 42,
        status: 'completed',
        conclusion: 'success',
        name: 'Build',
        html_url: 'https://github.com/example-org/example-repo/actions/runs/42',
      },
      [{ name: 'should not be read', status: 'in_progress' }],
    )
    await fetchGithubActionsPipeline({ panel, source, requestHeaders: new Headers(), fetcher })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('omits timing advice when completed history has missing or invalid timestamps', async () => {
    const result = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
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
    })
    expect(result.envelope).toMatchObject({ signal: { status: 'running' } })
    expect(result.envelope?.state === 'ok' && result.envelope.signal).not.toHaveProperty(
      'estimatedDurationMs',
    )
  })

  it('reports an unreachable upstream as data, not a proxy 5xx', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const result = await fetchGithubActionsPipeline({
      panel,
      source,
      requestHeaders: new Headers(),
      fetcher,
    })

    expect(result.response.status).toBe(200)
    await expect(result.response.json()).resolves.toMatchObject({
      state: 'error',
      link: 'https://github.com/example-org/example-repo/actions/workflows/build.yml',
      error: { kind: 'unreachable' },
    })
  })

  it('identifies an empty branch result without exposing a schema error', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify({ workflow_runs: [] }), {
          headers: { date: '2026-08-17T14:32:05Z' },
        }),
    ) as unknown as typeof fetch
    const result = await fetchGithubActionsPipeline({
      panel,
      source: { ...source, branch: 'master' },
      requestHeaders: new Headers(),
      fetcher,
    })

    await expect(result.response.json()).resolves.toMatchObject({
      state: 'error',
      error: {
        kind: 'no-runs',
        message: 'No matching workflow runs were found. Check the configured workflow and branch.',
      },
    })
  })
})

describe('the panel route', () => {
  const boardConfig: BoardConfig = {
    sources: { github: source },
    boards: { 'ze-great-team': { panels: [panel] } },
  }

  it('serves a normalized envelope and relays cache metadata', async () => {
    const app = createApp({
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
    })
    const response = await app.request('/api/panel/ze-great-team/web-build')

    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('W/"fixture"')
    expect(response.headers.get('cache-control')).toBe('max-age=60')
    await expect(response.json()).resolves.toMatchObject({
      state: 'ok',
      signal: { status: 'passed' },
    })
  })

  it('keeps a resolved token server-only', async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url === 'https://assets.example.com/1.0.0/index.html') return new Response(TEMPLATE)
      return new Response(JSON.stringify({ workflow_runs: [fixture('success')] }))
    }) as unknown as typeof fetch
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: {
        sources: { github: { ...source, token_env: 'GITHUB_TOKEN' } },
        boards: { 'ze-great-team': { panels: [panel] } },
      },
      credentials: githubCredentials,
      fetcher,
    })
    const panelResponse = await app.request('/api/panel/ze-great-team/web-build')
    const html = await (await app.request('/')).text()

    expect(panelResponse.status).toBe(200)
    expect(await panelResponse.text()).not.toContain('secret-token')
    expect(html).not.toContain('secret-token')
  })

  it('does not turn unknown panel names into arbitrary upstream calls', async () => {
    const fetcher = upstream('success')
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig,
      fetcher,
    })

    expect((await app.request('/api/panel/ze-great-team/not-configured')).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })
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

  it('normalizes candidates, configured update workflows, and prefix-authorized PR builds', async () => {
    const fetcher = vi.fn(async (url: string) => {
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

    const candidates = await fetchGithubActionsPullRequestCandidates({
      panel: healthPanel,
      source: healthSource,
      requestHeaders: new Headers(),
      fetcher,
    })
    const workflow = await fetchGithubActionsUpdateWorkflow({
      panel: healthPanel,
      source: healthSource,
      workflow: 'dependency-update.yml',
      requestHeaders: new Headers(),
      fetcher,
    })
    const build = await fetchGithubActionsPullRequestBuild({
      panel: healthPanel,
      source: healthSource,
      branch: 'cpr-gradle-update/create-update-branch/42',
      requestHeaders: new Headers(),
      fetcher,
    })
    expect(candidates.envelope).toMatchObject({
      state: 'ok',
      link: 'https://github.com/example-org/example-repo',
      signal: { type: 'pull-request-candidates', pullRequests: [{ number: 42 }] },
    })
    expect(workflow.envelope).toMatchObject({
      signal: { type: 'pull-request-workflow', item: { status: 'passed' } },
    })
    expect(build.envelope).toMatchObject({
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
      expect.stringContaining('event=pull_request'),
      expect.anything(),
    )
  })

  it('uses the bearer header on private observation requests', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/pulls?')
        ? new Response(JSON.stringify([]))
        : new Response(JSON.stringify({ workflow_runs: [successfulRun] })),
    ) as unknown as typeof fetch
    await fetchGithubActionsPullRequestCandidates({
      panel: healthPanel,
      source: { ...healthSource, token_env: 'GITHUB_TOKEN' },
      requestHeaders: new Headers(),
      fetcher,
      credentials: githubCredentials,
    })
    for (const [, options] of vi.mocked(fetcher).mock.calls) {
      const headers = options?.headers
      if (!(headers instanceof Headers)) throw new Error('GitHub call had no Headers')
      expect(headers.get('authorization')).toBe('Bearer secret-token')
    }
  })

  it('uses an update workflow run only when its branch matches that workflow prefix', async () => {
    const fetcher = vi.fn(async (url: string) =>
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
    ) as unknown as typeof fetch

    const result = await fetchGithubActionsUpdateWorkflow({
      panel: healthPanel,
      source: healthSource,
      workflow: 'dependency-update.yml',
      requestHeaders: new Headers(),
      fetcher,
    })

    expect(result.envelope).toMatchObject({
      state: 'ok',
      signal: { type: 'pull-request-workflow', item: { status: 'passed' } },
    })
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('dependency-update.yml/runs?per_page=100'),
      expect.anything(),
    )
  })

  it('normalizes a failing PR build and rejects non-prefix branch reads at the route boundary', async () => {
    const fetcher = vi.fn(async (url: string) => {
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
    }) as unknown as typeof fetch

    const result = await fetchGithubActionsPullRequestBuild({
      panel: healthPanel,
      source: healthSource,
      branch: 'cpr-gradle-update/create-update-branch/42',
      requestHeaders: new Headers(),
      fetcher,
    })

    expect(result.envelope).toMatchObject({
      state: 'ok',
      signal: {
        type: 'pull-request-build',
        item: { status: 'failed' },
      },
    })
  })

  it('exposes only named observation routes and relays their validators', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(JSON.stringify([]), {
          headers: { etag: 'W/"prs"', date: '2026-08-29T12:00:00Z' },
        }),
    ) as unknown as typeof fetch
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: {
        sources: { github: healthSource },
        boards: { team: { panels: [healthPanel] } },
      },
      fetcher,
    })
    const response = await app.request('/api/panel/team/updates/pull-requests')
    expect(response.status).toBe(200)
    expect(response.headers.get('etag')).toBe('W/"prs"')
    await expect(response.json()).resolves.toMatchObject({
      signal: { type: 'pull-request-candidates' },
    })
    expect(
      (await app.request('/api/panel/team/updates/pull-request-build?branch=feature/manual'))
        .status,
    ).toBe(404)
    expect(
      (await app.request('/api/panel/team/updates/update-workflow/not-configured.yml')).status,
    ).toBe(404)
  })
})
