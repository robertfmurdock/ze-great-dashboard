import { render } from '@testing-library/react'
import type { Panel } from '@ze-great-dashboard/shared'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineAnimationDemoPanel } from '../src/PipelineAnimationDemoPanel.tsx'
import { panelRenderers } from '../src/panel-registry.tsx'

const panel: Panel = {
  id: 'active-run-treatments',
  type: 'pipeline-animation-demo',
}

const duration = (value: string) => value as Panel['demo_run_duration']

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('PipelineAnimationDemoPanel', () => {
  it('is selected by the centralized panel registry', () => {
    expect(panelRenderers['pipeline-animation-demo']).toBe(PipelineAnimationDemoPanel)
  })

  it('rotates all retained and panel-scale treatments in fixed twenty-second runs', async () => {
    const rendered = render(<PipelineAnimationDemoPanel panel={panel} />)

    expect(rendered.container.querySelector('[data-running-progress="radial"]')).not.toBeNull()
    expect(rendered.container.textContent).toContain('Demo treatment · radial')
    expect(rendered.container.textContent).toContain('Elapsed 0s')
    expect(rendered.container.textContent).toContain('Expected ≈ 15s')

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('[data-running-progress="runway"]')).not.toBeNull()
    expect(rendered.container.textContent).toContain('0:00/~0:15')

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('[data-running-progress="orbit"]')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(
      rendered.container.querySelector('[data-running-progress="signal-field"]'),
    ).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('[data-animation="telemetry-bloom"]')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('[data-animation="release-transit"]')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('[data-animation="status-weather"]')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('[data-animation="falling-shapes"]')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('[data-running-progress="radial"]')).not.toBeNull()
    expect(rendered.container.textContent).toContain('Elapsed 0s')
    expect(rendered.container.textContent).not.toContain('Over estimate')
  })

  it('uses the real active-run overdue treatment for the final portion of each run', async () => {
    const rendered = render(<PipelineAnimationDemoPanel panel={panel} />)

    await act(async () => vi.advanceTimersByTime(16_000))
    expect(
      rendered.container.querySelector('[data-running-progress][data-overdue="true"]'),
    ).not.toBeNull()
    expect(rendered.container.textContent).toContain('Elapsed 16s')
    expect(rendered.container.textContent).toContain('Over estimate')
  })

  it.each([
    'radial',
    'runway',
    'orbit',
    'signal-field',
    'telemetry-bloom',
    'release-transit',
    'status-weather',
    'falling-shapes',
  ] as const)('keeps %s mounted and marks it overdue after its estimate', async (animation) => {
    const rendered = render(
      <PipelineAnimationDemoPanel
        panel={{
          ...panel,
          running_animation: animation,
          demo_review_duration: duration('10s'),
        }}
      />,
    )

    await act(async () => vi.advanceTimersByTime(11_000))
    const treatment = rendered.container.querySelector(
      `[data-overdue="true"][data-running-progress="${animation}"], [data-overdue="true"][data-animation="${animation}"]`,
    )
    expect(treatment).not.toBeNull()
    expect(rendered.container.textContent).toContain('Over estimate')
  })

  it('holds a configured visible treatment for focused local review', async () => {
    const rendered = render(
      <PipelineAnimationDemoPanel panel={{ ...panel, running_animation: 'signal-field' }} />,
    )

    expect(
      rendered.container.querySelector('[data-running-progress="signal-field"]'),
    ).not.toBeNull()
    await act(async () => vi.advanceTimersByTime(40_000))
    expect(
      rendered.container.querySelector('[data-running-progress="signal-field"]'),
    ).not.toBeNull()
    expect(rendered.container.textContent).toContain('Demo treatment · signal-field')
    expect(rendered.container.textContent).toContain('0:40/~5:00')
  })

  it('uses configured cycle and focused-review durations', async () => {
    const rotating = render(
      <PipelineAnimationDemoPanel panel={{ ...panel, demo_run_duration: duration('5s') }} />,
    )
    await act(async () => vi.advanceTimersByTime(5_000))
    expect(rotating.container.querySelector('[data-running-progress="runway"]')).not.toBeNull()

    vi.setSystemTime(new Date(0))
    const focused = render(
      <PipelineAnimationDemoPanel
        panel={{
          ...panel,
          running_animation: 'signal-field',
          demo_review_duration: duration('7s'),
        }}
      />,
    )
    expect(focused.container.textContent).toContain('Expected ≈ 7s')
    await act(async () => vi.advanceTimersByTime(6_000))
    expect(focused.container.textContent).toContain('Elapsed 6s')
    await act(async () => vi.advanceTimersByTime(2_000))
    expect(focused.container.textContent).toContain('Over estimate')
  })

  it('remounts the decorative field when a focused demo run resets', async () => {
    const rendered = render(
      <PipelineAnimationDemoPanel
        panel={{
          ...panel,
          running_animation: 'falling-shapes',
          demo_review_duration: duration('2s'),
        }}
      />,
    )
    const firstField = rendered.container.querySelector('[data-running-field]')
    expect(firstField).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(3_000))

    const secondField = rendered.container.querySelector('[data-running-field]')
    expect(secondField).not.toBeNull()
    expect(secondField).not.toBe(firstField)
    expect(rendered.container.textContent).toContain('Elapsed 0s')
  })
})
