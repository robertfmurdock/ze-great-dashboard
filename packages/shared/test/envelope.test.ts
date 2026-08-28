import { describe, expect, it } from 'vitest'
import { pipelineStatusSchema } from '../src/envelope.ts'

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
})
