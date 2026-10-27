import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { Envelope, PipelineStatus, PollingSettings } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { nextPollDelayMillis } from '../src/polling-schedule.ts'

const settings: PollingSettings = {
  refreshMillis: 60_000,
  runningRefreshMillis: 15_000,
  runningCompletionRefreshMillis: 5_000,
  runningCompletionWindowMillis: 120_000,
}
const estimateAt = Date.parse('2026-08-26T12:10:00.000Z')

function running(overrides: Partial<PipelineStatus> = {}): Envelope {
  return {
    panelId: 'build',
    state: 'ok',
    observedAt: '2026-08-26T12:00:00.000Z',
    link: 'https://example.com/build',
    signal: {
      type: 'pipeline-status',
      status: 'running',
      rawStatus: 'in_progress',
      name: 'build',
      runStartedAt: '2026-08-26T12:00:00.000Z',
      estimatedDurationMs: 600_000,
      ...overrides,
    } satisfies PipelineStatus,
  }
}

function errored(): Envelope {
  return {
    panelId: 'build',
    state: 'error',
    observedAt: '2026-08-26T12:00:00.000Z',
    link: 'https://example.com/build',
    error: { kind: 'upstream-error', message: 'Source unavailable' },
  }
}

const completionCadences = [
  { name: 'before the estimate', nowMillis: estimateAt - 20_000, expectedDelayMillis: 15_000 },
  { name: 'approaching the estimate', nowMillis: estimateAt - 5_000, expectedDelayMillis: 5_000 },
  { name: 'at the estimate', nowMillis: estimateAt, expectedDelayMillis: 5_000 },
  {
    name: 'after the completion window',
    nowMillis: estimateAt + 120_000,
    expectedDelayMillis: 15_000,
  },
] as const

describe('nextPollDelayMillis', () => {
  describe('normal cadence', () => {
    test(
      'uses normal cadence when no signal is available',
      mint({
        setup: () => ({ envelope: undefined }),
        exercise: ({ envelope }) => nextPollDelayMillis(envelope, estimateAt, settings),
        verify: (delayMillis) => expect(delayMillis).toBe(60_000),
      }),
    )

    test(
      'uses normal cadence after an upstream error',
      mint({
        setup: () => ({ envelope: errored() }),
        exercise: ({ envelope }) => nextPollDelayMillis(envelope, estimateAt, settings),
        verify: (delayMillis) => expect(delayMillis).toBe(60_000),
      }),
    )

    test(
      'uses normal cadence for a completed pipeline',
      mint({
        setup: () => ({ envelope: running({ status: 'passed' }) }),
        exercise: ({ envelope }) => nextPollDelayMillis(envelope, estimateAt, settings),
        verify: (delayMillis) => expect(delayMillis).toBe(60_000),
      }),
    )
  })

  describe('active pipelines without an estimate', () => {
    test(
      'uses running cadence',
      mint({
        setup: () => ({
          envelope: running({ runStartedAt: undefined, estimatedDurationMs: undefined }),
        }),
        exercise: ({ envelope }) => nextPollDelayMillis(envelope, estimateAt, settings),
        verify: (delayMillis) => expect(delayMillis).toBe(15_000),
      }),
    )
  })

  describe('estimated completion window', () => {
    for (const { name, nowMillis, expectedDelayMillis } of completionCadences) {
      test(
        `uses the expected cadence ${name}`,
        mint({
          setup: () => ({ envelope: running(), nowMillis }),
          exercise: ({ envelope, nowMillis }) => nextPollDelayMillis(envelope, nowMillis, settings),
          verify: (delayMillis) => expect(delayMillis).toBe(expectedDelayMillis),
        }),
      )
    }

    test(
      'starts the completion burst immediately when the estimate is already past',
      mint({
        setup: () => ({ envelope: running(), nowMillis: estimateAt + 30_000 }),
        exercise: ({ envelope, nowMillis }) => nextPollDelayMillis(envelope, nowMillis, settings),
        verify: (delayMillis) => expect(delayMillis).toBe(5_000),
      }),
    )
  })
})
