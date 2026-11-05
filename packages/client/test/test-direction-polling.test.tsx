import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, renderHook, screen } from '@testing-library/react'
import type { Board, Envelope, Panel, TestCount } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { DiagnosticEventInput } from '../src/diagnostics.ts'
import { BrowserPanelMemory } from '../src/panel-memory.ts'
import { PanelRenderer } from '../src/panel-registry.tsx'
import type { TestDirection } from '../src/test-direction.ts'
import { usePanelSignals } from '../src/usePanelSignals.ts'
import { env } from './client-test-fixture.tsx'

const cases: {
  name: string
  panel: Panel
  signal: (tests: ReturnType<typeof counts>) => unknown
}[] = [
  {
    name: 'standalone tests',
    panel: { id: 'tests', type: 'test-count', refresh: '1s' as Panel['refresh'] },
    signal: (tests) => tests,
  },
  {
    name: 'tests in a failed pipeline',
    panel: { id: 'build', type: 'pipeline-status', refresh: '1s' as Panel['refresh'] },
    signal: (tests) => ({
      type: 'pipeline-status',
      name: 'CI',
      rawStatus: 'failure',
      status: 'failed',
      sourceRunId: tests.run.id,
      sourceUpdatedAt: tests.run.updatedAt,
      testResults: { state: 'ok', observedAt: '2026-11-04T12:00:00Z', signal: tests },
    }),
  },
]

function response(panel: Panel, signal: unknown): Envelope {
  return { panelId: panel.id, state: 'ok', observedAt: '2026-11-04T12:00:00Z', link: null, signal }
}
function counts(id: string, total: number, updatedAt: string) {
  return {
    type: 'test-count',
    status: 'reported',
    total,
    run: { id, attempt: 1, updatedAt },
  } satisfies TestCount
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('test direction through panel polling', () => {
  for (const scenario of cases) {
    test(
      `${scenario.name}: repeated polls preserve the comparison without re-emitting rendered evidence`,
      mint({
        setup: async () => {
          vi.useFakeTimers()
          vi.setSystemTime(new Date('2026-11-04T12:00:00Z'))
          const memory = new BrowserPanelMemory({ getItem: () => null, setItem: () => {} })
          const earlier = counts('1', 100, '2026-11-04T10:00:00Z')
          const current = counts('2', 120, '2026-11-04T11:00:00Z')
          memory.observeTests(
            env.board,
            scenario.panel,
            response(scenario.panel, scenario.signal(earlier)),
          )
          const envelope = response(scenario.panel, scenario.signal(current))
          const fetcher = vi.fn(async () => Response.json(envelope))
          vi.stubGlobal('fetch', fetcher)
          const events: DiagnosticEventInput[] = []
          const board = { panels: [scenario.panel] } satisfies Board
          const diagnostics = {
            record: (event: DiagnosticEventInput) => {
              events.push(event)
            },
            recordGithubConsistencyIncident: vi.fn(),
          }
          const hook = renderHook(() => usePanelSignals({ board, env, diagnostics, memory }))
          await vi.waitUntil(() => hook.result.current.schedules[0]?.inFlight === false, {
            interval: 1,
            timeout: 500,
          })
          fetcher.mockClear()
          events.length = 0
          return { hook, earlier, current, envelope, fetcher, panel: scenario.panel, events }
        },
        exercise: async ({ hook }) => {
          // Repeated polls are the behavior under test; initial loading is already settled.
          await act(async () => {
            await vi.advanceTimersByTimeAsync(2000)
          })
          return hook
        },
        verify: async (hook, { panel, envelope, fetcher, events, earlier, current }) => {
          await vi.waitFor(
            () => {
              const result = hook.result.current
              expect(fetcher).toHaveBeenCalledTimes(2)
              const delta = current.total - earlier.total
              const totals = [earlier.total, current.total]
              expect(result.signals[panel.id]).toEqual(envelope)
              expect(result.testDirections[panel.id]).toMatchObject({
                mode: 'jump',
                delta,
                totals,
              })
              const rendered = events.filter((event) => event.kind === 'panel-rendered')
              expect(rendered).toHaveLength(0)
            },
            { interval: 1, timeout: 500 },
          )
        },
      }),
    )
  }
})

describe('test direction panel composition', () => {
  for (const scenario of cases)
    test(
      `${scenario.name}: forwards the supplied direction to its test summary`,
      mint({
        setup: () => {
          const tests = counts('1', 137, '2026-11-04T11:00:00Z')
          const direction: TestDirection = {
            mode: 'change',
            symbol: '↑',
            delta: 7,
            emphasized: false,
            totals: [tests.total - 7, tests.total],
            explanation: 'Seven more tests than the previous observed run.',
          }
          return {
            panel: scenario.panel,
            envelope: response(scenario.panel, scenario.signal(tests)),
            direction,
            tests,
          }
        },
        exercise: ({ panel, envelope, direction }) =>
          render(<PanelRenderer panel={panel} envelope={envelope} testDirection={direction} />),
        verify: (_, { tests, direction }) =>
          expect(
            screen.getByRole('button', { name: `${tests.total} tests` }).textContent,
          ).toContain(`${direction.symbol} +${direction.delta}`),
      }),
    )
})
