import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { PipelineAge, UpdateHealth } from '../src/TimeAge.tsx'

afterEach(() => vi.useRealTimers())
describe('source update age', () => {
  test(
    'uses the source timestamp instead of the browser observation',
    mint({
      setup: () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-28T12:10:00.000Z'))
        return {
          sourceUpdatedAt: '2026-08-28T11:00:00.000Z',
          observedAt: '2026-08-28T12:00:00.000Z',
          running: false,
        }
      },
      exercise: (props) => render(<PipelineAge {...props} />),
      verify: ({ container }) => {
        expect(container.textContent).toContain('Last update 1h 10m ago')
        expect(container.textContent).not.toContain('Checked')
      },
    }),
  )
})
describe('missed-update disclosure', () => {
  for (const scenario of [
    { consecutiveFailures: 1, label: 'Updates delayed' },
    { consecutiveFailures: 2, label: 'Updates delayed' },
    { consecutiveFailures: 3, label: 'Updates unavailable' },
  ])
    test(
      `labels ${scenario.consecutiveFailures} missed updates as ${scenario.label}`,
      mint({
        setup: () => {
          vi.useFakeTimers()
          const lastConfirmedAt = '2026-08-28T12:00:00.000Z'
          vi.setSystemTime(new Date(lastConfirmedAt))
          return {
            health: {
              consecutiveFailures: scenario.consecutiveFailures,
              message: 'offline',
              lastConfirmedAt,
            },
            label: scenario.label,
          }
        },
        exercise: ({ health }) => render(<UpdateHealth health={health} />),
        verify: ({ container }, { health, label }) => {
          expect(container.textContent).toContain(`${label} · ${health.message}`)
          expect(container.textContent).toContain('⚠')
          expect(container.textContent).toContain('Last confirmed just now')
        },
      }),
    )
})
