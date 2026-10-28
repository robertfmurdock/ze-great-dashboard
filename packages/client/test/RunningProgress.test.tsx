import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { RunningProgress } from '../src/RunningProgress.tsx'

describe('RunningProgress', () => {
  test(
    'renders the legacy signal tracks and phased markers',
    mint({
      setup: () => ({
        animation: 'signal-field' as const,
        timing: {
          elapsedMs: 120_000,
          estimatedDurationMs: 300_000,
          hasEstimate: true,
          overdue: false,
          progress: 0.4,
        },
      }),
      exercise: ({ animation, timing }) =>
        render(<RunningProgress animation={animation} timing={timing} />).container,
      verify: (rendered) => {
        expect(rendered.querySelectorAll('[data-running-part="signal-track"]')).toHaveLength(5)
        expect(
          rendered.querySelectorAll('[data-running-part="signal-marker-anchor"]'),
        ).toHaveLength(5)
        expect(rendered.querySelectorAll('[data-running-part="signal-marker"]')).toHaveLength(5)
      },
    }),
  )
})
