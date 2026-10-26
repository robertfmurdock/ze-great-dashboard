import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect } from 'vitest'
import { formatPipelineActivity } from '../src/pipeline-activity.ts'

describe('pipeline activity formatting', () => {
  mintTest('formats parent activity without knowing its source', {
    setup: () => ({
      activity: { kind: 'step' as const, name: 'integration tests', parent: 'build' },
    }),
    exercise: ({ activity }) => formatPipelineActivity(activity),
    verify: (formatted) => expect(formatted).toBe('build › integration tests'),
  })

  mintTest('formats standalone activity', {
    setup: () => ({ activity: { kind: 'job' as const, name: 'build' } }),
    exercise: ({ activity }) => formatPipelineActivity(activity),
    verify: (formatted) => expect(formatted).toBe('build'),
  })

  mintTest('discloses missing activity detail', {
    setup: () => ({ activity: undefined }),
    exercise: ({ activity }) => formatPipelineActivity(activity),
    verify: (formatted) => expect(formatted).toBe('Activity unavailable'),
  })
})
