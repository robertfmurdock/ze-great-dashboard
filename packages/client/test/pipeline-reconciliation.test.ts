import type { Envelope } from '@ze-great-dashboard/shared'
import { describe, expect, it } from 'vitest'
import { reconcilePipelineResponse } from '../src/pipeline-reconciliation.ts'

function envelope(
  options: {
    status?: 'passed' | 'failed' | 'warning' | 'running'
    sourceUpdatedAt?: string
    sourceRunId?: string
    durationMs?: number
    link?: string | null
  } = {},
): Envelope {
  return {
    panelId: 'build',
    state: 'ok',
    observedAt: '2026-08-28T12:00:00.000Z',
    link: options.link === undefined ? 'https://github.test/runs/2' : options.link,
    signal: {
      type: 'pipeline-status',
      status: options.status ?? 'passed',
      rawStatus: options.status ?? 'success',
      name: 'Build',
      ...(options.sourceUpdatedAt ? { sourceUpdatedAt: options.sourceUpdatedAt } : {}),
      ...(options.sourceRunId ? { sourceRunId: options.sourceRunId } : {}),
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    },
  }
}

describe('pipeline reconciliation', () => {
  it('rejects an older response while retaining its evidence for the caller to report', () => {
    const result = reconcilePipelineResponse({
      envelope: envelope({
        status: 'passed',
        sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
        link: 'https://github.test/runs/1',
      }),
      accepted: {
        sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
        status: 'failed',
        link: 'https://github.test/runs/2',
      },
    })

    expect(result).toMatchObject({ kind: 'rejected', signal: { status: 'passed' } })
  })

  it.each([
    ['equal timestamps', '2026-08-28T11:30:00.000Z'],
    ['no source timestamp', undefined],
  ])('accepts %s because ordering cannot reject it', (_label, sourceUpdatedAt) => {
    const result = reconcilePipelineResponse({
      envelope: envelope({ sourceUpdatedAt }),
      accepted: {
        sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
        status: 'failed',
        link: 'https://github.test/runs/2',
      },
    })

    expect(result.kind).toBe('accepted')
  })

  it.each(['failed', 'warning', 'cancelled', 'unknown'] as const)(
    'returns a %s completed run as a sample',
    (status) => {
      const completed = reconcilePipelineResponse({
        envelope: envelope({
          status,
          sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
          sourceRunId: '42',
          durationMs: 120_000,
        }),
      })
      expect(completed).toMatchObject({
        kind: 'accepted',
        durationSample: {
          link: 'https://github.test/runs/2',
          sourceRunId: '42',
          durationMs: 120_000,
        },
      })
    },
  )

  it('overlays estimates only on running runs', () => {
    const running = reconcilePipelineResponse({
      envelope: envelope({ status: 'running', sourceUpdatedAt: '2026-08-28T11:30:00.000Z' }),
      estimatedDurationMs: 120_000,
    })
    expect(running).toMatchObject({
      kind: 'accepted',
      envelope: { signal: { status: 'running', estimatedDurationMs: 120_000 } },
      durationSample: undefined,
    })
  })
})
