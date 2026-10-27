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
}

function archive(summary: object, extras: Record<string, Uint8Array> = {}) {
  return zipSync({
    'test-summary.json': new TextEncoder().encode(JSON.stringify(summary)),
    ...extras,
  })
}

describe('GitHub Actions test-count evidence', () => {
  test(
    'reads and binds one configured artifact summary to its selected workflow run',
    mint({
      setup: () => {
        const fetcher = vi.fn(async (url: string) => {
          if (url.includes('/runs?')) return Response.json({ workflow_runs: [run] })
          if (url.includes('/artifacts?'))
            return Response.json({ artifacts: [{ id: 8, name: 'ci-evidence', expired: false }] })
          return new Response(
            archive({
              schemaVersion: 1,
              runId: 42,
              runAttempt: 2,
              headSha: 'abc123',
              total: 12,
              passed: 10,
              failed: 1,
              skipped: 1,
            }),
          )
        }) as unknown as typeof fetch
        return { fetcher }
      },
      exercise: ({ fetcher }) =>
        fetchGithubActionsTestCount({ panel, source, requestHeaders: new Headers(), fetcher }),
      verify: (result, { fetcher }) => {
        expect(result.envelope).toMatchObject({
          state: 'ok',
          link: run.html_url,
          signal: {
            type: 'test-count',
            status: 'reported',
            total: 12,
            passed: 10,
            failed: 1,
            skipped: 1,
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
              runId: 41,
              runAttempt: 2,
              headSha: 'abc123',
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
              { schemaVersion: 1, runId: 42, runAttempt: 2, headSha: 'abc123', total: 12 },
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
        const fetcher = vi.fn(async (url: string) => {
          if (url.includes('/runs?')) return Response.json({ workflow_runs: [run] })
          if (url.includes('/artifacts?'))
            return Response.json({ artifacts: [{ id: 8, name: 'ci-evidence', expired: false }] })
          return new Response(
            archive({ schemaVersion: 1, runId: 42, runAttempt: 2, headSha: 'abc123', total: 12 }),
          )
        }) as unknown as typeof fetch
        return {
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
      exercise: ({ app }) => app.request('/api/panel/team/tests'),
      verify: async (response) => {
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          panelId: 'tests',
          state: 'ok',
          signal: { type: 'test-count', status: 'reported', total: 12 },
        })
      },
    }),
  )
})
