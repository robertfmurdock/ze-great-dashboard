import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { RunningFieldTiming } from '../../src/RunningFieldTiming.tsx'
import { RunningProgress } from '../../src/RunningProgress.tsx'

const timing = {
  elapsedMs: 120000,
  estimatedDurationMs: 300000,
  hasEstimate: true,
  overdue: false,
  progress: 0.4,
}
describe('legacy running progress presentation', () => {
  for (const animation of ['radial', 'orbit', 'runway', 'signal-field'] as const)
    test(
      `discloses timing and keeps ${animation} drawing inert`,
      mint({
        setup: () => ({ animation, timing }),
        exercise: (props) => render(<RunningProgress {...props} />),
        verify: ({ container }, { animation }) => {
          expect(container.querySelector(`[data-running-progress="${animation}"]`)).not.toBeNull()
          expect(container.textContent).toContain('Elapsed 2m 0s')
          expect(container.textContent).toContain('Expected ≈ 5m 0s')
          expect(
            container.querySelector('[data-running-visual]')?.getAttribute('aria-hidden'),
          ).toBe('true')
        },
      }),
    )
  for (const animation of ['runway', 'signal-field'] as const)
    test(
      `offers a compact readout for ${animation}`,
      mint({
        setup: () => ({ animation, timing }),
        exercise: (props) => render(<RunningProgress {...props} />),
        verify: ({ container }) => expect(container.textContent).toContain('2:00/~5:00'),
      }),
    )
})
describe('field timing presentation', () => {
  test(
    'keeps full timing evidence alongside the compact field readout',
    mint({
      setup: () => ({
        elapsedMs: timing.elapsedMs,
        estimatedDurationMs: timing.estimatedDurationMs,
        overdue: timing.overdue,
      }),
      exercise: (props) => render(<RunningFieldTiming {...props} />),
      verify: ({ container }) => {
        expect(container.textContent).toContain('Elapsed 2m 0s')
        expect(container.textContent).toContain('Expected ≈ 5m 0s')
        expect(container.textContent).toContain('2:00/~5:00')
      },
    }),
  )
})
