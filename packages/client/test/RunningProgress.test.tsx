import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { RunningProgress } from '../src/RunningProgress.tsx'

afterEach(cleanup)

describe('RunningProgress', () => {
  it('renders the legacy signal tracks and phased markers', () => {
    const rendered = render(
      <RunningProgress
        animation="signal-field"
        timing={{
          elapsedMs: 120_000,
          estimatedDurationMs: 300_000,
          hasEstimate: true,
          overdue: false,
          progress: 0.4,
        }}
      />,
    ).container

    expect(rendered.querySelectorAll('[data-running-part="signal-track"]')).toHaveLength(5)
    expect(rendered.querySelectorAll('[data-running-part="signal-marker-anchor"]')).toHaveLength(5)
    expect(rendered.querySelectorAll('[data-running-part="signal-marker"]')).toHaveLength(5)
  })
})
