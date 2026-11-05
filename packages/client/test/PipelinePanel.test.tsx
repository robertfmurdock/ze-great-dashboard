import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import { afterEach, describe, expect, it, test, vi } from 'vitest'
import { PipelinePanel } from '../src/PipelinePanel.tsx'

const panel: Panel = { id: 'build', type: 'pipeline-status' }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('PipelinePanel', () => {
  test(
    'discloses a GitHub-rejected older response as historical evidence, not loading or attention',
    mint({
      setup: () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
        return {
          rejectedPipeline: {
            status: 'failed' as const,
            sourceUpdatedAt: '2026-08-28T11:30:00.000Z',
            link: 'https://github.com/example/repo/actions/runs/2',
            github: true,
          },
        }
      },
      exercise: ({ rejectedPipeline }) =>
        render(
          <PipelinePanel panel={panel} envelope={undefined} rejectedPipeline={rejectedPipeline} />,
        ).container,
      verify: (rendered, { rejectedPipeline }) => {
        expect(screen.getByText('Failed')).toBeTruthy()
        expect(screen.getByText(/GitHub returned an older result; checking again/)).toBeTruthy()
        expect(screen.getByText(/Last confirmed 30m ago/)).toBeTruthy()
        const incident = screen.getByRole('link', { name: 'GitHub API report' })
        expect(incident.getAttribute('href')).toBe(
          'https://github.com/orgs/community/discussions/206725',
        )
        expect(incident.getAttribute('target')).toBe('_blank')
        expect(incident.getAttribute('rel')).toBe('noopener noreferrer')
        const source = rendered.querySelector('[data-panel-link]')
        expect(source?.getAttribute('href')).toBe(rejectedPipeline.link)
        expect(rendered.querySelector('[data-panel]')?.hasAttribute('aria-busy')).toBe(false)
        expect(
          rendered.querySelector('[data-panel]')?.getAttribute('data-attention-active'),
        ).toBeNull()
      },
    }),
  )
})

describe('run panel test evidence composition', () => {
  test(
    'keeps build status and its test evidence in the same panel',
    mint({
      setup: () => {
        const total = 37
        return {
          total,
          envelope: {
            panelId: panel.id,
            state: 'ok',
            observedAt: '2026-11-02T15:00:00.000Z',
            link: null,
            signal: {
              type: 'pipeline-status',
              status: 'passed',
              rawStatus: 'success',
              name: 'Build',
              testResults: {
                state: 'ok',
                observedAt: '2026-11-02T15:00:00.000Z',
                signal: { type: 'test-count', status: 'reported', total },
              },
            },
          } satisfies Envelope,
        }
      },
      exercise: ({ envelope }) => render(<PipelinePanel panel={panel} envelope={envelope} />),
      verify: (_result, { total }) => {
        expect(screen.getByText('Passed')).toBeTruthy()
        expect(screen.getByText(`${total} tests`)).toBeTruthy()
      },
    }),
  )
})

describe('pipeline running treatment composition', () => {
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
  it(
    'renders a completed warning with its label, duration, and source link',
    mint({
      setup: () => {
        return {
          element: (
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
            />
          ),
        }
      },
      exercise: ({ element }) => render(element).container,
      verify: (rendered) => {
        expect(rendered.textContent).toContain('⚠ Warning')
        expect(rendered.textContent).toContain('Took 3m 27s')
        expect(rendered.querySelector('[data-panel-link]')).not.toBeNull()
        expect(rendered.querySelector('[data-running-field]')).toBeNull()
      },
    }),
  )

  for (const animation of [
    'telemetry-bloom',
    'release-transit',
    'status-weather',
    'falling-shapes',
    'snowman',
    'flight-path',
  ] as const)
    it(
      `composes ${animation} with timing and a source link`,
      mint({
        setup: () => ({ animation, input: envelope() }),
        exercise: ({ animation, input }) =>
          render(
            <PipelinePanel panel={{ ...panel, running_animation: animation }} envelope={input} />,
          ),
        verify: ({ container }, { animation, input }) => {
          expect(container.querySelector(`[data-animation="${animation}"]`)).not.toBeNull()
          expect(container.textContent).toContain('Elapsed')
          expect(container.querySelector('[data-panel-link]')?.getAttribute('href')).toBe(
            input.link,
          )
        },
      }),
    )

  it(
    'chooses a visible treatment at random by default',
    mint({
      setup: () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.99)
        return { element: <PipelinePanel panel={panel} envelope={envelope()} /> }
      },
      exercise: ({ element }) => render(element).container,
      verify: (running) => {
        expect(running.querySelector('[data-animation="flight-path"]')).not.toBeNull()
      },
    }),
  )

  it(
    'omits a running treatment when it is configured off',
    mint({
      setup: () => {
        return {
          element: (
            <PipelinePanel panel={{ ...panel, running_animation: 'off' }} envelope={envelope()} />
          ),
        }
      },
      exercise: ({ element }) => render(element).container,
      verify: (rendered) => {
        expect(rendered.querySelector('[data-running-field]')).toBeNull()
      },
    }),
  )

  it(
    'omits a running treatment while the panel is loading',
    mint({
      setup: () => {
        return { element: <PipelinePanel panel={panel} envelope={undefined} /> }
      },
      exercise: ({ element }) => render(element).container,
      verify: (rendered) => {
        expect(rendered.querySelector('[data-running-field]')).toBeNull()
      },
    }),
  )

  it(
    'omits a running treatment after the pipeline is no longer active',
    mint({
      setup: () => {
        return {
          element: (
            <PipelinePanel
              panel={panel}
              envelope={{ ...envelope(), signal: { ...envelope().signal, status: 'passed' } }}
            />
          ),
        }
      },
      exercise: ({ element }) => render(element).container,
      verify: (rendered) => {
        expect(rendered.querySelector('[data-running-field]')).toBeNull()
      },
    }),
  )

  it(
    'omits a running treatment when upstream evidence is unreadable',
    mint({
      setup: () => {
        return {
          element: (
            <PipelinePanel
              panel={panel}
              envelope={{
                panelId: panel.id,
                state: 'error',
                observedAt: '2026-08-24T14:00:00.000Z',
                link: null,
                error: { kind: 'unreachable', message: 'Timed out' },
              }}
            />
          ),
        }
      },
      exercise: ({ element }) => render(element).container,
      verify: (rendered) => {
        expect(rendered.querySelector('[data-running-field]')).toBeNull()
      },
    }),
  )

  it(
    'keeps its randomly selected default treatment through re-renders',
    mint({
      setup: () => {
        vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.99)
        const input = envelope()
        const rendered = render(<PipelinePanel panel={panel} envelope={input} />)
        return {
          rendered,
          input,
          initial: rendered.container
            .querySelector('[data-running-progress]')
            ?.getAttribute('data-running-progress'),
        }
      },
      exercise: ({ rendered, input }) => {
        rendered.rerender(<PipelinePanel panel={panel} envelope={input} />)
        return rendered.container
      },
      verify: (container, { initial }) => {
        expect(initial).toBe('radial')
        expect(container.querySelector('[data-running-progress="radial"]')).not.toBeNull()
        expect(container.querySelector('[data-animation="status-weather"]')).toBeNull()
      },
    }),
  )

  it(
    'chooses a different default treatment when a panel enters running again',
    mint({
      setup: () => {
        vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0)
        const input = envelope()
        const passed = { ...input, signal: { ...input.signal, status: 'passed' as const } }
        const rendered = render(<PipelinePanel panel={panel} envelope={input} />)
        const initial = rendered.container
          .querySelector('[data-running-progress]')
          ?.getAttribute('data-running-progress')
        return { rendered, input, passed, initial }
      },
      exercise: ({ rendered, input, passed }) => {
        rendered.rerender(<PipelinePanel panel={panel} envelope={passed} />)
        rendered.rerender(<PipelinePanel panel={panel} envelope={input} />)
        return rendered.container
      },
      verify: (container, { initial }) => {
        expect(initial).toBe('radial')
        expect(container.querySelector('[data-running-progress="radial"]')).toBeNull()
        expect(
          container.querySelector('[data-running-progress], [data-running-field]'),
        ).not.toBeNull()
      },
    }),
  )

  for (const animation of ['radial', 'runway', 'orbit', 'signal-field'] as const)
    it(
      `selects legacy treatment ${animation}`,
      mint({
        setup: () => ({ animation, input: envelope() }),
        exercise: ({ animation, input }) =>
          render(
            <PipelinePanel panel={{ ...panel, running_animation: animation }} envelope={input} />,
          ),
        verify: ({ container }, { animation }) => {
          expect(container.querySelector(`[data-running-progress="${animation}"]`)).not.toBeNull()
          expect(container.querySelector('[data-running-field]')).toBeNull()
        },
      }),
    )

  describe('overdue composition', () => {
    for (const animation of ['radial', 'telemetry-bloom'] as const)
      it(
        `passes overdue timing to ${animation}`,
        mint({
          setup: () => {
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2026-08-24T14:00:00.000Z'))
            return {
              animation,
              envelope: {
                ...envelope(),
                signal: { ...envelope().signal, runStartedAt: '2026-08-24T13:00:00.000Z' },
              },
            }
          },
          exercise: ({ animation, envelope }) =>
            render(
              <PipelinePanel
                panel={{ ...panel, running_animation: animation }}
                envelope={envelope}
              />,
            ),
          verify: ({ container }) => {
            expect(container.querySelector('[data-overdue="true"]')).not.toBeNull()
            expect(container.textContent).toContain('Over estimate')
          },
        }),
      )
  })
})

describe('source evidence presentation', () => {
  function evidence(
    overrides: Partial<import('@ze-great-dashboard/shared/browser').PipelineStatus> = {},
  ) {
    return {
      panelId: panel.id,
      state: 'ok' as const,
      observedAt: '2026-08-28T12:00:00.000Z',
      link: 'https://github.com/example/repo/actions',
      signal: {
        type: 'pipeline-status' as const,
        status: 'passed' as const,
        rawStatus: 'success',
        name: panel.id,
        sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
        ...overrides,
      },
    }
  }
  test(
    'shows the duration of a completed run',
    mint({
      setup: () => ({ envelope: evidence({ durationMs: 134000 }) }),
      exercise: ({ envelope }) => render(<PipelinePanel panel={panel} envelope={envelope} />),
      verify: () => expect(screen.getByText('Took 2m 14s')).toBeTruthy(),
    }),
  )
  test(
    'omits duration for a still-running pipeline',
    mint({
      setup: () => ({ envelope: evidence({ status: 'running', durationMs: 134000 }) }),
      exercise: ({ envelope }) =>
        render(
          <PipelinePanel panel={{ ...panel, running_animation: 'off' }} envelope={envelope} />,
        ),
      verify: () => {
        expect(screen.getByText('Running')).toBeTruthy()
        expect(screen.queryByText(/Took/)).toBeNull()
      },
    }),
  )
  test(
    'shows the live activity rather than its raw status',
    mint({
      setup: () => ({
        envelope: evidence({
          status: 'running',
          rawStatus: 'in_progress',
          activity: { kind: 'step', name: 'integration tests', parent: 'build' },
        }),
      }),
      exercise: ({ envelope }) =>
        render(
          <PipelinePanel panel={{ ...panel, running_animation: 'off' }} envelope={envelope} />,
        ),
      verify: (_, { envelope }) => {
        expect(
          screen.getByText(
            `${envelope.signal.activity?.parent} › ${envelope.signal.activity?.name}`,
          ),
        ).toBeTruthy()
        expect(screen.queryByText('in_progress')).toBeNull()
      },
    }),
  )
  test(
    'discloses an unavailable estimate on an indeterminate active field',
    mint({
      setup: () => ({ envelope: evidence({ status: 'running', sourceUpdatedAt: undefined }) }),
      exercise: ({ envelope }) =>
        render(
          <PipelinePanel
            panel={{ ...panel, running_animation: 'telemetry-bloom' }}
            envelope={envelope}
          />,
        ),
      verify: ({ container }) => {
        expect(screen.getByText(/Expected duration unavailable/)).toBeTruthy()
        expect(
          container.querySelector('[data-running-field][data-indeterminate="true"]'),
        ).not.toBeNull()
      },
    }),
  )
  for (const scenario of [
    {
      kind: 'no-runs',
      message: 'No workflow runs found for branch "master".',
      heading: 'No workflow runs',
    },
    {
      kind: 'unauthorized',
      message: 'Token no longer grants workflow access.',
      heading: 'Access denied',
    },
  ] as const)
    test(
      `presents ${scenario.kind} without inventing an incident timestamp`,
      mint({
        setup: () => ({
          envelope: {
            panelId: panel.id,
            state: 'error' as const,
            observedAt: '2026-08-28T12:00:00.000Z',
            link: 'https://github.com/example/repo/actions',
            error: { kind: scenario.kind, message: scenario.message },
          },
          heading: scenario.heading,
        }),
        exercise: ({ envelope }) => render(<PipelinePanel panel={panel} envelope={envelope} />),
        verify: ({ container }, { envelope, heading }) => {
          expect(screen.getByText(heading)).toBeTruthy()
          expect(screen.getByText(envelope.error.message)).toBeTruthy()
          expect(
            screen
              .getByRole('link', { name: `View source for ${panel.id} (opens in a new tab)` })
              .getAttribute('href'),
          ).toBe(envelope.link)
          expect(container.textContent).not.toContain('Observed')
          expect(container.textContent).not.toContain('Checked')
        },
      }),
    )
  test(
    'retains the source action when the signal cannot be interpreted',
    mint({
      setup: () => ({
        envelope: {
          panelId: panel.id,
          state: 'ok' as const,
          observedAt: '2026-08-28T12:00:00.000Z',
          link: 'https://github.com/example/repo/actions',
          signal: { type: 'pipeline-status', status: 'surprising' },
        },
      }),
      exercise: ({ envelope }) => render(<PipelinePanel panel={panel} envelope={envelope} />),
      verify: (_, { envelope }) => {
        expect(screen.getByText('Invalid signal')).toBeTruthy()
        expect(
          screen
            .getByRole('link', { name: `View source for ${panel.id} (opens in a new tab)` })
            .getAttribute('href'),
        ).toBe(envelope.link)
      },
    }),
  )
})
