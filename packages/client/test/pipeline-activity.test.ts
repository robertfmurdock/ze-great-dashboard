import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { formatPipelineActivity } from '../src/pipeline-activity.ts'

describe('pipeline activity formatting', () => {
  test(
    'formats parent activity without knowing its source',
    mint({
      setup: () => ({
        activity: { kind: 'step' as const, name: 'integration tests', parent: 'build' },
      }),
      exercise: ({ activity }) => formatPipelineActivity(activity),
      verify: (formatted) => expect(formatted).toBe('build › integration tests'),
    }),
  )

  test(
    'formats standalone activity',
    mint({
      setup: () => ({ activity: { kind: 'job' as const, name: 'build' } }),
      exercise: ({ activity }) => formatPipelineActivity(activity),
      verify: (formatted) => expect(formatted).toBe('build'),
    }),
  )

  test(
    'discloses missing activity detail',
    mint({
      setup: () => ({ activity: undefined }),
      exercise: ({ activity }) => formatPipelineActivity(activity),
      verify: (formatted) => expect(formatted).toBe('Activity unavailable'),
    }),
  )
})
