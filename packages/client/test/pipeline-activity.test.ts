import { describe, expect, it } from 'vitest'
import { formatPipelineActivity } from '../src/pipeline-activity.ts'

describe('pipeline activity formatting', () => {
  it('formats parent activity without knowing its source', () => {
    expect(
      formatPipelineActivity({ kind: 'step', name: 'integration tests', parent: 'build' }),
    ).toBe('build › integration tests')
  })

  it('formats standalone activity and missing detail', () => {
    expect(formatPipelineActivity({ kind: 'job', name: 'build' })).toBe('build')
    expect(formatPipelineActivity(undefined)).toBe('Activity unavailable')
  })
})
