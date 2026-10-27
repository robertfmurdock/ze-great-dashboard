import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PipelineStatus } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { clientTestFixture, env } from './client-test-fixture.tsx'
import { renderApp as render } from './render-app.tsx'

describe('the board shell', () => {
  test(
    'renders the configured board name',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        return { env }
      },
      exercise: ({ env }) => {
        render(<App env={env} />)
      },
      verify: async () => {
        expect(await screen.findByRole('heading', { name: 'ze-great-team' })).not.toBeNull()
      },
    }),
  )

  test(
    'shows the client asset identity in Diagnostics',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        render(<App env={env} />)
        return { user: userEvent.setup() }
      },
      exercise: async ({ user }) => user.click(screen.getByRole('button', { name: /Diagnostics/ })),
      verify: async () => {
        expect(await screen.findByText(/Client dev · assets/)).not.toBeNull()
        expect(
          await screen.findByText(new RegExp(env.assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))),
        ).not.toBeNull()
      },
    }),
  )

  test(
    'renders a loading placeholder while the board request is pending',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        return { env }
      },
      exercise: ({ env }) => {
        render(<App env={env} />)
      },
      verify: async () => expect(await screen.findByText(/Loading configuration/i)).not.toBeNull(),
    }),
  )

  test(
    'identifies configured authorities as the source of signals',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        return { env }
      },
      exercise: ({ env }) => {
        render(<App env={env} />)
      },
      verify: async () => expect(await screen.findByText(/read live/i)).not.toBeNull(),
    }),
  )
})

describe('deployment security boundary', () => {
  test(
    'shows the unauthenticated deployment warning while the board request is pending',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        return { env: { ...env, security: 'warning' as const } }
      },
      exercise: ({ env }) => {
        render(<App env={env} />)
      },
      verify: async () => {
        expect(
          await screen.findByRole('alert', { name: /unauthenticated deployment warning/i }),
        ).not.toBeNull()
        expect(screen.getByText(/security: unsecured/i)).not.toBeNull()
        expect(screen.getByText(/take it down now/i)).not.toBeNull()
        expect(
          screen
            .getByRole('link', { name: 'Read the authentication setup guide' })
            .getAttribute('href'),
        ).toContain('docs/oidc-authentication.md')
      },
    }),
  )

  test(
    'blocks board and panel requests when authentication configuration is blocked',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        const fetcher = vi.fn()
        vi.stubGlobal('fetch', fetcher)
        return { env: { ...env, security: 'blocked' as const }, fetcher }
      },
      exercise: ({ env }) => {
        render(<App env={env} />)
      },
      verify: (_output, { fetcher }) => {
        expect(
          screen.getByRole('heading', { name: /authentication configuration required/i }),
        ).not.toBeNull()
        expect(screen.getByText('No dashboard data was loaded.')).not.toBeNull()
        expect(fetcher).not.toHaveBeenCalled()
      },
    }),
  )
})

describe('pipeline-status panels', () => {
  const okEnvelope = (panelId: string, status: PipelineStatus['status'], durationMs?: number) =>
    JSON.stringify({
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
        ...(durationMs === undefined ? {} : { durationMs }),
      },
    })

  function setup(
    board: Record<string, unknown>,
    responses: Record<string, Array<Response | Promise<Response>>> = {},
  ) {
    const requests: string[] = []
    const fetcher = vi.fn((input: string | URL) => {
      const url = String(input)
      requests.push(url)
      if (url.startsWith('/api/boards/'))
        return Promise.resolve(new Response(JSON.stringify(board)))
      const panelId = decodeURIComponent(url.split('/').at(-1) ?? '')
      const panelResponses = responses[panelId] ?? [new Response(okEnvelope(panelId, 'passed'))]
      const response = panelResponses.shift()
      return response
        ? Promise.resolve(response)
        : Promise.resolve(new Response(okEnvelope(panelId, 'passed')))
    })
    vi.stubGlobal('fetch', fetcher)
    return { fetcher, requests }
  }

  async function settle() {
    await act(async () => {})
  }

  function dashboardFixture(
    scope: ResourceScope,
    board: Record<string, unknown>,
    responses?: Record<string, Array<Response | Promise<Response>>>,
  ) {
    clientTestFixture(scope)
    return setup(board, responses)
  }

  describe('panel rendering', () => {
    test(
      'fetches each supported panel immediately and does not fetch unsupported panels',
      mint({
        setup: ({ scope }) =>
          dashboardFixture(scope, {
            panels: [
              { id: 'build', type: 'pipeline-status' },
              { id: 'note', type: 'markdown' },
              { id: 'deploy', type: 'pipeline-status' },
            ],
          }),
        exercise: async () => {
          render(<App env={env} />)
          await settle()
        },
        verify: (_output, { requests }) => {
          expect(requests.filter((url) => url.includes('/panel/'))).toHaveLength(2)
          expect(requests.some((url) => url.endsWith('/note'))).toBe(false)
        },
      }),
    )

    test(
      'renders the local animation demo without creating a panel request',
      mint({
        setup: ({ scope }) =>
          dashboardFixture(scope, {
            panels: [{ id: 'active-run-treatments', type: 'pipeline-animation-demo' }],
          }),
        exercise: async () => {
          render(<App env={env} />)
        },
        verify: async (_output, { requests }) => {
          expect(await screen.findByText(/Demo treatment ·/)).not.toBeNull()
          expect(
            document.querySelector('[data-running-field], [data-running-progress]'),
          ).not.toBeNull()
          expect(requests.filter((url) => url.includes('/panel/'))).toEqual([])
        },
      }),
    )

    test(
      'shows a brief duration for completed runs only',
      mint({
        setup: ({ scope }) =>
          dashboardFixture(
            scope,
            { panels: [{ id: 'build', type: 'pipeline-status' }] },
            { build: [new Response(okEnvelope('build', 'passed', 134_000))] },
          ),
        exercise: async () => {
          render(<App env={env} />)
        },
        verify: async (_output, { requests }) => {
          expect(await screen.findByText('Took 2m 14s')).not.toBeNull()
          expect(requests.some((url) => url.endsWith('/build'))).toBe(true)
          expect(screen.getAllByText(/Last update/).length).toBeGreaterThan(0)
          expect(screen.queryByText(/Checked/)).toBeNull()
        },
      }),
    )

    test(
      'shows concise live activity only for in-progress runs',
      mint({
        setup: ({ scope }) =>
          dashboardFixture(
            scope,
            { panels: [{ id: 'build', type: 'pipeline-status' }] },
            {
              build: [
                new Response(
                  okEnvelope('build', 'running').replace(
                    '"sourceUpdatedAt":"2026-08-18T11:00:00.000Z"',
                    '"sourceUpdatedAt":"2026-08-18T11:00:00.000Z","activity":{"kind":"step","name":"integration tests","parent":"build"}',
                  ),
                ),
              ],
            },
          ),
        exercise: async () => {
          render(<App env={env} />)
        },
        verify: async () => {
          expect(await screen.findByText(/build › integration tests/)).not.toBeNull()
          expect(screen.queryByText('in_progress')).toBeNull()
        },
      }),
    )

    test(
      'shows the source update age instead of browser poll evidence',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          vi.useFakeTimers()
          vi.setSystemTime(new Date('2026-08-28T12:10:00.000Z'))
          setup(
            { panels: [{ id: 'build', type: 'pipeline-status' }] },
            {
              build: [
                new Response(
                  JSON.stringify({
                    panelId: 'build',
                    state: 'ok',
                    observedAt: '2026-08-28T12:00:00.000Z',
                    link: null,
                    signal: {
                      type: 'pipeline-status',
                      status: 'passed',
                      rawStatus: 'success',
                      name: 'Build',
                      sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
                    },
                  }),
                ),
              ],
            },
          )
        },
        exercise: async () => {
          render(<App env={env} />)
          await settle()
        },
        verify: () => {
          expect(screen.queryByText(/Checked/)).toBeNull()
          expect(screen.getByText('Last update 1h 10m ago')).not.toBeNull()
        },
      }),
    )

    test(
      'does not show duration while a run is in progress',
      mint({
        setup: ({ scope }) =>
          dashboardFixture(
            scope,
            { panels: [{ id: 'build', type: 'pipeline-status' }] },
            { build: [new Response(okEnvelope('build', 'running', 134_000))] },
          ),
        exercise: async () => {
          render(<App env={env} />)
          await settle()
        },
        verify: () => expect(screen.queryByText(/Took/)).toBeNull(),
      }),
    )
  })

  function runningEnvelope(
    panelId: string,
    options: { startedAt?: string; estimateMs?: number } = {},
  ) {
    return new Response(
      JSON.stringify({
        panelId,
        state: 'ok',
        observedAt: '2026-08-18T12:00:00.000Z',
        link: null,
        signal: {
          type: 'pipeline-status',
          status: 'running',
          rawStatus: 'in_progress',
          name: panelId,
          ...(options.startedAt ? { runStartedAt: options.startedAt } : {}),
          ...(options.estimateMs ? { estimatedDurationMs: options.estimateMs } : {}),
        },
      }),
    )
  }

  type RunningAnimation =
    | 'radial'
    | 'runway'
    | 'orbit'
    | 'signal-field'
    | 'telemetry-bloom'
    | 'release-transit'
    | 'status-weather'
    | 'flight-path'

  function runningPanelFixture(scope: ResourceScope, animation: RunningAnimation) {
    clientTestFixture(scope)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-18T12:02:00.000Z'))
    setup(
      { panels: [{ id: 'build', type: 'pipeline-status', running_animation: animation }] },
      {
        build: [
          runningEnvelope('build', {
            startedAt: '2026-08-18T12:00:00.000Z',
            estimateMs: 300_000,
          }),
        ],
      },
    )
    return { animation }
  }

  describe('running animation treatments', () => {
    for (const animation of ['radial', 'orbit'] as const)
      test(
        `renders the ${animation} active-run treatment with local elapsed progress`,
        mint({
          setup: ({ scope }) => runningPanelFixture(scope, animation),
          exercise: async () => {
            render(<App env={env} />)
            await settle()
            const initialText = screen.getByText(/Elapsed 2m 0s/).textContent
            await act(async () => vi.advanceTimersByTime(1_000))
            return { initialText, advancedText: screen.getByText(/Elapsed 2m 1s/).textContent }
          },
          verify: ({ initialText, advancedText }, { animation }) => {
            expect(document.querySelector(`[data-running-progress="${animation}"]`)).not.toBeNull()
            expect(initialText).toContain('Elapsed 2m 0s')
            expect(initialText).toContain('Expected ≈ ')
            expect(advancedText).toContain('Elapsed 2m 1s')
          },
        }),
      )

    for (const animation of ['runway', 'signal-field'] as const)
      test(
        `renders the ${animation} compact active-run readout with local elapsed progress`,
        mint({
          setup: ({ scope }) => runningPanelFixture(scope, animation),
          exercise: async () => {
            render(<App env={env} />)
            await settle()
            const initialText = screen.getByText(/2:00\/~/).textContent
            await act(async () => vi.advanceTimersByTime(1_000))
            return { initialText, advancedText: screen.getByText(/2:01\/~/).textContent }
          },
          verify: ({ initialText, advancedText }, { animation }) => {
            expect(document.querySelector(`[data-running-progress="${animation}"]`)).not.toBeNull()
            expect(initialText).toMatch(/2:00\/~\d+:\d{2}/)
            expect(advancedText).toMatch(/2:01\/~\d+:\d{2}/)
          },
        }),
      )

    test(
      'keeps the signal-field visual decorative alongside its compact active-run readout',
      mint({
        setup: ({ scope }) => runningPanelFixture(scope, 'signal-field'),
        exercise: async () => {
          render(<App env={env} />)
          await settle()
          return document.querySelector('[data-running-visual]')?.getAttribute('aria-hidden')
        },
        verify: (ariaHidden) => expect(ariaHidden).toBe('true'),
      }),
    )

    for (const animation of [
      'telemetry-bloom',
      'release-transit',
      'status-weather',
      'flight-path',
    ] as const)
      test(
        `renders the ${animation} active-run field with local elapsed progress`,
        mint({
          setup: ({ scope }) => runningPanelFixture(scope, animation),
          exercise: async () => {
            render(<App env={env} />)
            await settle()
            const initialText = screen.getByText(/2:00\/~/).textContent
            await act(async () => vi.advanceTimersByTime(1_000))
            return { initialText, advancedText: screen.getByText(/2:01\/~/).textContent }
          },
          verify: ({ initialText, advancedText }, { animation }) => {
            expect(
              document.querySelector(`[data-running-field][data-animation="${animation}"]`),
            ).not.toBeNull()
            expect(initialText).toMatch(/2:00\/~\d+:\d{2}/)
            expect(advancedText).toMatch(/2:01\/~\d+:\d{2}/)
          },
        }),
      )

    test(
      'keeps an overdue run visibly active and can disable the treatment per panel',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          vi.useFakeTimers()
          vi.setSystemTime(new Date('2026-08-18T12:05:00.000Z'))
          setup(
            {
              panels: [
                { id: 'late', type: 'pipeline-status', running_animation: 'runway' },
                { id: 'plain', type: 'pipeline-status', running_animation: 'off' },
              ],
            },
            {
              late: [
                runningEnvelope('late', {
                  startedAt: '2026-08-18T12:00:00.000Z',
                  estimateMs: 60_000,
                }),
              ],
              plain: [runningEnvelope('plain')],
            },
          )
        },
        exercise: async () => {
          render(<App env={env} />)
          await settle()
        },
        verify: () => {
          expect(
            document.querySelector('[data-running-progress][data-overdue="true"]'),
          ).not.toBeNull()
          expect(screen.getByText('⚠5:00/~1:00')).not.toBeNull()
          expect(screen.getAllByText('Running').length).toBe(2)
          expect(document.querySelectorAll('[data-running-progress]')).toHaveLength(1)
        },
      }),
    )

    test(
      'renders an indeterminate active treatment when timing history is unavailable',
      mint({
        setup: ({ scope }) =>
          dashboardFixture(
            scope,
            {
              panels: [
                { id: 'build', type: 'pipeline-status', running_animation: 'telemetry-bloom' },
              ],
            },
            { build: [runningEnvelope('build')] },
          ),
        exercise: async () => {
          render(<App env={env} />)
          await settle()
        },
        verify: () => {
          expect(
            document.querySelector(
              '[data-running-field][data-animation="telemetry-bloom"][data-indeterminate="true"]',
            ),
          ).not.toBeNull()
          expect(screen.getByText(/Expected duration unavailable/)).not.toBeNull()
        },
      }),
    )
  })

  describe('refresh and polling', () => {
    test(
      'uses panel refresh before the board refresh',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          vi.useFakeTimers()
          return setup({
            refresh: '200ms',
            panels: [
              { id: 'board-default', type: 'pipeline-status' },
              { id: 'panel-override', type: 'pipeline-status', refresh: '100ms' },
              { id: 'fallback', type: 'pipeline-status' },
            ],
          })
        },
        exercise: async ({ requests }) => {
          render(<App env={env} />)
          await settle()
          const panelRequests = () => requests.filter((url) => url.includes('/panel/'))
          const initial = panelRequests().length
          await act(async () => vi.advanceTimersByTime(99))
          const beforeOverride = panelRequests().length
          await act(async () => vi.advanceTimersByTime(1))
          const overrides = panelRequests().filter((url) => url.endsWith('/panel-override')).length
          await act(async () => vi.advanceTimersByTime(100))
          return {
            initial,
            beforeOverride,
            boardDefaults: panelRequests().filter((url) => url.endsWith('/board-default')).length,
            overrides,
          }
        },
        verify: ({ initial, beforeOverride, overrides, boardDefaults }) => {
          expect(initial).toBe(3)
          expect(beforeOverride).toBe(3)
          expect(overrides).toBe(2)
          expect(boardDefaults).toBe(2)
        },
      }),
    )

    test(
      'uses a 60-second default when neither board nor panel sets refresh',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          vi.useFakeTimers()
          return setup({ panels: [{ id: 'fallback', type: 'pipeline-status' }] })
        },
        exercise: async ({ requests }) => {
          render(<App env={env} />)
          await settle()
          await act(async () => vi.advanceTimersByTime(59_999))
          const beforeRefresh = requests.filter((url) => url.endsWith('/fallback')).length
          await act(async () => vi.advanceTimersByTime(1))
          return {
            beforeRefresh,
            afterRefresh: requests.filter((url) => url.endsWith('/fallback')).length,
          }
        },
        verify: ({ beforeRefresh, afterRefresh }) => {
          expect(beforeRefresh).toBe(1)
          expect(afterRefresh).toBe(2)
        },
      }),
    )

    test(
      'updates the rendered signal on refresh',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          vi.useFakeTimers()
          setup(
            { refresh: '1s', panels: [{ id: 'build', type: 'pipeline-status' }] },
            {
              build: [
                new Response(okEnvelope('build', 'passed')),
                new Response(okEnvelope('build', 'failed')),
              ],
            },
          )
        },
        exercise: async () => {
          render(<App env={env} />)
          await settle()
          const initialText = screen.getByText('Passed').textContent
          await act(async () => vi.advanceTimersByTime(1_000))
          await settle()
          return { initialText, refreshedText: screen.getByText('Failed').textContent }
        },
        verify: ({ initialText, refreshedText }) => {
          expect(initialText).toContain('Passed')
          expect(screen.getAllByText('main').length).toBeGreaterThan(0)
          expect(refreshedText).toContain('Failed')
        },
      }),
    )

    test(
      'records responses, 304s, invalid envelopes, failures, and rendered changes locally',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          vi.useFakeTimers()
          const values = new Map<string, string>()
          const store = {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => values.set(key, value),
            removeItem: (key: string) => values.delete(key),
          }
          vi.stubGlobal('localStorage', store)
          const rejected = Promise.reject(new Error('offline'))
          rejected.catch(() => undefined)
          setup(
            { refresh: '1s', panels: [{ id: 'build', type: 'pipeline-status' }] },
            {
              build: [
                new Response(okEnvelope('build', 'passed'), { headers: { etag: 'W/"first"' } }),
                new Response(null, { status: 304 }),
                new Response(JSON.stringify({ nope: true })),
                rejected,
              ],
            },
          )
          return { store }
        },
        exercise: async ({ store }) => {
          render(<App env={env} />)
          await settle()
          await act(async () => vi.advanceTimersByTime(1_000))
          await settle()
          const afterNotModified = JSON.parse(
            store.getItem('ze-great-dashboard.diagnostics.v2') ?? '{}',
          )
          await act(async () => vi.advanceTimersByTime(1_000))
          await settle()
          const afterMalformedResponse = JSON.parse(
            store.getItem('ze-great-dashboard.diagnostics.v2') ?? '{}',
          )
          await act(async () => vi.advanceTimersByTime(1_000))
          await settle()
          return {
            afterNotModified,
            afterMalformedResponse,
            afterOfflineFailure: JSON.parse(
              store.getItem('ze-great-dashboard.diagnostics.v2') ?? '{}',
            ),
          }
        },
        verify: ({ afterNotModified, afterMalformedResponse, afterOfflineFailure }) => {
          const kinds = (saved: { events: Array<{ kind: string }> }) =>
            saved.events.map((event) => event.kind)
          expect(kinds(afterNotModified)).toContain('panel-rendered')
          expect(
            afterNotModified.events.some((event: { status?: number }) => event.status === 304),
          ).toBe(true)
          expect(kinds(afterMalformedResponse)).toContain('panel-fetch-parse-failure')
          expect(kinds(afterOfflineFailure)).toContain('panel-fetch-failure')
        },
      }),
    )

    test(
      'keeps the last signal visible while missed updates escalate and clear on recovery',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          vi.useFakeTimers()
          vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
          const offline = () => {
            const failure = Promise.reject(new Error('offline'))
            failure.catch(() => undefined)
            return failure
          }
          setup(
            { refresh: '1s', panels: [{ id: 'build', type: 'pipeline-status' }] },
            {
              build: [
                new Response(okEnvelope('build', 'passed')),
                offline(),
                offline(),
                offline(),
                new Response(okEnvelope('build', 'passed')),
              ],
            },
          )
        },

        exercise: async () => {
          render(<App env={env} />)
          await settle()
          const initialText = screen.getByText('Passed').textContent

          await act(async () => vi.advanceTimersByTimeAsync(1_000))
          const delayedText = screen
            .getByText(/Updates delayed · offline/)
            .closest('[data-panel]')?.textContent

          await act(async () => vi.advanceTimersByTimeAsync(2_000))
          const unavailableText = screen
            .getByText(/Updates unavailable · offline/)
            .closest('[data-panel]')?.textContent

          await act(async () => vi.advanceTimersByTimeAsync(1_000))
          return { initialText, delayedText, unavailableText }
        },
        verify: ({ initialText, delayedText, unavailableText }) => {
          expect(initialText).toContain('Passed')
          expect(initialText).not.toContain('Updates delayed')
          expect(delayedText).toContain('Updates delayed · offline')
          expect(delayedText).toContain('Updates delayed · offline')
          expect(delayedText).toContain('Last confirmed')
          expect(unavailableText).toContain('Updates unavailable · offline')
          expect(screen.queryByText(/Updates delayed/)).toBeNull()
          expect(screen.queryByText(/Updates unavailable/)).toBeNull()
          expect(screen.queryByText(/Last confirmed/)).toBeNull()
        },
      }),
    )
  })

  describe('panel failure states', () => {
    test(
      'makes an empty workflow result clear on the panel',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          const sourceLink =
            'https://github.com/example-org/example-repo/actions/workflows/build.yml'
          const panelId = 'build'
          setup(
            { panels: [{ id: panelId, type: 'pipeline-status' }] },
            {
              [panelId]: [
                new Response(
                  JSON.stringify({
                    panelId,
                    state: 'error',
                    observedAt: '2026-08-18T12:00:00.000Z',
                    link: sourceLink,
                    error: {
                      kind: 'no-runs',
                      message:
                        'No workflow runs found for branch "master". Check the source\'s branch setting.',
                    },
                  }),
                ),
              ],
            },
          )
          return { panelId, sourceLink }
        },
        exercise: async () => {
          render(<App env={env} />)
        },
        verify: async (_output, { panelId, sourceLink }) => {
          expect(await screen.findByText('No workflow runs')).not.toBeNull()
          expect(screen.getByText(/branch "master"/)).not.toBeNull()
          const link = screen.getByRole('link', {
            name: `View source for ${panelId} (opens in a new tab)`,
          })
          expect(link?.getAttribute('href')).toBe(sourceLink)
        },
      }),
    )

    test(
      'makes source access problems explicit without inventing an incident time',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          const panelId = 'build'
          const errorMessage = 'Token no longer grants workflow access.'
          const sourceLink =
            'https://github.com/example-org/example-repo/actions/workflows/build.yml'
          setup(
            { panels: [{ id: panelId, type: 'pipeline-status' }] },
            {
              [panelId]: [
                new Response(
                  JSON.stringify({
                    panelId,
                    state: 'error',
                    observedAt: '2026-08-18T12:00:00.000Z',
                    link: sourceLink,
                    error: {
                      kind: 'unauthorized',
                      message: errorMessage,
                    },
                  }),
                ),
              ],
            },
          )
          return { panelId, errorMessage, sourceLink }
        },
        exercise: async () => {
          render(<App env={env} />)
        },
        verify: async (_output, { panelId, errorMessage, sourceLink }) => {
          expect(await screen.findByText('Access denied')).not.toBeNull()
          expect(screen.getByText(errorMessage)).not.toBeNull()
          expect(
            screen
              .getByRole('link', {
                name: `View source for ${panelId} (opens in a new tab)`,
              })
              .getAttribute('href'),
          ).toBe(sourceLink)
          const panel = screen.getByRole('heading', { name: panelId }).closest('[data-panel]')
          expect(panel?.textContent).not.toContain('Observed')
          expect(panel?.textContent).not.toContain('Checked')
        },
      }),
    )

    test(
      'keeps the source link when a pipeline signal is invalid',
      mint({
        setup: ({ scope }) => {
          clientTestFixture(scope)
          const sourceLink =
            'https://github.com/example-org/example-repo/actions/workflows/build.yml'
          const panelId = 'build'
          setup(
            { panels: [{ id: panelId, type: 'pipeline-status' }] },
            {
              [panelId]: [
                new Response(
                  JSON.stringify({
                    panelId,
                    state: 'ok',
                    observedAt: '2026-08-18T12:00:00.000Z',
                    link: sourceLink,
                    signal: { type: 'pipeline-status', status: 'surprising' },
                  }),
                ),
              ],
            },
          )
          return { sourceLink }
        },
        exercise: async () => {
          render(<App env={env} />)
        },
        verify: async (_output, { sourceLink }) => {
          expect(await screen.findByText('Invalid signal')).not.toBeNull()
          expect(
            screen
              .getByRole('link', { name: 'View source for build (opens in a new tab)' })
              .getAttribute('href'),
          ).toBe(sourceLink)
        },
      }),
    )
  })
})

describe('http-value panels', () => {
  function httpFixture(scope: ResourceScope, fetcher: typeof fetch) {
    clientTestFixture(scope)
    vi.stubGlobal('fetch', fetcher)
  }

  test(
    'reads independently configured facts into one partial, evidence-bearing panel',
    mint({
      setup: ({ scope }) => {
        const requests: string[] = []
        const apiFact = {
          id: 'api',
          label: 'API',
          url: 'https://api.example.com/version',
          value: '2.0.0',
        }
        const webFact = {
          id: 'web',
          label: 'Web',
          url: 'https://web.example.com/version',
        }
        httpFixture(scope, async (input) => {
          const url = String(input)
          requests.push(url)
          if (url.startsWith('/api/boards/'))
            return Response.json({
              panels: [
                {
                  id: 'versions',
                  type: 'http-value',
                  facts: [apiFact, webFact],
                },
              ],
            })
          return Response.json(
            url.endsWith(`/facts/${apiFact.id}`)
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
        })
        return { requests, apiFact, webFact }
      },
      exercise: async ({ requests, apiFact }) => {
        render(<App env={env} />)
        await screen.findByText(apiFact.value)
        await screen.findByText('Source unavailable')
        return { requestPaths: [...requests] }
      },
      verify: ({ requestPaths }, { apiFact, webFact }) => {
        expect(requestPaths.filter((url) => url.includes('/facts/'))).toHaveLength(2)
        expect(requestPaths.some((url) => url.endsWith('/versions'))).toBe(false)
        expect(screen.getByRole('heading', { name: apiFact.label })).not.toBeNull()
        expect(screen.getByRole('heading', { name: webFact.label })).not.toBeNull()
        expect(
          screen.getByRole('link', {
            name: `View source for ${apiFact.label} (opens in a new tab)`,
          }),
        ).not.toBeNull()
        expect(
          screen.getByRole('link', {
            name: `View source for ${webFact.label} (opens in a new tab)`,
          }),
        ).not.toBeNull()
      },
    }),
  )

  test(
    'uses configured panel positions in the board grid',
    mint({
      setup: ({ scope }) =>
        httpFixture(scope, async (input) =>
          String(input).startsWith('/api/boards/')
            ? Response.json({
                panels: [
                  { id: 'build', type: 'pipeline-status', position: { x: 6, y: 4, w: 6, h: 3 } },
                ],
              })
            : Response.json({
                panelId: 'build',
                state: 'ok',
                observedAt: '2026-08-18T12:00:00.000Z',
                link: null,
                signal: {
                  type: 'pipeline-status',
                  status: 'passed',
                  rawStatus: 'passed',
                  name: 'build',
                },
              }),
        ),
      exercise: async () => {
        render(<App env={env} />)
      },
      verify: async () => {
        const panel = (await screen.findByRole('heading', { name: 'build' })).closest(
          '[data-panel]',
        )
        expect(panel?.getAttribute('style')).toContain('--panel-column: 7 / span 6')
        expect(panel?.getAttribute('style')).toContain('--panel-row: 5 / span 3')
      },
    }),
  )
})
