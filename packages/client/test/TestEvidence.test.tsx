import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import type { TestEvidence } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { RunTestResults } from '../src/TestEvidence.tsx'

const observedAt = '2026-11-02T15:00:00.000Z'

describe('run test evidence', () => {
  test(
    'renders totals with every supplied outcome',
    mint({
      setup: () => {
        const counts = { total: 37, passed: 35, failed: 1, skipped: 1 }
        return {
          counts,
          envelope: {
            state: 'ok',
            observedAt,
            signal: { type: 'test-count', status: 'reported', ...counts },
          } satisfies TestEvidence,
        }
      },
      exercise: ({ envelope }) => render(<RunTestResults envelope={envelope} />),
      verify: (_result, { counts }) =>
        expect(
          screen.getByText(
            `${counts.total} tests · ${counts.passed} passed · ${counts.failed} failed · ${counts.skipped} skipped`,
          ),
        ).toBeTruthy(),
    }),
  )
  test(
    'leaves unreported outcome breakdowns absent',
    mint({
      setup: () => {
        const total = 0
        return {
          total,
          envelope: {
            state: 'ok',
            observedAt,
            signal: { type: 'test-count', status: 'reported', total },
          } satisfies TestEvidence,
        }
      },
      exercise: ({ envelope }) => render(<RunTestResults envelope={envelope} />),
      verify: (_result, { total }) => {
        expect(screen.getByText(`${total} tests`)).toBeTruthy()
        expect(screen.queryByText(/\d+ (passed|failed|skipped)/)).toBeNull()
      },
    }),
  )
  const messages = [
    { name: 'pending evidence', status: 'pending', label: 'Tests pending' },
    { name: 'absent reporting', status: 'not-reported', label: 'No test results published' },
  ] as const
  for (const scenario of messages) {
    test(
      scenario.name,
      mint({
        setup: () => ({
          label: scenario.label,
          envelope: {
            state: 'ok',
            observedAt,
            signal: { type: 'test-count', status: scenario.status },
          } satisfies TestEvidence,
        }),
        exercise: ({ envelope }) => render(<RunTestResults envelope={envelope} />),
        verify: (_result, { label }) => expect(screen.getByText(label)).toBeTruthy(),
      }),
    )
  }
  test(
    'discloses unavailable evidence and its reason',
    mint({
      setup: () => {
        const error = { kind: 'upstream-error', message: 'Artifact expired' } as const
        return { error, envelope: { state: 'error', observedAt, error } satisfies TestEvidence }
      },
      exercise: ({ envelope }) => render(<RunTestResults envelope={envelope} />),
      verify: (_result, { error }) =>
        expect(screen.getByText(`Test results unavailable: ${error.message}`)).toBeTruthy(),
    }),
  )
})
