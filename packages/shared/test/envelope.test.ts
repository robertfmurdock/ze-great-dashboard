import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { pipelineStatusPriority, pipelineStatusSchema, testCountSchema } from '../src/envelope.ts'

describe('pipeline signal activity', () => {
  const base = {
    type: 'pipeline-status' as const,
    status: 'running' as const,
    rawStatus: 'in_progress',
    name: 'Build',
  }

  for (const activity of [
    { kind: 'job' as const, name: 'build' },
    { kind: 'stage' as const, name: 'integration tests', parent: 'build' },
    { kind: 'step' as const, name: 'integration tests', parent: 'build' },
  ]) {
    test(
      `accepts normalized ${activity.kind} activity`,
      mint({
        setup: () => ({ signal: { ...base, activity } }),
        exercise: ({ signal }) => pipelineStatusSchema.safeParse(signal),
        verify: (result) => expect(result.success).toBe(true),
      }),
    )
  }

  for (const { name, activity } of [
    { name: 'an unknown kind', activity: { kind: 'task', name: 'build' } },
    { name: 'an empty name', activity: { kind: 'job', name: '' } },
  ]) {
    test(
      `rejects activity metadata with ${name}`,
      mint({
        setup: () => ({ signal: { ...base, activity } }),
        exercise: ({ signal }) => pipelineStatusSchema.safeParse(signal),
        verify: (result) => expect(result.success).toBe(false),
      }),
    )
  }

  test(
    'accepts warning as a normalized completed status',
    mint({
      setup: () => ({ signal: { ...base, status: 'warning' as const } }),
      exercise: ({ signal }) => pipelineStatusSchema.safeParse(signal),
      verify: (result) => expect(result.success).toBe(true),
    }),
  )

  test(
    'orders compact pipeline evidence from passed to failed',
    mint({
      setup: () => ({
        statuses: ['passed', 'cancelled', 'unknown', 'running', 'warning', 'failed'] as const,
      }),
      exercise: ({ statuses }) => statuses.map((status) => pipelineStatusPriority(status)),
      verify: (priorities) => expect(priorities).toEqual([0, 1, 2, 3, 4, 5]),
    }),
  )
})

describe('test-count signal states', () => {
  test(
    'requires a total only when a workflow reports test evidence',
    mint({
      setup: () => ({
        reported: { type: 'test-count' as const, status: 'reported' as const },
        pending: { type: 'test-count' as const, status: 'pending' as const },
      }),
      exercise: ({ reported, pending }) => ({
        reported: testCountSchema.safeParse(reported),
        pending: testCountSchema.safeParse(pending),
      }),
      verify: (result) => {
        expect(result.reported.success).toBe(false)
        expect(result.pending.success).toBe(true)
      },
    }),
  )
})
