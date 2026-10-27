import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { TestCountPanel } from '../src/TestCountPanel.tsx'

const panel: Panel = { id: 'tests', type: 'test-count' }

describe('TestCountPanel', () => {
  test(
    'renders a reported total and its outcome evidence',
    mint({
      setup: () => {
        const total = 12
        const outcomes = { passed: 10, failed: 1, skipped: 1 }
        return {
          panel,
          total,
          outcomes,
          envelope: {
            panelId: panel.id,
            state: 'ok',
            observedAt: '2026-10-27T12:00:00.000Z',
            link: 'https://github.com/example/repo/actions/runs/1',
            signal: {
              type: 'test-count',
              status: 'reported',
              total,
              ...outcomes,
            },
          } satisfies Envelope,
        }
      },
      exercise: ({ panel, envelope }) =>
        render(<TestCountPanel panel={panel} envelope={envelope} />),
      verify: (_rendered, { total, outcomes }) => {
        expect(screen.getByText(`${total} tests`)).not.toBeNull()
        expect(
          screen.getByText(
            `${outcomes.passed} passed · ${outcomes.failed} failed · ${outcomes.skipped} skipped`,
          ),
        ).not.toBeNull()
      },
    }),
  )

  test(
    'discloses absent test reporting without treating it as zero',
    mint({
      setup: () => ({
        panel,
        noTestResultsLabel: 'No test results published',
        zeroTestsLabel: '0 tests',
        envelope: {
          panelId: panel.id,
          state: 'ok',
          observedAt: '2026-10-27T12:00:00.000Z',
          link: 'https://github.com/example/repo/actions/runs/1',
          signal: { type: 'test-count', status: 'not-reported' },
        } satisfies Envelope,
      }),
      exercise: ({ panel, envelope }) =>
        render(<TestCountPanel panel={panel} envelope={envelope} />),
      verify: (_rendered, { noTestResultsLabel, zeroTestsLabel }) => {
        expect(screen.getByText(noTestResultsLabel)).not.toBeNull()
        expect(screen.queryByText(zeroTestsLabel)).toBeNull()
      },
    }),
  )
})
