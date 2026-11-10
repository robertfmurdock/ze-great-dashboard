import { mint } from '@continuous-excellence/testmints-js/vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Board, Envelope, PipelineStatus } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { clientTestFixture, env } from './client-test-fixture.tsx'
import { renderApp as render } from './render-app.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function observation(panelId: string, status: PipelineStatus['status'] = 'passed'): Envelope {
  return {
    panelId,
    state: 'ok',
    observedAt: '2026-08-18T12:00:00.000Z',
    link: null,
    signal: {
      type: 'pipeline-status',
      status,
      rawStatus: status,
      name: panelId,
      branch: 'main',
      sourceUpdatedAt: '2026-08-18T11:00:00.000Z',
    },
  }
}
function dashboardFixture(board: Board, observations: Record<string, Envelope>) {
  const requests: string[] = []
  const fetcher = vi.fn(async (input: string | URL) => {
    const path = String(input)
    requests.push(path)
    if (path.startsWith('/api/boards/')) return Response.json(board)
    if (path === `${env.proxyPath}/client`)
      return Response.json({ ...env, serverVersion: 'test-server' })
    const id = decodeURIComponent(path.split('/').at(-1) ?? '')
    const envelope = observations[id]
    if (!envelope) throw new Error(`Unexpected request ${path}`)
    return Response.json(envelope)
  })
  vi.stubGlobal('fetch', fetcher)
  return { requests }
}
describe('the board shell', () => {
  test(
    'identifies the board and its authorities while configuration is pending',
    mint({
      setup: () => {
        clientTestFixture()
        return { env }
      },
      exercise: ({ env }) => render(<App env={env} />),
      verify: async (_, { env }) => {
        expect(await screen.findByRole('heading', { name: env.board })).toBeTruthy()
        expect(screen.getByText(/Loading configuration/i)).toBeTruthy()
        expect(screen.getByText(/read live/i)).toBeTruthy()
      },
    }),
  )
  test(
    'shows the selected client asset identity in Diagnostics',
    mint({
      setup: () => {
        clientTestFixture()
        render(<App env={env} />)
        return { user: userEvent.setup() }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: /Diagnostics/ })),
      verify: async () => {
        expect(await screen.findByText(/Client dev · assets/)).toBeTruthy()
        expect(screen.getByText(env.assetPath, { exact: false })).toBeTruthy()
      },
    }),
  )
})
describe('deployment security composition', () => {
  test(
    'shows the unauthenticated warning before configuration arrives',
    mint({
      setup: () => {
        clientTestFixture()
        return { env: { ...env, security: 'warning' as const } }
      },
      exercise: ({ env }) => render(<App env={env} />),
      verify: async () => {
        expect(
          await screen.findByRole('alert', { name: /unauthenticated deployment warning/i }),
        ).toBeTruthy()
        expect(screen.getByText(/security: unsecured/i)).toBeTruthy()
        expect(screen.getByText(/take it down now/i)).toBeTruthy()
        expect(
          screen
            .getByRole('link', { name: 'Read the authentication setup guide' })
            .getAttribute('href'),
        ).toContain('docs/oidc-authentication.md')
      },
    }),
  )
  test(
    'blocks configuration and panel reads when authentication is blocked',
    mint({
      setup: () => {
        const fetcher = vi.fn()
        vi.stubGlobal('fetch', fetcher)
        return { env: { ...env, security: 'blocked' as const }, fetcher }
      },
      exercise: ({ env }) => render(<App env={env} />),
      verify: (_, { fetcher }) => {
        expect(
          screen.getByRole('heading', { name: /authentication configuration required/i }),
        ).toBeTruthy()
        expect(screen.getByText('No dashboard data was loaded.')).toBeTruthy()
        expect(fetcher).not.toHaveBeenCalled()
      },
    }),
  )
})
describe('board-to-panel composition', () => {
  test(
    'fetches supported panels, forwards layout and readings, and persists their public evidence',
    mint({
      setup: () => {
        const board = {
          panels: [
            { id: 'build', type: 'pipeline-status', position: { x: 6, y: 4, w: 6, h: 3 } },
            { id: 'note', type: 'markdown' },
            { id: 'deploy', type: 'pipeline-status' },
          ],
        } satisfies Board
        const observations = {
          build: observation('build'),
          deploy: observation('deploy', 'failed'),
        }
        return { ...dashboardFixture(board, observations), board, observations }
      },
      exercise: () => render(<App env={env} />),
      verify: async (_, { requests, board, observations }) => {
        expect(await screen.findByText('Passed')).toBeTruthy()
        expect(await screen.findByText('Failed')).toBeTruthy()
        expect(requests.filter((path) => path.includes('/panel/')).sort()).toEqual(
          Object.keys(observations)
            .map((id) => `/api/panel/${env.board}/${id}`)
            .sort(),
        )
        const panel = screen.getByRole('heading', { name: 'build' }).closest('[data-panel]')
        const position = board.panels[0]?.position
        expect(panel?.getAttribute('style')).toContain(
          `--panel-column: ${(position?.x ?? 0) + 1} / span ${position?.w}`,
        )
        expect(panel?.getAttribute('style')).toContain(
          `--panel-row: ${(position?.y ?? 0) + 1} / span ${position?.h}`,
        )
        const saved = JSON.parse(
          window.localStorage.getItem('ze-great-dashboard.diagnostics.v2') ?? '{}',
        )
        expect(saved.events).toEqual(
          expect.arrayContaining(
            Object.values(observations).map((value) =>
              expect.objectContaining({
                kind: 'panel-rendered',
                panelId: value.panelId,
                rendered: expect.objectContaining({ state: value.state }),
              }),
            ),
          ),
        )
      },
    }),
  )
  test(
    'renders the configured local demo without panel requests',
    mint({
      setup: () =>
        dashboardFixture({ panels: [{ id: 'demo', type: 'pipeline-animation-demo' }] }, {}),
      exercise: () => render(<App env={env} />),
      verify: async (_, { requests }) => {
        expect(await screen.findByText(/Demo treatment ·/)).toBeTruthy()
        expect(requests.filter((path) => path.includes('/panel/'))).toEqual([])
      },
    }),
  )
  test(
    'forwards a source access failure with its source link',
    mint({
      setup: () => {
        const envelope: Envelope = {
          panelId: 'build',
          state: 'error',
          observedAt: '2026-08-18T12:00:00.000Z',
          link: 'https://github.com/example/repo/actions',
          error: { kind: 'unauthorized', message: 'Token no longer grants workflow access.' },
        }
        dashboardFixture(
          { panels: [{ id: envelope.panelId, type: 'pipeline-status' }] },
          { build: envelope },
        )
        return { envelope }
      },
      exercise: () => render(<App env={env} />),
      verify: async (_, { envelope }) => {
        expect(await screen.findByText('Access denied')).toBeTruthy()
        expect(
          screen
            .getByRole('link', { name: `View source for ${envelope.panelId} (opens in a new tab)` })
            .getAttribute('href'),
        ).toBe(envelope.link)
      },
    }),
  )
  test(
    'reads independently configured facts into one partial panel',
    mint({
      setup: () => {
        const requests: string[] = []
        const apiFact = {
          id: 'api',
          label: 'API',
          url: 'https://api.example.com/version',
          value: '2.0.0',
        }
        const webFact = { id: 'web', label: 'Web', url: 'https://web.example.com/version' }
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input: string | URL) => {
            const path = String(input)
            requests.push(path)
            if (path === `${env.proxyPath}/client`)
              return Response.json({ ...env, serverVersion: 'test-server' })
            if (path.startsWith('/api/boards/'))
              return Response.json({
                panels: [{ id: 'versions', type: 'http-value', facts: [apiFact, webFact] }],
              })
            return Response.json(
              path.endsWith(`/facts/${apiFact.id}`)
                ? {
                    panelId: 'versions',
                    state: 'ok',
                    observedAt: '2026-08-18T12:00:00.000Z',
                    link: apiFact.url,
                    signal: { type: 'http-value', value: apiFact.value },
                  }
                : {
                    panelId: 'versions',
                    state: 'error',
                    observedAt: '2026-08-18T12:00:00.000Z',
                    link: webFact.url,
                    error: { kind: 'unreachable', message: 'offline' },
                  },
            )
          }),
        )
        return { requests, apiFact, webFact }
      },
      exercise: () => render(<App env={env} />),
      verify: async (_, { requests, apiFact, webFact }) => {
        expect(await screen.findByText(apiFact.value)).toBeTruthy()
        expect(await screen.findByText('Source unavailable')).toBeTruthy()
        expect(requests.filter((path) => path.includes('/facts/')).sort()).toEqual(
          [apiFact, webFact]
            .map((fact) => `/api/panel/${env.board}/versions/facts/${fact.id}`)
            .sort(),
        )
        expect(requests.some((path) => path.endsWith('/versions'))).toBe(false)
        for (const fact of [apiFact, webFact]) {
          expect(screen.getByRole('heading', { name: fact.label })).toBeTruthy()
          expect(
            screen
              .getByRole('link', { name: `View source for ${fact.label} (opens in a new tab)` })
              .getAttribute('href'),
          ).toBe(fact.url)
        }
      },
    }),
  )
})
describe('polling composition', () => {
  async function pollingFixture(priorResponses: Array<Response | Error>) {
    const pending = (() => {
      let resolve: (response: Response) => void = () => {}
      let reject: (error: Error) => void = () => {}
      const promise = new Promise<Response>((accept, deny) => {
        resolve = accept
        reject = deny
      })
      return { resolve, reject, promise }
    })()
    const responses = [...priorResponses, pending.promise]
    const laterResponse = new Promise<Response>(() => {})
    let markPendingRequested = () => {}
    const pendingRequested = new Promise<void>((resolve) => {
      markPendingRequested = resolve
    })
    const board = {
      refresh: '10ms' as Board['refresh'],
      panels: [{ id: 'build', type: 'pipeline-status' }],
    }
    vi.stubGlobal('fetch', async (input: string | URL, options?: RequestInit) => {
      if (String(input).startsWith('/api/boards/')) return Response.json(board)
      if (String(input) === `${env.proxyPath}/client`)
        return Response.json({ ...env, serverVersion: 'test-server' })
      // Delivery is asynchronous; a canceled Strict Mode mount must not consume the next response.
      await Promise.resolve()
      options?.signal?.throwIfAborted()
      const next = responses.shift()
      if (next instanceof Error) throw next
      if (next === pending.promise) markPendingRequested()
      // Later polls stay in flight until this scenario ends.
      return next ?? laterResponse
    })
    render(<App env={env} />)
    await screen.findByText('Passed')
    await act(() => pendingRequested)
    return { pending }
  }
  test(
    'forwards a refreshed signal to the rendered panel',
    mint({
      setup: async () => ({
        ...(await pollingFixture([Response.json(observation('build'))])),
        response: Response.json(observation('build', 'failed')),
      }),
      exercise: async ({ pending, response }) => {
        await act(async () => pending.resolve(response))
      },
      verify: async () => {
        expect(await screen.findByText('Failed')).toBeTruthy()
        expect(screen.queryByText('Passed')).toBeNull()
      },
    }),
  )
  test(
    'discloses missed updates while preserving the last rendered reading',
    mint({
      setup: async () => ({
        ...(await pollingFixture([Response.json(observation('build'))])),
        error: new Error('offline'),
      }),
      exercise: async ({ pending, error }) => {
        await act(async () => pending.reject(error))
      },
      verify: async (_, { error }) => {
        expect(await screen.findByText(`Updates delayed · ${error.message}`)).toBeTruthy()
        expect(screen.getByText('Passed')).toBeTruthy()
        expect(screen.getByText(/Last confirmed just now/)).toBeTruthy()
      },
    }),
  )
  test(
    'clears the update disclosure when polling recovers',
    mint({
      setup: async () => {
        const world = await pollingFixture([
          Response.json(observation('build')),
          new Error('offline'),
        ])
        await screen.findByText(/Updates delayed · offline/)
        return { ...world, response: Response.json(observation('build')) }
      },
      exercise: async ({ pending, response }) => {
        await act(async () => pending.resolve(response))
      },
      verify: async () => {
        await waitFor(() => expect(screen.queryByText(/Updates delayed/)).toBeNull())
        expect(screen.getByText('Passed')).toBeTruthy()
        expect(screen.queryByText(/Last confirmed/)).toBeNull()
      },
    }),
  )
})
