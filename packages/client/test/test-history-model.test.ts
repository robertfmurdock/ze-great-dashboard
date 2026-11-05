import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { TestHistory, TestHistorySample } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import {
  completeTestRepair,
  confirmTestObservation,
  mergeTestReadings,
  projectTestReadings,
  startTestRepair,
  type TestRepairState,
  testRepairEligible,
} from '../src/test-history-model.ts'

const now = Date.parse('2026-11-05T00:00:00Z')
const hour = 3600000
const emptyInspection: TestHistory = {
  inspectedAt: new Date(now).toISOString(),
  inspectedRuns: 0,
  complete: true,
  samples: [],
}

describe('pure repair eligibility', () => {
  test(
    'an unseeded cache is immediately eligible',
    mint({
      setup: () => ({ state: undefined, hasReadings: false, now }),
      exercise: ({ state, hasReadings, now }) => testRepairEligible(state, hasReadings, now),
      verify: (due) => expect(due).toBe(true),
    }),
  )
  const cadenceCases = [
    { name: 'healthy empty inspection before a day', elapsed: 24 * hour - 1, due: false },
    { name: 'daily boundary', elapsed: 24 * hour, due: true },
  ]
  for (const scenario of cadenceCases)
    test(
      scenario.name,
      mint({
        setup: () => ({
          state: completeTestRepair(undefined, emptyInspection, false, now),
          at: now + scenario.elapsed,
          due: scenario.due,
        }),
        exercise: ({ state, at }) => testRepairEligible(state, false, at),
        verify: (due, expected) => expect(due).toBe(expected.due),
      }),
    )
  const throttleCases = [
    {
      name: 'minimum attempt throttle blocks otherwise eligible history just before one hour',
      elapsed: hour - 1,
      due: false,
    },
    {
      name: 'minimum attempt throttle releases otherwise eligible history at one hour',
      elapsed: hour,
      due: true,
    },
  ]
  for (const scenario of throttleCases)
    test(
      scenario.name,
      mint({
        setup: () => ({
          state: startTestRepair(undefined, now),
          at: now + scenario.elapsed,
          due: scenario.due,
        }),
        exercise: ({ state, at }) => testRepairEligible(state, false, at),
        verify: (due, expected) => expect(due).toBe(expected.due),
      }),
    )
  test(
    'an hour-long observation gap requests repair before daily refresh',
    mint({
      setup: () => {
        const completed = completeTestRepair(undefined, emptyInspection, false, now)
        const confirmed = confirmTestObservation(completed, now)
        const at = now + hour
        return { state: confirmTestObservation(confirmed, at), at }
      },
      exercise: ({ state, at }) => testRepairEligible(state, false, at),
      verify: (due) => expect(due).toBe(true),
    }),
  )
  test(
    'regular current observations do not invent a gap from old build timestamps',
    mint({
      setup: () => {
        let state = completeTestRepair(undefined, emptyInspection, true, now)
        for (let i = 0; i < 4; i++) state = confirmTestObservation(state, now + (i * hour) / 2)
        return { state, at: now + 2 * hour }
      },
      exercise: ({ state, at }) => testRepairEligible(state, true, at),
      verify: (due) => expect(due).toBe(false),
    }),
  )
  test(
    'expiry of cached readings can trigger repair before daily refresh',
    mint({
      setup: () => {
        const sample = {
          id: '1',
          attempt: 1,
          total: 100,
          updatedAt: new Date(now - 14 * 86400000 + hour).toISOString(),
        }
        const state = completeTestRepair(
          undefined,
          { ...emptyInspection, inspectedRuns: 1, samples: [sample] },
          true,
          now,
        )
        const at = now + 2 * hour
        return { state, hasReadings: mergeTestReadings([sample], [], at).length > 0, at }
      },
      exercise: ({ state, hasReadings, at }) => testRepairEligible(state, hasReadings, at),
      verify: (due) => expect(due).toBe(true),
    }),
  )
})

describe('pure repair transitions', () => {
  test(
    'starting an attempt enforces the minimum interval',
    mint({
      setup: () => ({ now }),
      exercise: ({ now }) => startTestRepair(undefined, now),
      verify: (state, { now }) =>
        expect(state).toMatchObject({ lastAttemptAt: now, nextAttemptAt: now + hour }),
    }),
  )
  const retryCases = [
    { failures: 1, delay: hour },
    { failures: 2, delay: 6 * hour },
    { failures: 3, delay: 24 * hour },
    { failures: 4, delay: 24 * hour },
  ]
  for (const scenario of retryCases)
    test(
      `failure ${scenario.failures} backs off ${scenario.delay}ms`,
      mint({
        setup: () => ({
          state: { failures: scenario.failures - 1, gapPending: true } satisfies TestRepairState,
          expectedFailures: scenario.failures,
          nextAt: now + scenario.delay,
        }),
        exercise: ({ state }) => completeTestRepair(state, undefined, false, now),
        verify: (state, { expectedFailures, nextAt }) =>
          expect(state).toMatchObject({
            failures: expectedFailures,
            nextAttemptAt: nextAt,
            partial: true,
            gapPending: true,
          }),
      }),
    )
  test(
    'longer source retry guidance takes precedence',
    mint({
      setup: () => ({
        result: {
          ...emptyInspection,
          complete: false,
          retryAt: new Date(now + 48 * hour).toISOString(),
        },
      }),
      exercise: ({ result }) => completeTestRepair(undefined, result, false, now),
      verify: (state, { result }) => expect(state.nextAttemptAt).toBe(Date.parse(result.retryAt)),
    }),
  )
  test(
    'completed inspection resets backoff and pending gap recovery',
    mint({
      setup: () => ({
        state: { failures: 3, gapPending: true } satisfies TestRepairState,
        result: emptyInspection,
      }),
      exercise: ({ state, result }) => completeTestRepair(state, result, false, now),
      verify: (state) =>
        expect(state).toMatchObject({
          lastCompleteAt: now,
          failures: 0,
          gapPending: false,
          partial: false,
        }),
    }),
  )
})

function reading(id: number, total: number, attempt = 1): TestHistorySample {
  return {
    id: String(id),
    total,
    attempt,
    updatedAt: new Date(Date.UTC(2026, 10, 4, id)).toISOString(),
  }
}

describe('source-reading merge and projection', () => {
  test(
    'merges readings into chronological source order',
    mint({
      setup: () => {
        const current = reading(3, 120)
        const earlier = reading(1, 100)
        const middle = reading(2, 110)
        const newer = reading(4, 130)
        return {
          existing: [current],
          incoming: [middle, earlier, newer],
          expected: [earlier, middle, current, newer],
        }
      },
      exercise: ({ existing, incoming }) => mergeTestReadings(existing, incoming, now),
      verify: (readings, { expected }) => expect(readings).toEqual(expected),
    }),
  )
  test(
    'stale readings cannot overwrite newer evidence for the same attempt',
    mint({
      setup: () => {
        const current = reading(3, 125)
        const older = { ...current, total: 100, updatedAt: reading(2, 100).updatedAt }
        const rerun = { ...current, attempt: 2 }
        return { existing: [current], incoming: [older, rerun], expected: [current, rerun] }
      },
      exercise: ({ existing, incoming }) => mergeTestReadings(existing, incoming, now),
      verify: (readings, { expected }) => expect(readings).toEqual(expected),
    }),
  )
  test(
    'duplicate run attempts replace one reading rather than adding a history point',
    mint({
      setup: () => {
        const original = reading(1, 100)
        const corrected = { ...original, total: 101 }
        return { existing: [original], incoming: [corrected] }
      },
      exercise: ({ existing, incoming }) => mergeTestReadings(existing, incoming, now),
      verify: (readings, { incoming }) => {
        expect(readings).toHaveLength(1)
        expect(readings[0]).toEqual(incoming[0])
      },
    }),
  )
  test(
    'projection excludes a newer cached run while retaining the displayed count',
    mint({
      setup: () => {
        const previous = [reading(1, 100), reading(2, 110)]
        const current = reading(3, 120)
        return {
          readings: [...previous, current, reading(4, 130)],
          current,
          expected: [...previous, current].map((sample) => sample.total),
        }
      },
      exercise: ({ readings, current }) => projectTestReadings(readings, current),
      verify: (direction, { expected }) => expect(direction?.totals).toEqual(expected),
    }),
  )
  test(
    'partial inspection is disclosed without erasing valid readings',
    mint({
      setup: () => {
        const current = reading(1, 100)
        return { readings: [current], current, partial: true }
      },
      exercise: ({ readings, current, partial }) => projectTestReadings(readings, current, partial),
      verify: (direction, { current }) => {
        expect(direction?.totals).toEqual([current.total])
        expect(direction?.explanation).toContain('inspection was incomplete')
      },
    }),
  )
})
