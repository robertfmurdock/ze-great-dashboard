import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, test, vi } from 'vitest'
import { SnowmanField } from '../src/SnowmanField.tsx'

function snowmanFixture(scope: ResourceScope, props: ComponentProps<typeof SnowmanField>) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
  scope.defer('restore snowman environment', () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  return props
}

describe('SnowmanField', () => {
  test(
    'renders one clipped canvas instead of replacement snowman geometry',
    mint({
      setup: ({ scope }) => ({
        props: snowmanFixture(scope, {
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
        expect(field?.querySelector('[data-running-part="snowman-canvas"]')).not.toBeNull()
        expect(field?.querySelector('.body, .head, [data-snow-particle]')).toBeNull()
      },
    }),
  )

  test(
    'renders a stable, dense reduced-motion completed scene',
    mint({
      setup: ({ scope }) => ({
        props: snowmanFixture(scope, {
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
