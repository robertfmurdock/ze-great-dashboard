import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { BoardConfig } from '@ze-great-dashboard/shared'
import { describe, expect, it, vi } from 'vitest'
import {
  fetchGithubActionsPipeline,
  permittedGithubActionsCalls,
} from '../src/adapters/github-actions.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'

const fixtureDirectory = new URL('../../../fixtures/github-actions/', import.meta.url)
const panel = {
  id: 'web-build',
  type: 'pipeline-status',
  source: 'github',
  pipeline: 'build.yml',
} as const
const source = { type: 'github-actions', repo: 'example-org/example-repo' } as const

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

describe('the GitHub Actions adapter', () => {
  it.each([
    ['success', 'passed'],
    ['failure', 'failed'],
    ['in-progress', 'running'],
    ['cancelled', 'cancelled'],
  ])('normalizes the recorded %s run as %s', async (name, expected) => {
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
      signal: { type: 'pipeline-status', status: expected },
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
