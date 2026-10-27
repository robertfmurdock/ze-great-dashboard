import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { visualSeed } from '../src/visual-seed.ts'

describe('visualSeed', () => {
  test(
    'is stable per panel id while preserving deterministic variation',
    mint({
      setup: () => ({ panelId: 'build', distinctPanelId: 'deploy' }),
      exercise: ({ panelId, distinctPanelId }) => ({
        first: visualSeed(panelId),
        repeat: visualSeed(panelId),
        distinct: visualSeed(distinctPanelId),
      }),
      verify: ({ first, repeat, distinct }) => {
        expect(first).toBe(repeat)
        expect(first).not.toBe(distinct)
      },
    }),
  )
})
