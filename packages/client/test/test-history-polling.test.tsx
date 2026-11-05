import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { renderHook } from '@testing-library/react'
import { type Panel, type TestHistory, testHistoryHeader } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { describe, expect, test, vi } from 'vitest'
import type { DiagnosticEventInput } from '../src/diagnostics.ts'
import { BrowserPanelMemory } from '../src/panel-memory.ts'
import { usePanelSignals } from '../src/usePanelSignals.ts'
import { env } from './client-test-fixture.tsx'

const cases = [
  {
    name: 'standalone',
    panel: { id: 'tests', type: 'test-count', refresh: '1s' as Panel['refresh'] },
    signal: (tests: ReturnType<typeof currentTests>) => tests,
  },
  {
    name: 'embedded',
    panel: { id: 'build', type: 'pipeline-status', refresh: '1s' as Panel['refresh'] },
    signal: (tests: ReturnType<typeof currentTests>) => ({
      type: 'pipeline-status',
      name: 'CI',
      rawStatus: 'failure',
      status: 'failed',
      sourceRunId: tests.run.id,
      sourceUpdatedAt: tests.run.updatedAt,
      testResults: { state: 'ok', observedAt: tests.run.updatedAt, signal: tests },
    }),
  },
] as const
function currentTests() {
  return {
    type: 'test-count',
    status: 'reported',
    total: 120,
    run: { id: '3', attempt: 1, updatedAt: '2026-11-04T12:00:00Z' },
  } as const
}
async function pollingFixture(scope: ResourceScope, scenario: (typeof cases)[number]) {
  await scope.using(
    'polling clock',
    () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-11-05T00:00:00Z'))
    },
    () => vi.useRealTimers(),
  )
  const tests = currentTests()
  const envelope = {
    panelId: scenario.panel.id,
    state: 'ok',
    observedAt: tests.run.updatedAt,
    link: null,
    signal: scenario.signal(tests),
  }
  const history: TestHistory = {
    inspectedAt: new Date().toISOString(),
    inspectedRuns: 2,
    complete: true,
    samples: [
      { id: '1', attempt: 1, updatedAt: '2026-11-04T10:00:00Z', total: 100 },
      { id: '2', attempt: 1, updatedAt: '2026-11-04T11:00:00Z', total: 110 },
    ],
  }
  let release: (response: Response) => void = () => {}
  const historyResponse = new Promise<Response>((resolve) => {
    release = resolve
  })
  const fetcher = await scope.using(
    'panel fetch',
    () => {
      const fetcher = vi.fn<typeof fetch>(async (input) =>
        String(input).endsWith('/test-history')
          ? historyResponse
          : Response.json(envelope, { headers: { [testHistoryHeader]: 'supported' } }),
      )
      vi.stubGlobal('fetch', fetcher)
      return fetcher
    },
    () => vi.unstubAllGlobals(),
  )
  let finished: () => void = () => {}
  const completion = new Promise<void>((resolve) => {
    finished = resolve
  })
  const events: DiagnosticEventInput[] = []
  const diagnostics = {
    record: (event: DiagnosticEventInput) => {
      events.push(event)
      if (event.kind === 'test-history-repair') finished()
    },
    recordGithubConsistencyIncident: vi.fn(),
  }
  const memory = new BrowserPanelMemory({ getItem: () => null, setItem: () => {} })
  const board = { panels: [scenario.panel] }
  const hook = await scope.using(
    'panel polling lifecycle',
    () => renderHook(() => usePanelSignals({ board, env, diagnostics, memory })),
    (hook) => hook.unmount(),
  )
  await act(async () => {})
  return {
    hook,
    fetcher,
    envelope,
    history,
    release,
    completion,
    events,
    panel: scenario.panel,
    tests,
  }
}

describe('current polling remains authoritative during repair', () => {
  for (const scenario of cases) {
    test(
      `${scenario.name}: normal polling continues while history is pending`,
      mint({
        setup: ({ scope }) => pollingFixture(scope, scenario),
        exercise: async ({ hook }) => {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(1000)
          })
          return hook.result.current
        },
        verify: (result, { fetcher, envelope, panel, tests }) => {
          const currentCalls = fetcher.mock.calls.filter(
            ([input]) => !String(input).endsWith('/test-history'),
          )
          const historyCalls = fetcher.mock.calls.filter(([input]) =>
            String(input).endsWith('/test-history'),
          )
          expect(currentCalls).toHaveLength(2)
          expect(historyCalls).toHaveLength(1)
          expect(result.signals[panel.id]).toEqual(envelope)
          expect(result.testDirections[panel.id]?.totals).toEqual([tests.total])
          expect(result.updateHealth[panel.id]).toBeUndefined()
        },
      }),
    )
    test(
      `${scenario.name}: completing history enriches the trend without replacing current evidence`,
      mint({
        setup: ({ scope }) => pollingFixture(scope, scenario),
        exercise: async ({ hook, release, history, completion }) => {
          await act(async () => {
            release(Response.json(history))
            await completion
          })
          return hook.result.current
        },
        verify: (result, { envelope, history, panel, tests, events }) => {
          expect(result.signals[panel.id]).toEqual(envelope)
          expect(result.testDirections[panel.id]?.totals).toEqual([
            ...history.samples.map((sample) => sample.total),
            tests.total,
          ])
          expect(result.updateHealth[panel.id]).toBeUndefined()
          expect(events).toContainEqual(
            expect.objectContaining({
              kind: 'test-history-repair',
              outcome: 'complete',
              samples: history.samples.length,
            }),
          )
          const rendered = events.filter((event) => event.kind === 'panel-rendered')
          expect(rendered.at(-1)).toMatchObject({
            rendered: {
              testDirection: {
                totals: [...history.samples.map((sample) => sample.total), tests.total],
              },
            },
          })
        },
      }),
    )
  }
  test(
    'repair failure leaves normal update health alone',
    mint({
      setup: ({ scope }) => pollingFixture(scope, cases[0]),
      exercise: async ({ hook, release, completion }) => {
        await act(async () => {
          release(new Response(null, { status: 503 }))
          await completion
        })
        return hook.result.current
      },
      verify: (result, { panel, envelope, events }) => {
        expect(result.signals[panel.id]).toEqual(envelope)
        expect(result.updateHealth[panel.id]).toBeUndefined()
        expect(events).toContainEqual(
          expect.objectContaining({ kind: 'test-history-repair', outcome: 'failed' }),
        )
      },
    }),
  )
})
