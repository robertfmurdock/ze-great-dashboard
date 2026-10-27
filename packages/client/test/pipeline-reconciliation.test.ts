import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { Envelope, PipelineStatus } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import {
  applyPipelinePresentation,
  type PipelineReconciliation,
  reconcilePipelineResponse,
} from '../src/pipeline-reconciliation.ts'

function envelope(
  options: {
    status?: PipelineStatus['status']
    sourceUpdatedAt?: string
    sourceRunId?: string
    durationMs?: number
    link?: string | null
  } = {},
): Extract<Envelope, { state: 'ok' }> {
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
  describe('response ordering', () => {
    test(
      'rejects an older response while retaining its evidence for the caller to report',
      mint({
        setup: () => ({
          envelope: envelope({
            status: 'passed',
            sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
            link: 'https://github.test/runs/1',
          }),
          accepted: {
            sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
            status: 'failed' as const,
            link: 'https://github.test/runs/2',
          },
        }),
        exercise: ({ envelope, accepted }) => reconcilePipelineResponse({ envelope, accepted }),
        verify: (result) => {
          expect(result).toMatchObject({
            kind: 'rejected',
            envelope: {
              link: 'https://github.test/runs/1',
              signal: { status: 'passed', sourceUpdatedAt: '2026-08-28T11:00:00.000Z' },
            },
            signal: { status: 'passed', sourceUpdatedAt: '2026-08-28T11:00:00.000Z' },
          })
        },
      }),
    )

    for (const { name, sourceUpdatedAt } of [
      { name: 'equal timestamps', sourceUpdatedAt: '2026-08-28T11:30:00.000Z' },
      { name: 'no source timestamp', sourceUpdatedAt: undefined },
    ] as const) {
      test(
        `accepts ${name} because ordering cannot reject it`,
        mint({
          setup: () => ({
            envelope: envelope({ sourceUpdatedAt }),
            accepted: {
              sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
              status: 'failed' as const,
              link: 'https://github.test/runs/2',
            },
          }),
          exercise: ({ envelope, accepted }) => reconcilePipelineResponse({ envelope, accepted }),
          verify: (result) => expect(result.kind).toBe('accepted'),
        }),
      )
    }
  })

  describe('presentation', () => {
    test(
      'projects a rejected GitHub result as historical evidence',
      mint({
        setup: () => {
          const accepted = {
            sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
            status: 'failed' as const,
            link: 'https://github.com/example/repo/actions/runs/2',
          }
          const stale = envelope({
            sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
            link: 'https://github.com/example/repo/actions/runs/1',
          })
          return {
            accepted,
            reconciliation: {
              kind: 'rejected',
              envelope: stale,
              signal: {
                type: 'pipeline-status',
                status: 'passed',
                rawStatus: 'success',
                name: 'Build',
                sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
              },
            } satisfies PipelineReconciliation,
          }
        },
        exercise: ({ reconciliation, accepted }) =>
          applyPipelinePresentation({ current: undefined, reconciliation, accepted }),
        verify: (presentation, { accepted }) => {
          expect(presentation).toEqual({
            envelope: undefined,
            rejected: { ...accepted, github: true },
          })
        },
      }),
    )

    test(
      'clears historical disclosure when a current result is accepted',
      mint({
        setup: () => {
          const accepted = {
            sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
            status: 'failed' as const,
            link: 'https://github.com/example/repo/actions/runs/2',
          }
          const current = envelope({ sourceUpdatedAt: '2026-08-28T11:45:00.000Z' })
          return {
            accepted,
            current,
            reconciliation: {
              kind: 'accepted',
              envelope: current,
              signal: {
                type: 'pipeline-status',
                status: 'passed',
                rawStatus: 'success',
                name: 'Build',
                sourceUpdatedAt: '2026-08-28T11:45:00.000Z',
              },
              accepted: {
                sourceUpdatedAt: '2026-08-28T11:45:00.000Z',
                status: 'passed',
                link: 'https://github.test/runs/2',
              },
            } satisfies PipelineReconciliation,
          }
        },
        exercise: ({ reconciliation, accepted }) =>
          applyPipelinePresentation({ current: undefined, reconciliation, accepted }),
        verify: (presentation, { current }) => expect(presentation).toEqual({ envelope: current }),
      }),
    )
  })

  describe('duration evidence', () => {
    for (const status of ['failed', 'warning', 'cancelled', 'unknown'] as const) {
      test(
        `returns a ${status} completed run as a sample`,
        mint({
          setup: () => ({
            envelope: envelope({
              status,
              sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
              sourceRunId: '42',
              durationMs: 120_000,
            }),
          }),
          exercise: ({ envelope }) => reconcilePipelineResponse({ envelope }),
          verify: (completed) => {
            expect(completed).toMatchObject({
              kind: 'accepted',
              durationSample: {
                link: 'https://github.test/runs/2',
                sourceRunId: '42',
                durationMs: 120_000,
              },
            })
          },
        }),
      )
    }

    test(
      'overlays estimates only on running runs',
      mint({
        setup: () => ({
          envelope: envelope({ status: 'running', sourceUpdatedAt: '2026-08-28T11:30:00.000Z' }),
          estimatedDurationMs: 120_000,
        }),
        exercise: ({ envelope, estimatedDurationMs }) =>
          reconcilePipelineResponse({ envelope, estimatedDurationMs }),
        verify: (running) => {
          expect(running).toMatchObject({
            kind: 'accepted',
            envelope: { signal: { status: 'running', estimatedDurationMs: 120_000 } },
            durationSample: undefined,
          })
        },
      }),
    )
  })
})
