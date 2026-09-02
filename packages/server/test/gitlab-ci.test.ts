import { type BoardConfig, boardConfigSchema } from '@ze-great-dashboard/shared'
import { describe, expect, it, vi } from 'vitest'
import { fetchGitlabCiPipeline, permittedGitlabCiCalls } from '../src/adapters/gitlab-ci.ts'
import { deriveValidatedAllowlist } from '../src/allowlist.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { CredentialResolver } from '../src/credentials.ts'

const panel = { id: 'service', type: 'pipeline-status', source: 'gitlab' } as const
const source = {
  type: 'gitlab-ci',
  project: 'group/platform/service',
  branch: 'main',
  token_env: 'GITLAB_TOKEN',
  url: 'https://gitlab.example.com/gitlab',
} as const
const credentials: CredentialResolver = {
  get: (name) => (name === 'GITLAB_TOKEN' ? 'read-token' : undefined),
}

function pipeline(overrides: Record<string, unknown> = {}) {
  return {
    id: 812,
    name: 'build and test',
    status: 'success',
    ref: 'main',
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-09-01T12:02:14Z',
    web_url: 'https://gitlab.example.com/gitlab/group/platform/service/-/pipelines/812?token=nope',
    ...overrides,
  }
}

function upstream(value: unknown, headers = new Headers({ date: '2026-09-01T12:03:00Z' })) {
  return vi.fn(
    async () => new Response(JSON.stringify(value), { headers }),
  ) as unknown as typeof fetch
}

describe('the GitLab CI pipeline adapter', () => {
  it('uses one encoded, bounded project pipeline request with an optional ref', () => {
    const [call] = permittedGitlabCiCalls(panel, source)

    expect(call?.url).toBe(
      'https://gitlab.example.com/gitlab/api/v4/projects/group%2Fplatform%2Fservice/pipelines?per_page=1&ref=main',
    )
    expect(call?.headers.get('private-token')).toBeNull()
  })

  it('defaults to GitLab.com and accepts nested projects and a self-managed path prefix', () => {
    const parsed = boardConfigSchema.parse({
      sources: { gitlab: { ...source, url: undefined } },
      boards: { operations: { panels: [panel] } },
    })
    const defaultSource = parsed.sources.gitlab
    if (!defaultSource) throw new Error('expected GitLab source')
    expect(defaultSource).toMatchObject({ type: 'gitlab-ci', project: 'group/platform/service' })
    expect(permittedGitlabCiCalls(panel, defaultSource)[0]?.url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fplatform%2Fservice/pipelines?per_page=1&ref=main',
    )
  })

  it.each([
    [{ type: 'gitlab-ci', project: 'group/project' }],
    [{ type: 'gitlab-ci', token_env: 'GITLAB_TOKEN' }],
    [{ ...source, url: 'http://gitlab.example.com' }],
    [{ ...source, url: 'https://token@gitlab.example.com' }],
    [{ ...source, url: 'https://gitlab.example.com/base?next=/admin' }],
    [{ ...source, url: 'https://gitlab.example.com/base#fragment' }],
  ])('rejects an incomplete or unsafe GitLab source %#', (gitlab) => {
    expect(() =>
      boardConfigSchema.parse({
        sources: { gitlab },
        boards: { operations: { panels: [panel] } },
      }),
    ).toThrow()
  })

  it.each([
    ['created', 'running'],
    ['pending', 'running'],
    ['running', 'running'],
    ['success', 'passed'],
    ['failed', 'failed'],
    ['canceled', 'cancelled'],
    ['manual', 'warning'],
    ['skipped', 'warning'],
    ['scheduled', 'warning'],
    ['unrecognised', 'unknown'],
  ] as const)('normalizes GitLab status %s as %s', async (status, expected) => {
    const result = await fetchGitlabCiPipeline({
      panel,
      source,
      credentials,
      requestHeaders: new Headers(),
      fetcher: upstream([pipeline({ status })]),
    })

    expect(result.envelope).toMatchObject({
      panelId: 'service',
      state: 'ok',
      observedAt: '2026-09-01T12:03:00.000Z',
      link: 'https://gitlab.example.com/gitlab/group/platform/service/-/pipelines/812',
      signal: {
        type: 'pipeline-status',
        status: expected,
        rawStatus: status,
        name: 'build and test',
        sourceRunId: '812',
        branch: 'main',
        runStartedAt: '2026-09-01T12:00:00Z',
        sourceUpdatedAt: '2026-09-01T12:02:14Z',
      },
    })
  })

  it('sends the token only as PRIVATE-TOKEN, forwards validators, and preserves cache metadata', async () => {
    const fetcher = upstream([pipeline()], new Headers({ etag: 'W/"gitlab"' }))
    const result = await fetchGitlabCiPipeline({
      panel,
      source,
      credentials,
      requestHeaders: new Headers({ 'if-none-match': 'W/"browser"' }),
      fetcher,
    })
    const headers = vi.mocked(fetcher).mock.calls[0]?.[1]?.headers as Headers

    expect(headers.get('private-token')).toBe('read-token')
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('if-none-match')).toBe('W/"browser"')
    expect(result.response.headers.get('etag')).toBe('W/"gitlab"')
  })

  it('passes an upstream 304 through unchanged', async () => {
    const result = await fetchGitlabCiPipeline({
      panel,
      source,
      credentials,
      requestHeaders: new Headers(),
      fetcher: vi.fn(
        async () => new Response(null, { status: 304, headers: { etag: 'W/"gitlab"' } }),
      ) as unknown as typeof fetch,
    })
    expect(result.envelope).toBeUndefined()
    expect(result.response.status).toBe(304)
  })

  it.each([
    ['missing credential', undefined, async () => new Response(JSON.stringify([pipeline()]))],
    ['empty pipeline list', 'read-token', async () => new Response(JSON.stringify([]))],
    ['unauthorized upstream', 'read-token', async () => new Response('', { status: 401 })],
    ['missing project', 'read-token', async () => new Response('', { status: 404 })],
    ['network failure', 'read-token', async () => Promise.reject(new Error('connection reset'))],
    ['malformed JSON', 'read-token', async () => new Response('{not-json')],
  ] as const)(
    'returns a public HTTP-200 error envelope for %s',
    async (_caseName, token, response) => {
      const result = await fetchGitlabCiPipeline({
        panel,
        source,
        credentials: { get: () => token },
        requestHeaders: new Headers(),
        fetcher: vi.fn(response) as unknown as typeof fetch,
      })
      const body = await result.response.text()

      expect(result.response.status).toBe(200)
      expect(body).toContain('"state":"error"')
      expect(body).not.toContain('read-token')
      expect(body).not.toContain('/api/v4/')
    },
  )

  it('admits and routes a configured GitLab pipeline panel while retaining unknown-combination rejection', async () => {
    const config: BoardConfig = boardConfigSchema.parse({
      sources: { gitlab: source },
      boards: { operations: { panels: [panel] } },
    })
    const fetcher = upstream([pipeline()])
    const app = createApp({
      config: loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.0' }),
      boardConfig: config,
      allowlist: deriveValidatedAllowlist(config),
      credentials,
      fetcher,
    })

    const response = await app.request('/api/panel/operations/service')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ signal: { status: 'passed' } })
    expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1)
    expect(() =>
      deriveValidatedAllowlist(
        boardConfigSchema.parse({
          sources: { mystery: { type: 'mystery-source' } },
          boards: {
            operations: { panels: [{ id: 'unknown', type: 'pipeline-status', source: 'mystery' }] },
          },
        }),
      ),
    ).toThrow(/Unsupported configured panel operation/)
  })
})
