import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FallingShapesField } from '../src/FallingShapesField.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderField() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () =>
      ({
        width: 1_200,
        height: 180,
        top: 0,
        right: 1_200,
        bottom: 180,
        left: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect,
  )
  return render(<FallingShapesField progress={0.4} overdue={false} seed={7} />)
}

describe('FallingShapesField', () => {
  it('advances pieces through entry and settlement on simulated time', () => {
    vi.useFakeTimers()
    const rendered = renderField()
    const field = rendered.container.querySelector('[data-running-part="falling-shapes-field"]')
    if (!field) throw new Error('falling shapes field was not rendered')

    expect(field.getAttribute('data-direction')).toBe('horizontal')
    expect(field.querySelectorAll('[data-piece]')).toHaveLength(0)

    act(() => vi.advanceTimersByTime(1_250))
    expect(field.querySelectorAll('[data-piece]')).toHaveLength(1)
    expect(field.querySelector('[data-piece]')?.getAttribute('data-piece-phase')).toBe('entry')
    expect(field.querySelectorAll('[data-piece] > span').length).toBeGreaterThanOrEqual(2)
    expect(field.querySelectorAll('[data-piece] > span').length).toBeLessThanOrEqual(4)

    act(() => vi.advanceTimersByTime(1_100))
    expect(field.querySelector('[data-piece]')?.getAttribute('data-piece-phase')).toBe('settled')

    act(() => vi.advanceTimersByTime(1_250))
    expect(field.querySelectorAll('[data-piece]')).toHaveLength(2)
  })

  it('keeps the field static when reduced motion is requested', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    vi.useFakeTimers()
    const rendered = renderField()
    const field = rendered.container.querySelector('[data-running-part="falling-shapes-field"]')
    if (!field) throw new Error('falling shapes field was not rendered')

    const initial = field.innerHTML
    act(() => vi.advanceTimersByTime(10_000))

    expect(field.innerHTML).toBe(initial)
  })
})
