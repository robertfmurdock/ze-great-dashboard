import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { retryAfterTime } from '../src/test-history.ts'

describe('shared Retry-After interpretation', () => {
  const cases = [
    { name: 'relative seconds', value: '3600', expected: '2026-11-05T01:00:00Z' },
    {
      name: 'future HTTP date',
      value: 'Thu, 05 Nov 2026 02:00:00 GMT',
      expected: '2026-11-05T02:00:00Z',
    },
    { name: 'past HTTP date', value: 'Wed, 04 Nov 2026 23:00:00 GMT', expected: undefined },
    { name: 'missing guidance', value: null, expected: undefined },
    { name: 'invalid guidance', value: 'not-a-time', expected: undefined },
    { name: 'zero seconds does not extend backoff', value: '0', expected: undefined },
  ]
  for (const scenario of cases)
    test(
      scenario.name,
      mint({
        setup: () => ({
          value: scenario.value,
          now: Date.parse('2026-11-05T00:00:00Z'),
          expected: scenario.expected === undefined ? undefined : Date.parse(scenario.expected),
        }),
        exercise: ({ value, now }) => retryAfterTime(value, now),
        verify: (at, { expected }) => expect(at).toBe(expected),
      }),
    )
})
