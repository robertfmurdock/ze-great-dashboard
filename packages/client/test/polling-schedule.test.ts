import type { Envelope, PollingSettings } from '@ze-great-dashboard/shared'
import { describe, expect, it } from 'vitest'
import { nextPollDelayMillis } from '../src/polling-schedule.ts'

const settings: PollingSettings = {
  refreshMillis: 60_000,
  runningRefreshMillis: 15_000,
  runningCompletionRefreshMillis: 5_000,
  runningCompletionWindowMillis: 120_000,
}
const estimateAt = Date.parse('2026-08-26T12:10:00.000Z')

function running(overrides: Record<string, unknown> = {}): Envelope {
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
    },
  }
}

describe('nextPollDelayMillis', () => {
  it('uses normal cadence for no signal, errors, and completed signals', () => {
    expect(nextPollDelayMillis(undefined, estimateAt, settings)).toBe(60_000)
    expect(nextPollDelayMillis(running({ status: 'passed' }), estimateAt, settings)).toBe(60_000)
  })

  it('uses running cadence without an estimate', () => {
    expect(
      nextPollDelayMillis(
        running({ runStartedAt: undefined, estimatedDurationMs: undefined }),
        estimateAt,
        settings,
      ),
    ).toBe(15_000)
  })

  it('aligns a pre-estimate check and then enters a bounded completion burst', () => {
    expect(nextPollDelayMillis(running(), estimateAt - 20_000, settings)).toBe(15_000)
    expect(nextPollDelayMillis(running(), estimateAt - 5_000, settings)).toBe(5_000)
    expect(nextPollDelayMillis(running(), estimateAt, settings)).toBe(5_000)
    expect(nextPollDelayMillis(running(), estimateAt + 120_000, settings)).toBe(15_000)
  })

  it('starts the burst immediately when the estimate is already past', () => {
    expect(nextPollDelayMillis(running(), estimateAt + 30_000, settings)).toBe(5_000)
  })
})
