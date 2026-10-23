import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import { envelopeSchema, pipelineStatusSchema } from '@ze-great-dashboard/shared'
import { describe, expect, vi } from 'vitest'
import {
  type PipelineAdapterContract,
  pipelineAdapterApp,
} from './pipeline-adapter-contract-helper.ts'

const credentials = (name: string): PipelineAdapterContract['credentials'] => ({
  get: (candidate) => (candidate === name ? 'controlled-server-only-secret' : undefined),
})

const adapters: PipelineAdapterContract[] = [
  {
    name: 'GitHub Actions',
    boardConfig: {
      sources: {
        github: {
          type: 'github-actions',
          repo: 'example-org/example-repo',
          token_env: 'GITHUB_TOKEN',
        },
      },
      boards: {
        controlled: {
          panels: [
            { id: 'pipeline', type: 'pipeline-status', source: 'github', pipeline: 'build.yml' },
          ],
        },
      },
    },
    credentials: credentials('GITHUB_TOKEN'),
    successfulUpstream: {
      workflow_runs: [
        {
          id: 101,
          status: 'completed',
          conclusion: 'success',
          name: 'Build',
          html_url: 'https://github.com/example-org/example-repo/actions/runs/101?attempt=2#detail',
          updated_at: '2026-10-05T12:02:00Z',
        },
      ],
    },
    expected: {
      panelId: 'pipeline',
      status: 'passed',
      sourceRunId: '101',
      link: 'https://github.com/example-org/example-repo/actions/runs/101?attempt=2#detail',
    },
  },
  {
    name: 'GitLab CI',
    boardConfig: {
      sources: {
        gitlab: {
          type: 'gitlab-ci',
          project: 'group/platform/service',
          token_env: 'GITLAB_TOKEN',
          url: 'https://gitlab.example.test/gitlab',
        },
      },
      boards: {
        controlled: {
          panels: [{ id: 'pipeline', type: 'pipeline-status', source: 'gitlab' }],
        },
      },
    },
    credentials: credentials('GITLAB_TOKEN'),
    successfulUpstream: [
      {
        id: 202,
        name: 'Build',
        status: 'success',
        ref: 'main',
        created_at: '2026-10-05T12:00:00Z',
        updated_at: '2026-10-05T12:02:00Z',
        web_url: 'https://gitlab.example.test/gitlab/group/platform/service/-/pipelines/202',
      },
    ],
    expected: {
      panelId: 'pipeline',
      status: 'passed',
      sourceRunId: '202',
      link: 'https://gitlab.example.test/gitlab/group/platform/service/-/pipelines/202',
    },
  },
  {
    name: 'Azure DevOps',
    boardConfig: {
      sources: {
        ado: {
          type: 'azure-devops',
          organization: 'example-org',
          project: 'Example Project',
          token_env: 'ADO_PAT',
        },
      },
      boards: {
        controlled: {
          panels: [{ id: 'pipeline', type: 'pipeline-status', source: 'ado', pipeline: 42 }],
        },
      },
    },
    credentials: credentials('ADO_PAT'),
    successfulUpstream: {
      value: [
        {
          id: 303,
          buildNumber: '20261005.1',
          status: 'completed',
          result: 'succeeded',
          sourceBranch: 'refs/heads/main',
          startTime: '2026-10-05T12:00:00Z',
          finishTime: '2026-10-05T12:02:00Z',
          lastChangedDate: '2026-10-05T12:02:00Z',
        },
      ],
    },
    expected: {
      panelId: 'pipeline',
      status: 'passed',
      sourceRunId: '303',
      link: 'https://dev.azure.com/example-org/Example%20Project/_build/results?buildId=303',
    },
  },
]

const responseHeaders = {
  date: 'Mon, 05 Oct 2026 12:03:00 GMT',
  etag: 'W/"controlled"',
  'last-modified': 'Mon, 05 Oct 2026 12:02:00 GMT',
  'cache-control': 'max-age=60',
}

function upstream(body: unknown, status = 200, headers = responseHeaders): typeof fetch {
  return vi.fn(
    async () =>
      new Response(status === 304 ? null : JSON.stringify(body), {
        status,
        headers,
      }),
  ) as unknown as typeof fetch
}

describe('the pipeline-status route contract', () => {
  for (const adapter of adapters) {
    describe(adapter.name, () => {
      mintTest('returns schema-valid public pipeline evidence with its canonical source run link', {
        setup: () => ({
          adapter,
          app: pipelineAdapterApp(adapter, upstream(adapter.successfulUpstream)),
        }),
        exercise: ({ app }) => app.request('/api/panel/controlled/pipeline'),
        verify: async (response, { adapter }) => {
          const envelope = envelopeSchema.parse(await response.json())

          expect(response.status).toBe(200)
          expect(envelope).toMatchObject({
            panelId: adapter.expected.panelId,
            state: 'ok',
            link: adapter.expected.link,
          })
          if (envelope.state !== 'ok')
            throw new Error('expected a successful controlled observation')
          expect(pipelineStatusSchema.parse(envelope.signal)).toMatchObject({
            type: 'pipeline-status',
            status: adapter.expected.status,
            sourceRunId: adapter.expected.sourceRunId,
          })
        },
      })

      mintTest('relays upstream cache metadata and browser validators', {
        setup: () => {
          const fetcher = upstream(adapter.successfulUpstream)
          return { app: pipelineAdapterApp(adapter, fetcher), fetcher }
        },
        exercise: ({ app }) =>
          app.request('/api/panel/controlled/pipeline', {
            headers: {
              'if-none-match': 'W/"browser"',
              'if-modified-since': 'Sun, 04 Oct 2026 12:00:00 GMT',
            },
          }),
        verify: (response, { fetcher }) => {
          const requestHeaders = vi.mocked(fetcher).mock.calls[0]?.[1]?.headers

          expect(response.status).toBe(200)
          for (const [name, value] of Object.entries(responseHeaders))
            expect(response.headers.get(name)).toBe(value)
          expect(requestHeaders).toBeInstanceOf(Headers)
          expect((requestHeaders as Headers).get('if-none-match')).toBe('W/"browser"')
          expect((requestHeaders as Headers).get('if-modified-since')).toBe(
            'Sun, 04 Oct 2026 12:00:00 GMT',
          )
        },
      })

      mintTest('preserves an upstream 304', {
        setup: () => ({ app: pipelineAdapterApp(adapter, upstream(null, 304)) }),
        exercise: ({ app }) => app.request('/api/panel/controlled/pipeline'),
        verify: async (response) => {
          expect(response.status).toBe(304)
          expect(response.headers.get('etag')).toBe('W/"controlled"')
          expect(await response.text()).toBe('')
        },
      })

      mintTest('renders upstream unauthorized access as a non-disclosing public envelope', {
        setup: () => ({
          app: pipelineAdapterApp(
            adapter,
            upstream('raw upstream detail: controlled-server-only-secret', 401),
          ),
          adapter,
        }),
        exercise: ({ app }) => app.request('/api/panel/controlled/pipeline'),
        verify: async (response, { adapter }) => {
          const text = await response.text()
          const envelope = envelopeSchema.parse(JSON.parse(text))

          expect(response.status).toBe(200)
          expect(envelope).toMatchObject({
            panelId: adapter.expected.panelId,
            state: 'error',
            error: { kind: 'unauthorized' },
          })
          expect(text).not.toContain('controlled-server-only-secret')
          expect(text).not.toContain('raw upstream detail')
        },
      })

      mintTest('rejects undeclared panels before making an upstream request', {
        setup: () => {
          const fetcher = vi.fn() as unknown as typeof fetch
          return { app: pipelineAdapterApp(adapter, fetcher), fetcher }
        },
        exercise: ({ app }) => app.request('/api/panel/controlled/not-declared'),
        verify: (response, { fetcher }) => {
          expect(response.status).toBe(404)
          expect(fetcher).not.toHaveBeenCalled()
        },
      })
    })
  }
})
