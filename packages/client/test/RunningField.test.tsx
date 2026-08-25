import { cleanup, render } from '@testing-library/react'
import type { Panel } from '@ze-great-dashboard/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PipelinePanel } from '../src/PipelinePanel.tsx'

const panel: Panel = { id: 'build', type: 'pipeline-status' }
const envelope = () => ({
  panelId: 'build',
  state: 'ok' as const,
  observedAt: '2026-08-24T14:00:00.000Z',
  link: 'https://example.com/run',
  signal: {
    type: 'pipeline-status' as const,
    status: 'running' as const,
    rawStatus: 'in_progress',
    name: 'Build',
    runStartedAt: '2026-08-24T13:58:00.000Z',
    estimatedDurationMs: 300_000,
  },
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RunningField', () => {
  it.each([
    ['telemetry-bloom', '.running-field__bloom-lane'],
    ['release-transit', '.running-field__transit-packet'],
    ['status-weather', '.running-field__weather-haze'],
  ] as const)(
    'renders %s as an inert decorative sibling with timing in the text island',
    (animation, part) => {
      const rendered = render(
        <PipelinePanel panel={{ ...panel, running_animation: animation }} envelope={envelope()} />,
      ).container
      const field = rendered.querySelector(`.running-field[data-animation="${animation}"]`)
      expect(field?.getAttribute('aria-hidden')).toBe('true')
      expect(field?.querySelector(part)).not.toBeNull()
      expect(field?.closest('.panel')?.querySelector('.panel__content')?.textContent).toContain(
        'Elapsed',
      )
      expect(field?.closest('.panel')?.querySelector('.panel__link')).not.toBeNull()
    },
  )

  it('chooses a visible treatment at random by default and excludes inactive, off, error, and loading panels', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const running = render(<PipelinePanel panel={panel} envelope={envelope()} />).container
    expect(running.querySelector('[data-animation="status-weather"]')).not.toBeNull()
    cleanup()
    const off = render(
      <PipelinePanel panel={{ ...panel, running_animation: 'off' }} envelope={envelope()} />,
    ).container
    expect(off.querySelector('.running-field')).toBeNull()
    cleanup()
    const loading = render(<PipelinePanel panel={panel} envelope={undefined} />).container
    expect(loading.querySelector('.running-field')).toBeNull()
  })

  it('keeps its randomly selected default treatment through re-renders', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.99)
    const rendered = render(<PipelinePanel panel={panel} envelope={envelope()} />)
    expect(rendered.container.querySelector('.running-progress--radial')).not.toBeNull()

    rendered.rerender(<PipelinePanel panel={panel} envelope={envelope()} />)
    expect(rendered.container.querySelector('.running-progress--radial')).not.toBeNull()
    expect(rendered.container.querySelector('[data-animation="status-weather"]')).toBeNull()
  })

  it.each(['radial', 'runway', 'orbit', 'signal-field'] as const)(
    'preserves %s legacy progress markup',
    (animation) => {
      const rendered = render(
        <PipelinePanel panel={{ ...panel, running_animation: animation }} envelope={envelope()} />,
      ).container
      expect(rendered.querySelector(`.running-progress--${animation}`)).not.toBeNull()
      expect(rendered.querySelector('.running-field')).toBeNull()
    },
  )
})
