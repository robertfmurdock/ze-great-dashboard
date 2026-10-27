import { cleanup, render } from '@testing-library/react'
import type { Panel } from '@ze-great-dashboard/shared/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flightPosition } from '../src/FlightPathField.tsx'
import { PipelinePanel } from '../src/PipelinePanel.tsx'
import { RunningField, type RunningFieldAnimation } from '../src/RunningField.tsx'

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

const renderField = (animation: RunningFieldAnimation) =>
  render(
    <RunningField
      animation={animation}
      progress={0.4}
      estimatedDurationMs={300_000}
      overdue={false}
      indeterminate={false}
    />,
  ).container

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('RunningField', () => {
  it('renders a completed warning with its amber label, duration, and source link', () => {
    const rendered = render(
      <PipelinePanel
        panel={panel}
        envelope={{
          ...envelope(),
          signal: {
            ...envelope().signal,
            status: 'warning',
            rawStatus: 'partiallySucceeded',
            durationMs: 207_000,
          },
        }}
      />,
    ).container

    expect(rendered.textContent).toContain('⚠ Warning')
    expect(rendered.textContent).toContain('Took 3m 27s')
    expect(rendered.querySelector('[data-panel-link]')).not.toBeNull()
    expect(rendered.querySelector('[data-running-field]')).toBeNull()
  })

  it.each([
    ['telemetry-bloom', 'bloom-lane'],
    ['release-transit', 'transit-packet'],
    ['status-weather', 'weather-haze'],
    ['falling-shapes', 'falling-shapes-field'],
    ['snowman', 'snowman-field'],
    ['flight-path', 'flight-path'],
  ] as const)(
    'renders %s as an inert decorative sibling with timing in the text island',
    (animation, part) => {
      const rendered = render(
        <PipelinePanel panel={{ ...panel, running_animation: animation }} envelope={envelope()} />,
      ).container
      const field = rendered.querySelector(`[data-running-field][data-animation="${animation}"]`)
      expect(field?.getAttribute('aria-hidden')).toBe('true')
      expect(field?.querySelector(`[data-running-part="${part}"]`)).not.toBeNull()
      expect(
        field?.closest('[data-panel]')?.querySelector('[data-panel-content]')?.textContent,
      ).toContain('Elapsed')
      expect(field?.closest('[data-panel]')?.querySelector('[data-panel-link]')).not.toBeNull()
    },
  )

  it('renders falling shapes as an inert field behind readable content', () => {
    const rendered = render(
      <PipelinePanel
        panel={{
          ...panel,
          position: { x: 0, y: 0, w: 12, h: 12 },
          running_animation: 'falling-shapes',
        }}
        envelope={envelope()}
      />,
    ).container
    const field = rendered.querySelector('[data-animation="falling-shapes"]')
    expect(field?.getAttribute('aria-hidden')).toBe('true')
    expect(field?.querySelector('[data-running-part="falling-shapes-field"]')).not.toBeNull()
    expect(rendered.querySelector('[data-panel-content]')?.textContent).toContain('Running')
    expect(rendered.querySelector('[data-panel-link]')).not.toBeNull()
  })

  it('chooses a visible treatment at random by default and excludes inactive, off, error, and loading panels', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99)
    const running = render(<PipelinePanel panel={panel} envelope={envelope()} />).container
    expect(running.querySelector('[data-animation="flight-path"]')).not.toBeNull()
    cleanup()
    const off = render(
      <PipelinePanel panel={{ ...panel, running_animation: 'off' }} envelope={envelope()} />,
    ).container
    expect(off.querySelector('[data-running-field]')).toBeNull()
    cleanup()
    const loading = render(<PipelinePanel panel={panel} envelope={undefined} />).container
    expect(loading.querySelector('[data-running-field]')).toBeNull()
  })

  it('keeps its randomly selected default treatment through re-renders', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.99)
    const rendered = render(<PipelinePanel panel={panel} envelope={envelope()} />)
    expect(rendered.container.querySelector('[data-running-progress="radial"]')).not.toBeNull()

    rendered.rerender(<PipelinePanel panel={panel} envelope={envelope()} />)
    expect(rendered.container.querySelector('[data-running-progress="radial"]')).not.toBeNull()
    expect(rendered.container.querySelector('[data-animation="status-weather"]')).toBeNull()
  })

  it('chooses a different default treatment when a panel enters running again', () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0)
    const rendered = render(
      <PipelinePanel
        panel={panel}
        envelope={{ ...envelope(), signal: { ...envelope().signal, status: 'passed' } }}
      />,
    )

    rendered.rerender(<PipelinePanel panel={panel} envelope={envelope()} />)
    expect(rendered.container.querySelector('[data-running-progress="radial"]')).not.toBeNull()

    rendered.rerender(
      <PipelinePanel
        panel={panel}
        envelope={{ ...envelope(), signal: { ...envelope().signal, status: 'passed' } }}
      />,
    )
    rendered.rerender(<PipelinePanel panel={panel} envelope={envelope()} />)
    expect(rendered.container.querySelector('[data-running-progress="radial"]')).toBeNull()
  })

  it.each(['radial', 'runway', 'orbit', 'signal-field'] as const)(
    'preserves %s legacy progress markup',
    (animation) => {
      const rendered = render(
        <PipelinePanel panel={{ ...panel, running_animation: animation }} envelope={envelope()} />,
      ).container
      expect(rendered.querySelector(`[data-running-progress="${animation}"]`)).not.toBeNull()
      expect(rendered.querySelector('[data-running-field]')).toBeNull()
    },
  )

  it('exposes the same overdue contract on legacy progress and decorative fields', () => {
    const overdueEnvelope = {
      ...envelope(),
      signal: { ...envelope().signal, runStartedAt: '2026-08-24T13:00:00.000Z' },
    }
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-24T14:00:00.000Z'))

    const legacy = render(
      <PipelinePanel
        panel={{ ...panel, running_animation: 'radial' }}
        envelope={overdueEnvelope}
      />,
    ).container
    expect(
      legacy.querySelector('[data-running-progress="radial"][data-overdue="true"]'),
    ).not.toBeNull()

    cleanup()
    const field = render(
      <PipelinePanel
        panel={{ ...panel, running_animation: 'telemetry-bloom' }}
        envelope={overdueEnvelope}
      />,
    ).container
    expect(field.querySelector('[data-running-field][data-overdue="true"]')).not.toBeNull()
    expect(field.querySelector('[data-running-part="bloom-flare"]')).not.toBeNull()
  })

  it('renders the telemetry bloom lanes and phased markers', () => {
    const bloom = renderField('telemetry-bloom')
    expect(bloom.querySelectorAll('[data-running-part="bloom-lane"]')).toHaveLength(4)
    expect(bloom.querySelectorAll('[data-running-part="bloom-marker-anchor"]')).toHaveLength(4)
    expect(bloom.querySelectorAll('[data-running-part="bloom-marker"]')).toHaveLength(4)
  })

  it('renders the release transit packet, trail, and current indicator', () => {
    const rendered = renderField('release-transit')

    expect(rendered.querySelectorAll('[data-running-part="transit-packet"]')).toHaveLength(1)
    expect(rendered.querySelectorAll('[data-running-part="transit-trail"]')).toHaveLength(1)
    expect(rendered.querySelectorAll('[data-running-part="transit-now"]')).toHaveLength(1)
  })

  it('renders a tracked passenger aircraft with sky-depth cloud layers and moving ground once overdue', () => {
    const rendered = render(
      <RunningField
        animation="flight-path"
        progress={0.9}
        estimatedDurationMs={300_000}
        overdue
        indeterminate={false}
      />,
    ).container

    const flight = rendered.querySelector('[data-running-part="flight-path"]')
    expect(flight?.getAttribute('data-flight-stage')).toBe('approach')
    expect(rendered.querySelector('[data-running-part="flight-plane"]')).not.toBeNull()
    expect(rendered.querySelector('[data-running-part="flight-plane"] svg')).not.toBeNull()
    expect(rendered.querySelector('[data-running-part="flight-fuselage"]')).not.toBeNull()
    expect(rendered.querySelector('[data-running-part="flight-wing"]')).not.toBeNull()
    expect(rendered.querySelector('[data-running-part="flight-tail"]')).not.toBeNull()
    expect(rendered.querySelectorAll('[data-running-part="flight-ground"]')).toHaveLength(1)
    expect(rendered.querySelectorAll('[data-running-part="flight-ground-terrain"]')).toHaveLength(1)
    expect(rendered.querySelectorAll('[data-running-part="flight-ground-overdrive"]')).toHaveLength(
      1,
    )
    expect(rendered.querySelectorAll('[data-running-part="flight-ground-runway"]')).toHaveLength(1)
    expect(rendered.querySelectorAll('[data-running-part="flight-cloud-layer"]')).toHaveLength(2)
    expect(rendered.querySelector('[data-flight-depth="far"]')).not.toBeNull()
    expect(rendered.querySelector('[data-flight-depth="near"]')).not.toBeNull()
    expect(rendered.querySelector('svg[viewBox="0 0 100 100"]')).toBeNull()
    expect(rendered.querySelectorAll('[data-running-part="flight-cloud"]')).toHaveLength(8)
  })

  it('keeps airborne aircraft centered while the camera follows its world flight', () => {
    const rollout = flightPosition(0, false)
    const rotation = flightPosition(0.18, false)
    const cruise = flightPosition(0.35, false)
    const approach = flightPosition(0.7, false)
    const hold = flightPosition(1, false)

    expect(rollout).toMatchObject({
      worldX: 8,
      worldY: 74,
      x: 8,
      y: 74,
      pitch: 0,
      stage: 'rollout',
    })
    expect(rotation).toMatchObject({
      worldX: 22,
      worldY: 74,
      x: 22,
      y: 74,
      pitch: -7,
      stage: 'climb',
    })
    expect(cruise).toMatchObject({ x: 50, y: 50, pitch: 0, stage: 'cruise' })
    expect(approach).toMatchObject({ x: 50, y: 50, pitch: 4, stage: 'approach' })
    expect(hold).toMatchObject({ x: 50, y: 50, pitch: 4, stage: 'approach' })

    const climbing = flightPosition(0.26, false)
    expect(climbing.x).toBeLessThan(50)
    expect(climbing.pitch).toBe(-7)
    expect(Math.abs(hold.pitch)).toBeLessThanOrEqual(7)
    expect(cruise.groundOffsetY).toBe(20)
    expect(flightPosition(0.85, false).groundOffsetY).toBeGreaterThan(0)
    expect(flightPosition(0.85, false).groundOffsetY).toBeLessThan(20)
    expect(hold.groundOffsetY).toBe(0)
    // Ground runway is at world y 74; the centered late-flight camera leaves it below the jet.
    expect(74 - hold.cameraY - hold.y).toBeGreaterThan(20)
  })

  it('holds an indeterminate flight in level cruise', () => {
    expect(flightPosition(0.95, true)).toMatchObject({ x: 50, y: 50, pitch: 0, stage: 'holding' })
  })
})
