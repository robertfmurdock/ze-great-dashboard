import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SnowmanField } from '../src/SnowmanField.tsx'

function snowmanFixture(props: ComponentProps<typeof SnowmanField>) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  return props
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SnowmanField', () => {
  test(
    'presents the assembling phase under reduced motion',
    mint({
      setup: () => ({
        props: snowmanFixture({
          progress: 0.7,
          estimatedDurationMs: 10_000,
          overdue: false,
          seed: 7,
        }),
      }),
      exercise: ({ props }) => render(<SnowmanField {...props} />).container,
      verify: (rendered) => {
        const field = rendered.querySelector('[data-running-part="snowman-field"]')
        expect(field?.getAttribute('data-snowman-phase')).toBe('assembling')
      },
    }),
  )

  test(
    'renders a dense completed scene under reduced motion',
    mint({
      setup: () => ({
        props: snowmanFixture({
          progress: 1,
          estimatedDurationMs: 10_000,
          overdue: true,
          seed: 7,
        }),
      }),
      exercise: ({ props }) => render(<SnowmanField {...props} />).container,
      verify: (rendered) => {
        const field = rendered.querySelector('[data-running-part="snowman-field"]')
        expect(field?.getAttribute('data-reduced-motion')).toBe('true')
        expect(Number(field?.getAttribute('data-snow-cell-count'))).toBeGreaterThan(100)
        expect(field?.getAttribute('data-snowman-toppled')).toBeNull()
      },
    }),
  )
})
