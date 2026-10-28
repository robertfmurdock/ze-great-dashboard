import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { FallingShapesField } from '../src/FallingShapesField.tsx'

function fieldFixture(scope: ResourceScope, reducedMotion = false) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 1200,
    height: 180,
  } as DOMRect)
  if (reducedMotion)
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    )
  scope.defer('restore field environment', () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })
  return { progress: 0.4, overdue: false, seed: 7 }
}

describe('FallingShapesField', () => {
  test(
    'chooses horizontal geometry for a wide panel',
    mint({
      setup: ({ scope }) => ({ fieldProps: fieldFixture(scope) }),
      exercise: ({ fieldProps }) => render(<FallingShapesField {...fieldProps} />).container,
      verify: (rendered) => {
        expect(
          rendered
            .querySelector('[data-running-part="falling-shapes-field"]')
            ?.getAttribute('data-direction'),
        ).toBe('horizontal')
      },
    }),
  )

  test(
    'renders a stable settled composition when reduced motion is requested',
    mint({
      setup: ({ scope }) => ({ fieldProps: fieldFixture(scope, true) }),
      exercise: ({ fieldProps }) => render(<FallingShapesField {...fieldProps} />).container,
      verify: (rendered) => {
        const phases = [
          ...(rendered
            .querySelector('[data-running-part="falling-shapes-field"]')
            ?.querySelectorAll('[data-piece]') ?? []),
        ].map((piece) => piece.getAttribute('data-piece-phase'))
        expect(phases.length).toBeGreaterThan(0)
        expect(phases.every((phase) => phase === 'settled')).toBe(true)
      },
    }),
  )
})
