import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect } from 'vitest'
import { pipelineStatusPriority, pipelineStatusSchema } from '../src/envelope.ts'

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
    mintTest(`accepts normalized ${activity.kind} activity`, {
      setup: () => ({ signal: { ...base, activity } }),
      exercise: ({ signal }) => pipelineStatusSchema.safeParse(signal),
      verify: (result) => expect(result.success).toBe(true),
    })
  }

  for (const { name, activity } of [
    { name: 'an unknown kind', activity: { kind: 'task', name: 'build' } },
    { name: 'an empty name', activity: { kind: 'job', name: '' } },
  ]) {
    mintTest(`rejects activity metadata with ${name}`, {
      setup: () => ({ signal: { ...base, activity } }),
      exercise: ({ signal }) => pipelineStatusSchema.safeParse(signal),
      verify: (result) => expect(result.success).toBe(false),
    })
  }

  mintTest('accepts warning as a normalized completed status', {
    setup: () => ({ signal: { ...base, status: 'warning' as const } }),
    exercise: ({ signal }) => pipelineStatusSchema.safeParse(signal),
    verify: (result) => expect(result.success).toBe(true),
  })

  mintTest('orders compact pipeline evidence from passed to failed', {
    setup: () => ({
      statuses: ['passed', 'cancelled', 'unknown', 'running', 'warning', 'failed'] as const,
    }),
    exercise: ({ statuses }) => statuses.map((status) => pipelineStatusPriority(status)),
    verify: (priorities) => expect(priorities).toEqual([0, 1, 2, 3, 4, 5]),
  })
})
