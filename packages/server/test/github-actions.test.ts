import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BoardConfig } from '@ze-great-dashboard/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchGithubActionsPipeline,
  fetchGithubActionsPullRequestHealth,
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

  it('adds the configured token as an exact GitHub bearer header', () => {
    const [call] = permittedGithubActionsCalls(
      panel,
      { ...source, token_env: 'GITHUB_TOKEN' },
      githubCredentials,
    )
    expect(call?.headers.get('authorization')).toBe('Bearer secret-token')
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
        message: 'No workflow runs found for branch "master". Check the source\'s branch setting.',
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
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/1.0.0' }),
      boardConfig: {
        sources: { github: { ...source, token_env: 'GITHUB_TOKEN' } },
        boards: { 'ze-great-team': { panels: [panel] } },
      },
      credentials: githubCredentials,
      fetcher: upstream('success'),
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

describe('pull-request-health', () => {
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
  }

  it('rolls up update workflow and matching PR build health', async () => {
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

    const result = await fetchGithubActionsPullRequestHealth({
      panel: healthPanel,
      source: healthSource,
      requestHeaders: new Headers(),
      fetcher,
    })

    expect(result.envelope).toMatchObject({
      state: 'ok',
      link: 'https://github.com/example-org/example-repo',
      signal: {
        type: 'pull-request-health',
        status: 'passed',
        pullRequests: [{ label: 'PR #42', status: 'passed' }],
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

  it('uses the bearer header on every private GitHub request', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/pulls?')
        ? new Response(JSON.stringify([]))
        : new Response(JSON.stringify({ workflow_runs: [successfulRun] })),
    ) as unknown as typeof fetch
    await fetchGithubActionsPullRequestHealth({
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

  it('does not treat an absent matching PR as a failure', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes('/pulls?')
        ? new Response(JSON.stringify([]))
        : new Response(JSON.stringify({ workflow_runs: [successfulRun] })),
    ) as unknown as typeof fetch

    const result = await fetchGithubActionsPullRequestHealth({
      panel: healthPanel,
      source: healthSource,
      requestHeaders: new Headers(),
      fetcher,
    })

    expect(result.envelope).toMatchObject({
      state: 'ok',
      signal: { status: 'passed', summary: '1 update workflow · No open update PRs' },
    })
  })

  it('rolls up a failing PR build as failed', async () => {
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

    const result = await fetchGithubActionsPullRequestHealth({
      panel: healthPanel,
      source: healthSource,
      requestHeaders: new Headers(),
      fetcher,
    })

    expect(result.envelope).toMatchObject({
      state: 'ok',
      signal: {
        status: 'failed',
        summary: 'PR #42: cpr-gradle-update/create-update-branch/42 · failure',
      },
    })
  })
})
