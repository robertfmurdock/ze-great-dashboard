import { render, screen } from '@testing-library/react'
import type { Panel } from '@ze-great-dashboard/shared/browser'
import { describe, expect, it } from 'vitest'
import { TestCountPanel } from '../src/TestCountPanel.tsx'

const panel: Panel = { id: 'tests', type: 'test-count' }

describe('TestCountPanel', () => {
  it('renders reported totals and never treats absent reporting as zero', () => {
    const { rerender } = render(
      <TestCountPanel
        panel={panel}
        envelope={{
          panelId: 'tests',
          state: 'ok',
          observedAt: '2026-10-27T12:00:00.000Z',
          link: 'https://github.com/example/repo/actions/runs/1',
          signal: {
            type: 'test-count',
            status: 'reported',
            total: 12,
            passed: 10,
            failed: 1,
            skipped: 1,
          },
        }}
      />,
    )
    expect(screen.getByText('12 tests')).toBeTruthy()
    rerender(
      <TestCountPanel
        panel={panel}
        envelope={{
          panelId: 'tests',
          state: 'ok',
          observedAt: '2026-10-27T12:00:00.000Z',
          link: 'https://github.com/example/repo/actions/runs/1',
          signal: { type: 'test-count', status: 'not-reported' },
        }}
      />,
    )
    expect(screen.getByText('No test results published')).toBeTruthy()
    expect(screen.queryByText('0 tests')).toBeNull()
  })
})
