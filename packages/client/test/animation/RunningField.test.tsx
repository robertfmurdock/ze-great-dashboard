import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RunningField } from '../../src/RunningField.tsx'

describe('decorative running fields', () => {
  for (const animation of [
    'telemetry-bloom',
    'release-transit',
    'status-weather',
    'falling-shapes',
    'snowman',
    'flight-path',
  ] as const)
    it(
      `keeps ${animation} inert and exposes overdue presentation`,
      mint({
        setup: () => ({
          animation,
          progress: 0.4,
          estimatedDurationMs: 300000,
          overdue: true,
          indeterminate: false,
        }),
        exercise: (props) => render(<RunningField {...props} />),
        verify: ({ container }, { animation }) => {
          const field = container.querySelector(
            `[data-running-field][data-animation="${animation}"]`,
          )
          expect(field).not.toBeNull()
          expect(field?.getAttribute('aria-hidden')).toBe('true')
          expect(field?.getAttribute('data-overdue')).toBe('true')
        },
      }),
    )
})
