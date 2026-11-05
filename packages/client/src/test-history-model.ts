import type { TestHistory, TestHistorySample } from '@ze-great-dashboard/shared/browser'
import { classifyTestDirection } from './test-direction.ts'

const hourMillis = 60 * 60 * 1000
const dayMillis = 24 * hourMillis
export const testHistoryPolicy = {
  retentionMillis: 14 * dayMillis,
  retainedReadings: 32,
  refreshMillis: dayMillis,
  gapMillis: hourMillis,
  minimumAttemptMillis: hourMillis,
  retryDelaysMillis: [hourMillis, 6 * hourMillis, dayMillis],
} as const

export type TestRepairState = {
  lastConfirmedAt?: number
  lastCompleteAt?: number
  lastAttemptAt?: number
  nextAttemptAt?: number
  failures: number
  gapPending: boolean
  partial?: boolean
  hadSamples?: boolean
}
const emptyRepair: TestRepairState = { failures: 0, gapPending: false }

function readingKey(sample: TestHistorySample) {
  return JSON.stringify([sample.id, sample.attempt])
}
function compareReadings(left: TestHistorySample, right: TestHistorySample) {
  return (
    Date.parse(left.updatedAt) - Date.parse(right.updatedAt) ||
    left.id.localeCompare(right.id, 'en', { numeric: true }) ||
    left.attempt - right.attempt
  )
}

/** Live observations and historical inspections are readings of the same source. */
export function mergeTestReadings(
  existing: readonly TestHistorySample[],
  incoming: readonly TestHistorySample[],
  now: number,
) {
  const readings = new Map(existing.map((reading) => [readingKey(reading), reading]))
  for (const reading of incoming) {
    const previous = readings.get(readingKey(reading))
    // For the same source timestamp, prefer the latest inspection (including corrected totals).
    if (!previous || Date.parse(reading.updatedAt) >= Date.parse(previous.updatedAt))
      readings.set(readingKey(reading), reading)
  }
  return [...readings.values()]
    .filter((reading) => Date.parse(reading.updatedAt) >= now - testHistoryPolicy.retentionMillis)
    .sort(compareReadings)
    .slice(-testHistoryPolicy.retainedReadings)
}

export function projectTestReadings(
  readings: readonly TestHistorySample[],
  current: TestHistorySample,
  partial = false,
) {
  const anchor = readings.findIndex((reading) => readingKey(reading) === readingKey(current))
  if (anchor < 0) return undefined
  const direction = classifyTestDirection([...readings.slice(0, anchor), current])
  return direction && partial
    ? {
        ...direction,
        explanation: `${direction.explanation} Recent source-history inspection was incomplete.`,
      }
    : direction
}

export function confirmTestObservation(
  state: TestRepairState = emptyRepair,
  now: number,
): TestRepairState {
  return {
    ...state,
    lastConfirmedAt: now,
    gapPending:
      state.gapPending ||
      (state.lastConfirmedAt !== undefined &&
        now - state.lastConfirmedAt >= testHistoryPolicy.gapMillis),
  }
}

export function testRepairEligible(
  state: TestRepairState = emptyRepair,
  hasReadings: boolean,
  now: number,
) {
  return (
    now >= (state.nextAttemptAt ?? 0) &&
    (state.lastCompleteAt === undefined ||
      now - state.lastCompleteAt >= testHistoryPolicy.refreshMillis ||
      state.gapPending ||
      (state.hadSamples === true && !hasReadings))
  )
}

export function startTestRepair(
  state: TestRepairState = emptyRepair,
  now: number,
): TestRepairState {
  return {
    ...state,
    lastAttemptAt: now,
    nextAttemptAt: now + testHistoryPolicy.minimumAttemptMillis,
  }
}

export function completeTestRepair(
  state: TestRepairState = emptyRepair,
  result: TestHistory | undefined,
  hasReadings: boolean,
  now: number,
  retryAt = 0,
): TestRepairState {
  const updated = {
    ...state,
    hadSamples: hasReadings,
    partial: !result?.complete || result.samples.length < result.inspectedRuns,
  }
  if (result?.complete)
    return {
      ...updated,
      lastCompleteAt: now,
      failures: 0,
      gapPending: false,
      nextAttemptAt: now + testHistoryPolicy.minimumAttemptMillis,
    }
  const failures = state.failures + 1
  const delay =
    testHistoryPolicy.retryDelaysMillis[
      Math.min(failures - 1, testHistoryPolicy.retryDelaysMillis.length - 1)
    ] ?? testHistoryPolicy.refreshMillis
  return {
    ...updated,
    failures,
    nextAttemptAt: Math.max(now + delay, retryAt, result?.retryAt ? Date.parse(result.retryAt) : 0),
  }
}
