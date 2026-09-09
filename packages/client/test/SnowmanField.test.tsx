import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SnowmanField } from '../src/SnowmanField.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function reducedMotion() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  )
}

describe('SnowmanField', () => {
  it('renders one clipped canvas instead of replacement snowman geometry', () => {
    reducedMotion()
    const rendered = render(
      <SnowmanField progress={0.7} estimatedDurationMs={10_000} overdue={false} seed={7} />,
    )
    const field = rendered.container.querySelector('[data-running-part="snowman-field"]')
    expect(field?.getAttribute('data-snowman-phase')).toBe('assembling')
    expect(field?.querySelector('[data-running-part="snowman-canvas"]')).not.toBeNull()
    expect(field?.querySelector('.body, .head, [data-snow-particle]')).toBeNull()
  })

  it('renders a stable, dense reduced-motion completed scene', () => {
    reducedMotion()
    const rendered = render(
      <SnowmanField progress={1} estimatedDurationMs={10_000} overdue={true} seed={7} />,
    )
    const field = rendered.container.querySelector('[data-running-part="snowman-field"]')
    expect(field?.getAttribute('data-reduced-motion')).toBe('true')
    expect(Number(field?.getAttribute('data-snow-cell-count'))).toBeGreaterThan(100)
    expect(field?.getAttribute('data-snowman-toppled')).toBeNull()
  })
})
