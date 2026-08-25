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

  it('rotates radial, runway, orbit, and signal field in fixed twenty-second runs', async () => {
    const rendered = render(<PipelineAnimationDemoPanel panel={panel} />)

    expect(rendered.container.querySelector('.running-progress--radial')).not.toBeNull()
    expect(rendered.container.textContent).toContain('Demo treatment · radial')
    expect(rendered.container.textContent).toContain('Elapsed 0s')
    expect(rendered.container.textContent).toContain('Expected ≈ 15s')

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('.running-progress--runway')).not.toBeNull()
    expect(rendered.container.textContent).toContain('0:00/~0:15')

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('.running-progress--orbit')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('.running-progress--signal-field')).not.toBeNull()

    await act(async () => vi.advanceTimersByTime(20_000))
    expect(rendered.container.querySelector('.running-progress--radial')).not.toBeNull()
    expect(rendered.container.textContent).toContain('Elapsed 0s')
    expect(rendered.container.textContent).not.toContain('Over estimate')
  })

  it('uses the real active-run overdue treatment for the final portion of each run', async () => {
    const rendered = render(<PipelineAnimationDemoPanel panel={panel} />)

    await act(async () => vi.advanceTimersByTime(16_000))
    expect(rendered.container.querySelector('.running-progress--overdue')).not.toBeNull()
    expect(rendered.container.textContent).toContain('Elapsed 16s')
    expect(rendered.container.textContent).toContain('Over estimate')
  })
})
