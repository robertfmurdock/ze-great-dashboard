import { mint } from '@continuous-excellence/testmints-js/vitest'
import { renderHook } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useRunningTiming } from '../src/running-timing.ts'

afterEach(() => vi.useRealTimers())
describe('active-run clock', () => {
  test(
    'advances local elapsed progress without an upstream poll',
    mint({
      setup: () => {
        vi.useFakeTimers()
        const startedAt = '2026-08-18T12:00:00.000Z'
        const elapsedMs = 120000
        const estimatedDurationMs = 300000
        vi.setSystemTime(new Date(Date.parse(startedAt) + elapsedMs))
        const hook = renderHook(() => useRunningTiming(startedAt, estimatedDurationMs))
        return {
          hook,
          initial: hook.result.current,
          elapsedMs,
          estimatedDurationMs,
          advanceMs: 1000,
        }
      },
      exercise: ({ hook, advanceMs }) => {
        act(() => vi.advanceTimersByTime(advanceMs))
        return hook.result.current
      },
      verify: (timing, { initial, elapsedMs, estimatedDurationMs, advanceMs }) => {
        expect(initial).toMatchObject({
          elapsedMs,
          hasEstimate: true,
          overdue: false,
          progress: elapsedMs / estimatedDurationMs,
        })
        expect(timing).toMatchObject({
          elapsedMs: elapsedMs + advanceMs,
          estimatedDurationMs,
          hasEstimate: true,
          overdue: false,
          progress: (elapsedMs + advanceMs) / estimatedDurationMs,
        })
      },
    }),
  )
  test(
    'caps progress while keeping an overdue run active',
    mint({
      setup: () => {
        vi.useFakeTimers()
        const startedAt = '2026-08-18T12:00:00.000Z'
        const elapsedMs = 300000
        vi.setSystemTime(new Date(Date.parse(startedAt) + elapsedMs))
        return { startedAt, elapsedMs, estimatedDurationMs: 60000 }
      },
      exercise: ({ startedAt, estimatedDurationMs }) =>
        renderHook(() => useRunningTiming(startedAt, estimatedDurationMs)),
      verify: (hook, { elapsedMs }) =>
        expect(hook.result.current).toMatchObject({
          elapsedMs,
          hasEstimate: true,
          overdue: true,
          progress: 1,
        }),
    }),
  )
})
