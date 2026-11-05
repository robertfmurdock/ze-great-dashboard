import { mint } from '@continuous-excellence/testmints-js/vitest'
import { renderHook, waitFor } from '@testing-library/react'
import type { Board, ClientEnv, Envelope, PipelineStatus } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiagnosticEventInput } from '../src/diagnostics.ts'
import { BrowserPanelMemory } from '../src/panel-memory.ts'
import { usePanelSignals } from '../src/usePanelSignals.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ze-great-team',
}

const board: Board = {
  panels: [
    {
      id: 'build',
      type: 'pipeline-status',
      refresh: '1s' as Board['panels'][number]['refresh'],
    },
  ],
}

const pullRequestBoard: Board = {
  panels: [
    {
      id: 'updates',
      type: 'pull-request-health',
      refresh: '1s' as Board['panels'][number]['refresh'],
      update_workflows: [{ workflow: 'dependency-update.yml' }],
    },
  ],
}

const groupedHttpValueBoard: Board = {
  panels: [
    {
      id: 'versions',
      type: 'http-value',
      facts: [
        { id: 'api', label: 'API', url: 'https://api.example.com/version' },
        { id: 'web', label: 'Web', url: 'https://web.example.com/version' },
      ],
    },
  ],
}

function envelope(
  status: PipelineStatus['status'] = 'passed',
  options: { durationMs?: number; sourceUpdatedAt?: string; link?: string } = {},
) {
  return JSON.stringify({
    panelId: 'build',
    state: 'ok',
    observedAt: '2026-08-21T12:00:00.000Z',
    link: options.link ?? 'https://example.com/build',
    signal: {
      type: 'pipeline-status',
      status,
      rawStatus: status,
      name: 'build',
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
      ...(options.sourceUpdatedAt ? { sourceUpdatedAt: options.sourceUpdatedAt } : {}),
    },
  })
}

function recordingSink() {
  const events: DiagnosticEventInput[] = []
  return {
    events,
    record: (event: DiagnosticEventInput) => events.push(event),
    recordGithubConsistencyIncident: vi.fn(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function pendingFetch() {
  let resolve: (response: Response) => void = () => {
    throw new Error('Response resolver is not initialized')
  }
  const promise = new Promise<Response>((release) => {
    resolve = release
  })
  const pending = { resolve, promise }
  const fetcher = vi.fn((_input: string | URL | Request, _init?: RequestInit) => pending.promise)
  vi.stubGlobal('fetch', fetcher)
  return { ...pending, fetcher }
}
function clock() {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
}
function updateFetch() {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(envelope()))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
type Hook = ReturnType<typeof renderHook<ReturnType<typeof usePanelSignals>, unknown>>
async function initialPoll(hook: Hook) {
  await vi.waitUntil(() => hook.result.current.schedules[0]?.inFlight === false, {
    interval: 1,
    timeout: 500,
  })
}
function persistedFixture() {
  const storage = new Map<string, string>()
  const memory = new BrowserPanelMemory({
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  })
  const accepted = {
    status: 'failed' as const,
    sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
    link: 'https://github.com/example/repo/actions/runs/2',
  }
  memory.rememberLatest(
    { board: env.board, panelId: 'build', source: '', workflow: '', branch: '' },
    accepted,
  )
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      new Response(
        envelope('passed', {
          sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
          link: 'https://github.com/example/repo/actions/runs/1',
        }),
      ),
    )
    .mockResolvedValueOnce(
      new Response(
        envelope('passed', {
          sourceUpdatedAt: '2026-08-28T11:45:00.000Z',
          link: 'https://github.com/example/repo/actions/runs/3',
        }),
      ),
    )
  vi.stubGlobal('fetch', fetcher)
  return { memory, accepted, fetcher, diagnostics: recordingSink() }
}
describe('panel observations and public diagnostics', () => {
  it(
    'fetches test totals through panel polling',
    mint({
      setup: () => {
        const testsPanel = { id: 'tests', type: 'test-count' }
        const reported: Envelope = {
          panelId: testsPanel.id,
          state: 'ok',
          observedAt: '2026-11-02T15:00:00.000Z',
          link: 'https://github.com/example/repo/actions/runs/42',
          signal: { type: 'test-count', status: 'reported', total: 123 },
        }
        const fetcher = vi.fn(async () => Response.json(reported))
        vi.stubGlobal('fetch', fetcher)
        return {
          reported,
          fetcher,
          currentBoard: { panels: [testsPanel] },
          diagnostics: recordingSink(),
          path: `${env.proxyPath}/panel/${env.board}/${testsPanel.id}`,
        }
      },
      exercise: ({ currentBoard, diagnostics }) =>
        renderHook(() => usePanelSignals({ board: currentBoard, env, diagnostics })),
      verify: async (hook, { fetcher, path, reported }) => {
        await waitFor(() => expect(hook.result.current.signals[reported.panelId]).toEqual(reported))
        expect(fetcher).toHaveBeenCalledWith(path, expect.any(Object))
      },
    }),
  )
  it(
    'records independently observed HTTP facts and their public projection',
    mint({
      setup: () => {
        const diagnostics = recordingSink()
        const responses: Record<string, Envelope> = {
          api: {
            panelId: 'versions',
            state: 'ok',
            observedAt: '2026-08-21T12:00:00.000Z',
            link: 'https://api.example.com/version',
            signal: { type: 'http-value', value: '2.0.0' },
          },
          web: {
            panelId: 'versions',
            state: 'error',
            observedAt: '2026-08-21T12:00:00.000Z',
            link: 'https://web.example.com/version',
            error: { kind: 'unreachable', message: 'offline' },
          },
        }
        vi.stubGlobal(
          'fetch',
          vi.fn(async (input: string | URL) =>
            Response.json(responses[String(input).split('/').at(-1) ?? '']),
          ),
        )
        return { diagnostics, responses, currentBoard: groupedHttpValueBoard }
      },
      exercise: ({ diagnostics, currentBoard }) =>
        renderHook(() => usePanelSignals({ board: currentBoard, env, diagnostics })),
      verify: async (hook, { diagnostics, responses }) => {
        await waitFor(() => {
          expect(hook.result.current.factSignals.versions?.api?.envelope).toEqual(responses.api)
          expect(hook.result.current.factSignals.versions?.web?.envelope).toEqual(responses.web)
          expect(hook.result.current.schedules[0]).toMatchObject({
            panelId: 'versions',
            knownPaths: [
              '/api/panel/ze-great-team/versions/facts/api',
              '/api/panel/ze-great-team/versions/facts/web',
            ],
            inFlight: false,
            cadence: 'normal',
          })
          expect(diagnostics.events).toContainEqual(
            expect.objectContaining({
              kind: 'panel-rendered',
              panelId: 'versions',
              rendered: {
                state: 'ok',
                link: null,
                facts: [
                  { id: 'api', state: 'ok', link: responses.api?.link },
                  { id: 'web', state: 'error', link: responses.web?.link },
                ],
              },
            }),
          )
        })
      },
    }),
  )
  it(
    'emits fetch and rendered evidence through its sink',
    mint({
      setup: () => {
        const diagnostics = recordingSink()
        const reported = JSON.parse(envelope()) as Envelope
        const etag = 'W/"build"'
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => Response.json(reported, { headers: { etag } })),
        )
        return { diagnostics, reported, etag }
      },
      exercise: ({ diagnostics }) => renderHook(() => usePanelSignals({ board, env, diagnostics })),
      verify: async (hook, { diagnostics, reported, etag }) => {
        await waitFor(() => {
          expect(hook.result.current.signals.build).toEqual(reported)
          expect(diagnostics.events).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ kind: 'panel-fetch-start', panelId: reported.panelId }),
              expect.objectContaining({
                kind: 'panel-rendered',
                rendered: { state: 'ok', status: 'passed', link: reported.link },
              }),
            ]),
          )
          const responses = diagnostics.events.filter(
            (event) => event.kind === 'panel-fetch-response',
          )
          expect(responses).toHaveLength(1)
          expect(responses[0]).toMatchObject({
            status: 200,
            cache: { etag },
            envelope: { state: reported.state },
          })
        })
      },
    }),
  )
  for (const scenario of [
    { name: 'malformed JSON', body: '{' },
    { name: 'an invalid envelope', body: JSON.stringify({ unrelated: true }) },
  ]) {
    it(
      `classifies ${scenario.name} as a parse failure`,
      mint({
        setup: () => {
          const diagnostics = recordingSink()
          vi.stubGlobal(
            'fetch',
            vi.fn(async () => new Response(scenario.body)),
          )
          return { diagnostics }
        },
        exercise: ({ diagnostics }) =>
          renderHook(() => usePanelSignals({ board, env, diagnostics })),
        verify: async (hook, { diagnostics }) => {
          await waitFor(() => {
            expect(hook.result.current.schedules[0]?.inFlight).toBe(false)
            expect(
              diagnostics.events.some((event) => event.kind === 'panel-fetch-parse-failure'),
            ).toBe(true)
            expect(diagnostics.events.some((event) => event.kind === 'panel-fetch-failure')).toBe(
              false,
            )
          })
        },
      }),
    )
  }
})
describe('poll lifecycle scheduling', () => {
  it(
    'publishes an in-flight schedule without a next poll while a response is pending',
    mint({
      setup: () => ({ ...pendingFetch(), diagnostics: recordingSink() }),
      exercise: ({ diagnostics }) => renderHook(() => usePanelSignals({ board, env, diagnostics })),
      verify: (hook) =>
        expect(hook.result.current.schedules[0]).toMatchObject({
          panelId: 'build',
          inFlight: true,
          nextDueAt: undefined,
        }),
    }),
  )
  it(
    'schedules the next poll after the response settles',
    mint({
      setup: () => {
        clock()
        const pending = pendingFetch()
        const diagnostics = recordingSink()
        const hook = renderHook(() => usePanelSignals({ board, env, diagnostics }))
        const releaseAt = Date.now()
        return { ...pending, hook, releaseAt }
      },
      exercise: async ({ hook, resolve }) => {
        await act(async () => resolve(new Response(envelope())))
        return hook
      },
      verify: async (hook, { releaseAt }) => {
        await vi.waitFor(
          () => {
            const schedule = hook.result.current.schedules[0]
            expect(schedule).toMatchObject({ inFlight: false, cadence: 'normal' })
            expect(Date.parse(schedule?.nextDueAt ?? '')).toBeGreaterThanOrEqual(releaseAt + 1000)
            expect(Date.parse(schedule?.nextDueAt ?? '')).toBeLessThanOrEqual(releaseAt + 1100)
          },
          { interval: 1, timeout: 500 },
        )
      },
    }),
  )
  it(
    'uses a completed duration for the next running response',
    mint({
      setup: async () => {
        clock()
        const durationMs = 90000
        const fetcher = vi
          .fn<typeof fetch>()
          .mockResolvedValueOnce(
            new Response(
              envelope('failed', { durationMs, sourceUpdatedAt: '2026-08-28T11:00:00Z' }),
            ),
          )
          .mockResolvedValueOnce(
            new Response(envelope('running', { sourceUpdatedAt: '2026-08-28T11:30:00Z' })),
          )
        vi.stubGlobal('fetch', fetcher)
        const diagnostics = recordingSink()
        const hook = renderHook(() => usePanelSignals({ board, env, diagnostics }))
        await initialPoll(hook)
        return { hook, fetcher, durationMs }
      },
      exercise: async ({ hook }) => {
        await act(async () => vi.advanceTimersByTimeAsync(1000))
        return hook
      },
      verify: async (hook, { fetcher, durationMs }) => {
        await vi.waitFor(
          () => {
            expect(hook.result.current.signals.build).toMatchObject({
              state: 'ok',
              signal: { status: 'running', estimatedDurationMs: durationMs },
            })
            expect(fetcher).toHaveBeenCalledTimes(2)
          },
          { interval: 1, timeout: 500 },
        )
      },
    }),
  )
  it(
    'surfaces missed updates after previously confirmed evidence',
    mint({
      setup: async () => {
        clock()
        const fetcher = updateFetch()
        const diagnostics = recordingSink()
        const hook = renderHook(() => usePanelSignals({ board, env, diagnostics }))
        await initialPoll(hook)
        return { hook, fetcher }
      },
      exercise: async ({ hook }) => {
        await act(async () => vi.advanceTimersByTimeAsync(1000))
        return hook
      },
      verify: async (hook, { fetcher }) => {
        await vi.waitFor(
          () => {
            expect(hook.result.current.updateHealth.build).toMatchObject({
              consecutiveFailures: 1,
              message: 'offline',
            })
            expect(hook.result.current.updateHealth.build?.lastConfirmedAt).toBeDefined()
            expect(fetcher).toHaveBeenCalledTimes(2)
          },
          { interval: 1, timeout: 500 },
        )
      },
    }),
  )
  it(
    'clears missed updates when the server confirms not modified',
    mint({
      setup: async () => {
        clock()
        const fetcher = updateFetch()
        const diagnostics = recordingSink()
        const hook = renderHook(() => usePanelSignals({ board, env, diagnostics }))
        await initialPoll(hook)
        await act(async () => vi.advanceTimersByTimeAsync(1000))
        await vi.waitUntil(
          () => hook.result.current.updateHealth.build?.consecutiveFailures === 1,
          { interval: 1, timeout: 500 },
        )
        return { hook, fetcher, diagnostics }
      },
      exercise: async ({ hook }) => {
        await act(async () => vi.advanceTimersByTimeAsync(1000))
        return hook
      },
      verify: async (hook, { fetcher, diagnostics }) => {
        await vi.waitFor(
          () => {
            expect(fetcher).toHaveBeenCalledTimes(3)
            expect(diagnostics.events).toContainEqual(
              expect.objectContaining({ kind: 'panel-fetch-response', status: 304 }),
            )
            expect(hook.result.current.schedules[0]?.inFlight).toBe(false)
            expect(hook.result.current.updateHealth.build).toBeUndefined()
          },
          { interval: 1, timeout: 500 },
        )
      },
    }),
  )
  it(
    'never overlaps a pending poll',
    mint({
      setup: () => {
        clock()
        const pending = pendingFetch()
        const diagnostics = recordingSink()
        const hook = renderHook(() => usePanelSignals({ board, env, diagnostics }))
        return { ...pending, hook }
      },
      exercise: async ({ hook }) => {
        await act(async () => vi.advanceTimersByTimeAsync(2000))
        return hook
      },
      verify: (_hook, { fetcher }) => expect(fetcher).toHaveBeenCalledTimes(1),
    }),
  )
  it(
    'aborts a pending request and stops polling on unmount',
    mint({
      setup: () => {
        clock()
        const pending = pendingFetch()
        const diagnostics = recordingSink()
        const hook = renderHook(() => usePanelSignals({ board, env, diagnostics }))
        return { ...pending, hook }
      },
      exercise: async ({ hook }) => {
        hook.unmount()
        await act(async () => vi.advanceTimersByTimeAsync(2000))
      },
      verify: (_result, { fetcher }) => {
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      },
    }),
  )
})
describe('accepted pipeline evidence', () => {
  it(
    'retains persisted presentation when GitHub returns older evidence',
    mint({
      setup: persistedFixture,
      exercise: ({ memory, diagnostics }) =>
        renderHook(() => usePanelSignals({ board, env, diagnostics, memory })),
      verify: async (hook, { accepted, diagnostics }) => {
        await waitFor(() => {
          expect(hook.result.current.rejectedPipelines.build).toEqual({ ...accepted, github: true })
          expect(hook.result.current.signals.build).toBeUndefined()
          expect(diagnostics.recordGithubConsistencyIncident).toHaveBeenCalledTimes(1)
        })
      },
    }),
  )
  it(
    'clears historical presentation when newer evidence arrives',
    mint({
      setup: async () => {
        clock()
        const world = persistedFixture()
        const hook = renderHook(() =>
          usePanelSignals({ board, env, diagnostics: world.diagnostics, memory: world.memory }),
        )
        await initialPoll(hook)
        return { ...world, hook }
      },
      exercise: async ({ hook }) => {
        await act(async () => vi.advanceTimersByTimeAsync(1000))
        return hook
      },
      verify: async (hook, { fetcher }) => {
        await vi.waitFor(
          () => {
            expect(fetcher).toHaveBeenCalledTimes(2)
            expect(hook.result.current.signals.build).toMatchObject({
              signal: { status: 'passed' },
            })
            expect(hook.result.current.rejectedPipelines.build).toBeUndefined()
          },
          { interval: 1, timeout: 500 },
        )
      },
    }),
  )
})
describe('pull-request cleanup', () => {
  it(
    'aborts component reads before they can fan out to build reads',
    mint({
      setup: () => {
        const diagnostics = recordingSink()
        const aborted: boolean[] = []
        const fetcher = vi.fn(
          (_path: string, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () => {
                aborted.push(true)
                reject(new DOMException('Aborted', 'AbortError'))
              })
            }),
        )
        vi.stubGlobal('fetch', fetcher)
        const hook = renderHook(() =>
          usePanelSignals({ board: pullRequestBoard, env, diagnostics }),
        )
        return { hook, fetcher, aborted }
      },
      exercise: ({ hook }) => hook.unmount(),
      verify: (_result, { fetcher, aborted }) => {
        expect(aborted).toHaveLength(2)
        expect(fetcher).toHaveBeenCalledTimes(2)
      },
    }),
  )
})
