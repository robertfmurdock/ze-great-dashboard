import { cleanup, render } from '@testing-library/react'
import type { Envelope, Panel, PullRequestHealth } from '@ze-great-dashboard/shared'
import { afterEach, describe, expect, it } from 'vitest'
import { PullRequestHealthPanel } from '../src/PullRequestHealthPanel.tsx'

const panel: Panel = {
  id: 'updates',
  type: 'pull-request-health',
  label: 'Updates',
  density: 'compact',
  position: { x: 0, y: 0, w: 1, h: 3 },
}

const healthySignal: PullRequestHealth = {
  type: 'pull-request-health',
  status: 'passed',
  summary: '1 update workflow · No open update PRs',
  workflows: [{ label: 'build', status: 'passed', detail: 'Passed', link: null }],
  pullRequests: [],
}

const envelope: Envelope = {
  panelId: 'updates',
  state: 'ok',
  observedAt: '2026-08-29T12:00:00.000Z',
  link: 'https://github.com/example/repo/actions',
  signal: healthySignal,
}

afterEach(cleanup)

describe('PullRequestHealthPanel', () => {
  it('renders the aggregate status, compact facts, and full summary together', () => {
    const rendered = render(<PullRequestHealthPanel panel={panel} envelope={envelope} />).container

    expect(rendered.textContent).toContain('✓ Healthy')
    expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain('1 workflow')
    expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain('0 open PRs')
    expect(
      rendered.querySelector('[title="1 update workflow · No open update PRs"]')?.textContent,
    ).toContain('No open update PRs')
    expect(rendered.querySelector('[data-compact-facts]')?.getAttribute('title')).toBe(
      '1 update workflow · No open update PRs',
    )
  })

  it('keeps a failure actionable while preserving the detailed item text', () => {
    const rendered = render(
      <PullRequestHealthPanel
        panel={panel}
        envelope={{
          ...envelope,
          signal: {
            ...healthySignal,
            status: 'failed',
            summary: '1 update workflow · 1 open update PR',
            pullRequests: [
              { label: 'PR #42', status: 'failed', detail: 'Checks failed', link: null },
            ],
          },
        }}
      />,
    ).container

    expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain('PR #42 failed')
    expect(
      rendered.querySelector('[data-compact-facts]')?.querySelector('p')?.getAttribute('title'),
    ).toBe('Checks failed')
  })
})
