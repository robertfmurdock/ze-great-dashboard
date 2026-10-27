import { mint } from '@continuous-excellence/testmints-js/vitest'
import {
  type BoardConfig,
  boardConfigSchema,
  type PipelineStatus,
} from '@ze-great-dashboard/shared'
import { describe, expect, test, vi } from 'vitest'
import { fetchGitlabCiPipeline, permittedGitlabCiCalls } from '../src/adapters/gitlab-ci.ts'
import { deriveValidatedAllowlist } from '../src/allowlist.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import type { CredentialResolver } from '../src/credentials.ts'

describe('the GitLab CI pipeline adapter', () => {
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
      web_url:
        'https://gitlab.example.com/gitlab/group/platform/service/-/pipelines/812?token=nope',
      ...overrides,
    }
  }

  function upstream(value: unknown, headers = new Headers({ date: '2026-09-01T12:03:00Z' })) {
    return vi.fn(
      async () => new Response(JSON.stringify(value), { headers }),
    ) as unknown as typeof fetch
  }

  describe('source configuration and permitted-call derivation', () => {
    test(
      'derives one bounded pipeline call for a nested project at a self-managed path prefix',
      mint({
        setup: () => ({ panel, source }),
        exercise: ({ panel, source }) => permittedGitlabCiCalls(panel, source),
        verify: ([call]) => {
          expect(call?.url).toBe(
            'https://gitlab.example.com/gitlab/api/v4/projects/group%2Fplatform%2Fservice/pipelines?per_page=1&ref=main',
          )
          expect(call?.headers.get('private-token')).toBeNull()
        },
      }),
    )

    test(
      'accepts a GitLab source with an omitted instance URL',
      mint({
        setup: () => ({
          config: {
            sources: { gitlab: { ...source, url: undefined } },
            boards: { operations: { panels: [panel] } },
          },
        }),
        exercise: ({ config }) => boardConfigSchema.parse(config),
        verify: (parsed) => {
          expect(parsed.sources.gitlab).toMatchObject({
            type: 'gitlab-ci',
            project: 'group/platform/service',
            url: undefined,
          })
        },
      }),
    )

    test(
      'defaults an omitted GitLab instance URL to GitLab.com when deriving a pipeline call',
      mint({
        setup: () => ({ panel, source: { ...source, url: undefined } }),
        exercise: ({ panel, source }) => permittedGitlabCiCalls(panel, source),
        verify: ([call]) => {
          expect(call?.url).toBe(
            'https://gitlab.com/api/v4/projects/group%2Fplatform%2Fservice/pipelines?per_page=1&ref=main',
          )
        },
      }),
    )

    test(
      'rejects a source without its credential declaration',
      mint({
        setup: () => ({
          config: {
            sources: { gitlab: { type: 'gitlab-ci', project: 'group/project' } },
            boards: { operations: { panels: [panel] } },
          },
        }),
        exercise: throws(({ config }) => boardConfigSchema.parse(config)),
        verify: (error) => expect(error).toBeInstanceOf(Error),
      }),
    )

    test(
      'rejects a source without its project',
      mint({
        setup: () => ({
          config: {
            sources: { gitlab: { type: 'gitlab-ci', token_env: 'GITLAB_TOKEN' } },
            boards: { operations: { panels: [panel] } },
          },
        }),
        exercise: throws(({ config }) => boardConfigSchema.parse(config)),
        verify: (error) => expect(error).toBeInstanceOf(Error),
      }),
    )

    test(
      'rejects an insecure GitLab base URL',
      mint({
        setup: () => ({
          config: {
            sources: { gitlab: { ...source, url: 'http://gitlab.example.com' } },
            boards: { operations: { panels: [panel] } },
          },
        }),
        exercise: throws(({ config }) => boardConfigSchema.parse(config)),
        verify: (error) => expect(error).toBeInstanceOf(Error),
      }),
    )

    test(
      'rejects a GitLab base URL with embedded credentials',
      mint({
        setup: () => ({
          config: {
            sources: { gitlab: { ...source, url: 'https://token@gitlab.example.com' } },
            boards: { operations: { panels: [panel] } },
          },
        }),
        exercise: throws(({ config }) => boardConfigSchema.parse(config)),
        verify: (error) => expect(error).toBeInstanceOf(Error),
      }),
    )

    test(
      'rejects a GitLab base URL with a query',
      mint({
        setup: () => ({
          config: {
            sources: { gitlab: { ...source, url: 'https://gitlab.example.com/base?next=/admin' } },
            boards: { operations: { panels: [panel] } },
          },
        }),
        exercise: throws(({ config }) => boardConfigSchema.parse(config)),
        verify: (error) => expect(error).toBeInstanceOf(Error),
      }),
    )

    test(
      'rejects a GitLab base URL with a fragment',
      mint({
        setup: () => ({
          config: {
            sources: { gitlab: { ...source, url: 'https://gitlab.example.com/base#fragment' } },
            boards: { operations: { panels: [panel] } },
          },
        }),
        exercise: throws(({ config }) => boardConfigSchema.parse(config)),
        verify: (error) => expect(error).toBeInstanceOf(Error),
      }),
    )
  })

  describe('pipeline observations', () => {
    const gitlabStatusCases: ReadonlyArray<{
      upstreamStatus: string
      expectedStatus: PipelineStatus['status']
    }> = [
      { upstreamStatus: 'created', expectedStatus: 'running' },
      { upstreamStatus: 'pending', expectedStatus: 'running' },
      { upstreamStatus: 'running', expectedStatus: 'running' },
      { upstreamStatus: 'success', expectedStatus: 'passed' },
      { upstreamStatus: 'failed', expectedStatus: 'failed' },
      { upstreamStatus: 'canceled', expectedStatus: 'cancelled' },
      { upstreamStatus: 'manual', expectedStatus: 'warning' },
      { upstreamStatus: 'skipped', expectedStatus: 'warning' },
      { upstreamStatus: 'scheduled', expectedStatus: 'warning' },
      { upstreamStatus: 'unrecognised', expectedStatus: 'unknown' },
    ]
    const gitlabErrorCases: ReadonlyArray<{
      failure: string
      token: string | undefined
      response: () => Promise<Response>
    }> = [
      {
        failure: 'a missing credential',
        token: undefined,
        response: async () => new Response(JSON.stringify([pipeline()])),
      },
      {
        failure: 'an empty pipeline list',
        token: 'read-token',
        response: async () => new Response(JSON.stringify([])),
      },
      {
        failure: 'an unauthorized upstream',
        token: 'read-token',
        response: async () => new Response('', { status: 401 }),
      },
      {
        failure: 'a missing project',
        token: 'read-token',
        response: async () => new Response('', { status: 404 }),
      },
      {
        failure: 'a network failure',
        token: 'read-token',
        response: async () => Promise.reject(new Error('connection reset')),
      },
      {
        failure: 'malformed JSON',
        token: 'read-token',
        response: async () => new Response('{not-json'),
      },
    ]

    function gitlabPipelineFixture(status: string) {
      return { fetcher: upstream([pipeline({ status })]) }
    }

    for (const { upstreamStatus, expectedStatus } of gitlabStatusCases) {
      test(
        `normalizes GitLab status ${upstreamStatus} as ${expectedStatus}`,
        mint({
          setup: () => gitlabPipelineFixture(upstreamStatus),
          exercise: ({ fetcher }) =>
            fetchGitlabCiPipeline({
              panel,
              source,
              credentials,
              requestHeaders: new Headers(),
              fetcher,
            }),
          verify: (result) => expectGitlabPipelineStatus(result, upstreamStatus, expectedStatus),
        }),
      )
    }

    test(
      'sends the token only as PRIVATE-TOKEN, forwards validators, and preserves cache metadata',
      mint({
        setup: () => ({
          fetcher: upstream([pipeline()], new Headers({ etag: 'W/"gitlab"' })),
          requestHeaders: new Headers({ 'if-none-match': 'W/"browser"' }),
        }),
        exercise: ({ fetcher, requestHeaders }) =>
          fetchGitlabCiPipeline({ panel, source, credentials, requestHeaders, fetcher }),
        verify: (result, { fetcher }) => {
          const headers = vi.mocked(fetcher).mock.calls[0]?.[1]?.headers as Headers
          expect(headers.get('private-token')).toBe('read-token')
          expect(headers.get('authorization')).toBeNull()
          expect(headers.get('if-none-match')).toBe('W/"browser"')
          expect(result.response.headers.get('etag')).toBe('W/"gitlab"')
        },
      }),
    )

    test(
      'passes an upstream 304 through unchanged',
      mint({
        setup: () => ({
          fetcher: vi.fn(
            async () => new Response(null, { status: 304, headers: { etag: 'W/"gitlab"' } }),
          ) as unknown as typeof fetch,
        }),
        exercise: ({ fetcher }) =>
          fetchGitlabCiPipeline({
            panel,
            source,
            credentials,
            requestHeaders: new Headers(),
            fetcher,
          }),
        verify: (result) => {
          expect(result.envelope).toBeUndefined()
          expect(result.response.status).toBe(304)
        },
      }),
    )

    for (const { failure, token, response } of gitlabErrorCases) {
      test(
        `returns a public HTTP-200 error envelope for ${failure}`,
        mint({
          setup: () => gitlabErrorFixture({ token, response }),
          exercise: ({ credentials, fetcher }) =>
            fetchGitlabCiPipeline({
              panel,
              source,
              credentials,
              requestHeaders: new Headers(),
              fetcher,
            }),
          verify: expectPublicGitlabErrorEnvelope,
        }),
      )
    }
  })

  describe('configured routing and allowlist admission', () => {
    function gitlabAppFixture() {
      const config: BoardConfig = boardConfigSchema.parse({
        sources: { gitlab: source },
        boards: { operations: { panels: [panel] } },
      })
      const fetcher = upstream([pipeline()])
      return {
        app: createApp({
          config: loadConfig({ ASSET_PATH: 'https://assets.example.com/dashboard/1.0.0' }),
          boardConfig: config,
          allowlist: deriveValidatedAllowlist(config),
          credentials,
          fetcher,
        }),
        fetcher,
      }
    }

    test(
      'admits and routes a configured GitLab pipeline panel',
      mint({
        setup: () => gitlabAppFixture(),
        exercise: ({ app }) => app.request('/api/panel/operations/service'),
        verify: async (response, { fetcher }) => {
          expect(response.status).toBe(200)
          expect(await response.json()).toMatchObject({ signal: { status: 'passed' } })
          expect(vi.mocked(fetcher)).toHaveBeenCalledTimes(1)
        },
      }),
    )

    test(
      'rejects an allowlist combination with an unsupported source type',
      mint({
        setup: () => ({
          config: boardConfigSchema.parse({
            sources: { mystery: { type: 'mystery-source' } },
            boards: {
              operations: {
                panels: [{ id: 'unknown', type: 'pipeline-status', source: 'mystery' }],
              },
            },
          }),
        }),
        exercise: throws(({ config }) => deriveValidatedAllowlist(config)),
        verify: (error) => {
          expect(error).toMatchObject({
            message: expect.stringMatching(/Unsupported configured panel operation/),
          })
        },
      }),
    )
  })
})

function expectGitlabPipelineStatus(
  result: Awaited<ReturnType<typeof fetchGitlabCiPipeline>>,
  upstreamStatus: string,
  expectedStatus: PipelineStatus['status'],
) {
  expect(result.envelope).toMatchObject({
    panelId: 'service',
    state: 'ok',
    observedAt: '2026-09-01T12:03:00.000Z',
    link: 'https://gitlab.example.com/gitlab/group/platform/service/-/pipelines/812',
    signal: {
      type: 'pipeline-status',
      status: expectedStatus,
      rawStatus: upstreamStatus,
      name: 'build and test',
      sourceRunId: '812',
      branch: 'main',
      runStartedAt: '2026-09-01T12:00:00Z',
      sourceUpdatedAt: '2026-09-01T12:02:14Z',
    },
  })
}

function gitlabErrorFixture({
  token,
  response,
}: {
  token: string | undefined
  response: () => Promise<Response>
}) {
  return {
    credentials: { get: () => token },
    fetcher: vi.fn(response) as unknown as typeof fetch,
  }
}

async function expectPublicGitlabErrorEnvelope(
  result: Awaited<ReturnType<typeof fetchGitlabCiPipeline>>,
) {
  const body = await result.response.text()
  expect(result.response.status).toBe(200)
  expect(body).toContain('"state":"error"')
  expect(body).not.toContain('read-token')
  expect(body).not.toContain('/api/v4/')
}

/** Captures expected synchronous rejection as Testmints exercise output for verification. */
function throws<Input>(exercise: (input: Input) => unknown) {
  return (input: Input) => {
    try {
      exercise(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected the exercise to throw.')
  }
}
