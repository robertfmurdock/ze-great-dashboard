import { describe, expect, it } from 'vitest'
import {
  type PipelineStatus,
  pipelineStatusPriority,
  pipelineStatusSchema,
} from '../src/envelope.ts'

describe('pipeline signal activity', () => {
  const base = {
    type: 'pipeline-status' as const,
    status: 'running' as const,
    rawStatus: 'in_progress',
    name: 'Build',
  }

  it('accepts normalized job, stage, and step activity', () => {
    for (const activity of [
      { kind: 'job', name: 'build' },
      { kind: 'stage', name: 'integration tests', parent: 'build' },
      { kind: 'step', name: 'integration tests', parent: 'build' },
    ]) {
      expect(pipelineStatusSchema.safeParse({ ...base, activity }).success).toBe(true)
    }
  })

  it('rejects malformed activity metadata', () => {
    expect(
      pipelineStatusSchema.safeParse({ ...base, activity: { kind: 'task', name: 'build' } })
        .success,
    ).toBe(false)
    expect(
      pipelineStatusSchema.safeParse({ ...base, activity: { kind: 'job', name: '' } }).success,
    ).toBe(false)
  })

  it('accepts warning as a normalized completed status', () => {
    expect(pipelineStatusSchema.safeParse({ ...base, status: 'warning' }).success).toBe(true)
  })

  it('orders compact pipeline evidence from passed to failed', () => {
    expect(
      ['passed', 'cancelled', 'unknown', 'running', 'warning', 'failed'].map((status) =>
        pipelineStatusPriority(status as PipelineStatus['status']),
      ),
    ).toEqual([0, 1, 2, 3, 4, 5])
  })
})
