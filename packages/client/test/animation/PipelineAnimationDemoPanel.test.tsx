import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import type { Panel } from '@ze-great-dashboard/shared/browser'
import { act } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PipelineAnimationDemoPanel } from '../../src/PipelineAnimationDemoPanel.tsx'
import { PanelRenderer } from '../../src/panel-registry.tsx'

vi.mock('../../src/RunningField.tsx', async () => {
  const actual = await vi.importActual<typeof import('../../src/RunningField.tsx')>(
    '../../src/RunningField.tsx',
  )
  return {
    ...actual,
    // The demo owns treatment scheduling; RunningField owns decorative rendering.
    RunningField: ({ animation, overdue }: { animation: string; overdue: boolean }) => (
      <div data-animation={animation} data-running-field data-overdue={overdue || undefined} />
    ),
  }
})

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
  describe('panel registration', () => {
    it(
      'renders a local demo through the public panel renderer',
      mint({
        setup: () => {
          const animation = 'runway' as const
          return { panel: { ...panel, running_animation: animation } }
        },
        exercise: ({ panel }) => render(<PanelRenderer panel={panel} envelope={undefined} />),
        verify: (_result, { panel }) =>
          expect(screen.getByText(panel.running_animation)).toBeTruthy(),
      }),
    )
  })

  describe('rotating demos', () => {
    it(
      'starts with radial timing at zero elapsed',
      mint({
        setup: () => ({ panel }),
        exercise: ({ panel }) => render(<PipelineAnimationDemoPanel panel={panel} />),
        verify: ({ container }) => {
          expect(screen.getByText('radial')).toBeTruthy()
          expect(container.textContent).toContain('Elapsed 0s')
          expect(container.textContent).toContain('Expected ≈ 15s')
        },
      }),
    )
    for (const scenario of [
      { elapsed: 20000, animation: 'runway' },
      { elapsed: 40000, animation: 'orbit' },
      { elapsed: 60000, animation: 'signal-field' },
      { elapsed: 80000, animation: 'telemetry-bloom' },
      { elapsed: 100000, animation: 'release-transit' },
      { elapsed: 120000, animation: 'status-weather' },
      { elapsed: 140000, animation: 'falling-shapes' },
      { elapsed: 160000, animation: 'snowman' },
      { elapsed: 180000, animation: 'flight-path' },
      { elapsed: 200000, animation: 'radial' },
    ])
      it(
        `rotates to ${scenario.animation} after ${scenario.elapsed}ms`,
        mint({
          setup: () => ({
            ...scenario,
            rendered: render(<PipelineAnimationDemoPanel panel={panel} />),
          }),
          exercise: async ({ rendered, elapsed }) => {
            await act(async () => vi.advanceTimersByTime(elapsed))
            return rendered
          },
          verify: ({ container }, { animation }) => {
            expect(screen.getByText(animation)).toBeTruthy()
            expect(container.textContent).toContain('Elapsed 0s')
            expect(container.textContent).not.toContain('Over estimate')
          },
        }),
      )
    it(
      'renders an overdue active run before the cycle ends',
      mint({
        setup: () => ({
          rendered: render(<PipelineAnimationDemoPanel panel={panel} />),
          elapsed: 16000,
        }),
        exercise: async ({ rendered, elapsed }) => {
          await act(async () => vi.advanceTimersByTime(elapsed))
          return rendered
        },
        verify: ({ container }) => {
          expect(container.querySelector('[data-overdue="true"]')).not.toBeNull()
          expect(container.textContent).toContain('Elapsed 16s')
          expect(container.textContent).toContain('Over estimate')
        },
      }),
    )
    it(
      'uses the configured rotation duration',
      mint({
        setup: () => ({
          rendered: render(
            <PipelineAnimationDemoPanel panel={{ ...panel, demo_run_duration: duration('5s') }} />,
          ),
          elapsed: 5000,
        }),
        exercise: async ({ rendered, elapsed }) => {
          await act(async () => vi.advanceTimersByTime(elapsed))
          return rendered
        },
        verify: () => expect(screen.getByText('runway')).toBeTruthy(),
      }),
    )
  })
  describe('focused demos', () => {
    for (const animation of [
      'radial',
      'runway',
      'orbit',
      'signal-field',
      'telemetry-bloom',
      'release-transit',
      'status-weather',
      'falling-shapes',
      'snowman',
      'flight-path',
    ] as const)
      it(
        `keeps ${animation} selected after its estimate`,
        mint({
          setup: () => ({
            animation,
            elapsed: 11000,
            rendered: render(
              <PipelineAnimationDemoPanel
                panel={{
                  ...panel,
                  running_animation: animation,
                  demo_review_duration: duration('10s'),
                }}
              />,
            ),
          }),
          exercise: async ({ rendered, elapsed }) => {
            await act(async () => vi.advanceTimersByTime(elapsed))
            return rendered
          },
          verify: ({ container }, { animation }) => {
            expect(screen.getByText(animation)).toBeTruthy()
            expect(container.querySelector('[data-overdue="true"]')).not.toBeNull()
            expect(container.textContent).toContain('Over estimate')
          },
        }),
      )
    it(
      'holds a configured treatment through multiple rotation intervals',
      mint({
        setup: () => ({
          rendered: render(
            <PipelineAnimationDemoPanel panel={{ ...panel, running_animation: 'signal-field' }} />,
          ),
          elapsed: 40000,
        }),
        exercise: async ({ rendered, elapsed }) => {
          await act(async () => vi.advanceTimersByTime(elapsed))
          return rendered
        },
        verify: ({ container }) => {
          expect(screen.getByText('signal-field')).toBeTruthy()
          expect(container.textContent).toContain('0:40/~5:00')
        },
      }),
    )
    it(
      'uses the configured estimate before the review cycle resets',
      mint({
        setup: () => ({
          rendered: render(
            <PipelineAnimationDemoPanel
              panel={{
                ...panel,
                running_animation: 'signal-field',
                demo_review_duration: duration('7s'),
              }}
            />,
          ),
          elapsed: 8000,
        }),
        exercise: async ({ rendered, elapsed }) => {
          await act(async () => vi.advanceTimersByTime(elapsed))
          return rendered
        },
        verify: ({ container }) => {
          expect(container.textContent).toContain('Expected ≈ 7s')
          expect(container.textContent).toContain('Elapsed 8s')
          expect(container.textContent).toContain('Over estimate')
        },
      }),
    )
    it(
      'remounts a decorative field when the focused run resets',
      mint({
        setup: () => {
          const rendered = render(
            <PipelineAnimationDemoPanel
              panel={{
                ...panel,
                running_animation: 'falling-shapes',
                demo_review_duration: duration('2s'),
              }}
            />,
          )
          return {
            rendered,
            firstField: rendered.container.querySelector('[data-running-field]'),
            elapsed: 3000,
          }
        },
        exercise: async ({ rendered, elapsed }) => {
          await act(async () => vi.advanceTimersByTime(elapsed))
          return rendered
        },
        verify: ({ container }, { firstField }) => {
          expect(firstField).not.toBeNull()
          const next = container.querySelector('[data-running-field]')
          expect(next).not.toBeNull()
          expect(next).not.toBe(firstField)
          expect(container.textContent).toContain('Elapsed 0s')
        },
      }),
    )
  })
})
