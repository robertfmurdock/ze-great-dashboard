import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import type { TestEvidence } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { RunTestResults, TestOutcomeSummary } from '../src/TestEvidence.tsx'

const observedAt = '2026-11-02T15:00:00.000Z'

describe('run test evidence', () => {
  test(
    'renders totals with only nonzero exceptions',
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
      verify: ({ container }, { counts }) => {
        expect(container.textContent).toContain(
          `${counts.total} tests · ✕ ${counts.failed} failed · ↷ ${counts.skipped} skipped`,
        )
        expect(container.textContent).not.toContain('passed')
      },
    }),
  )
  describe('reported outcome summary', () => {
    const scenarios = [
      {
        name: 'all passing',
        counts: { total: 666, passed: 666, failed: 0, skipped: 0 },
        expected: '✓ 666 passed',
      },
      {
        name: 'failures',
        counts: { total: 12, passed: 10, failed: 2, skipped: 0 },
        expected: '12 tests · ✕ 2 failed',
      },
      {
        name: 'skips',
        counts: { total: 12, passed: 10, failed: 0, skipped: 2 },
        expected: '12 tests · ↷ 2 skipped',
      },
      {
        name: 'zero tests',
        counts: { total: 0, passed: 0, failed: 0, skipped: 0 },
        expected: '0 tests',
      },
      { name: 'total only', counts: { total: 1234 }, expected: `${(1234).toLocaleString()} tests` },
      { name: 'partial outcomes', counts: { total: 12, passed: 10 }, expected: '12 tests' },
    ] as const
    for (const scenario of scenarios) {
      test(
        scenario.name,
        mint({
          setup: () => ({
            tests: { type: 'test-count', status: 'reported', ...scenario.counts } as const,
            expected: scenario.expected,
          }),
          exercise: ({ tests }) => render(<TestOutcomeSummary tests={tests} />),
          verify: ({ container }, { expected }) => expect(container.textContent).toBe(expected),
        }),
      )
    }
  })
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
