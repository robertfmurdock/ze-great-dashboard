import { mint } from '@continuous-excellence/testmints-js/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Envelope, Panel, PullRequestHealth } from '@ze-great-dashboard/shared/browser'
import { afterEach, describe, expect, test } from 'vitest'
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
  test(
    'renders status, workflow and pull-request evidence, the full summary, and freshness together',
    mint({
      setup: () => ({
        panel,
        envelope,
        summary: healthySignal.summary,
        sourceActionLabel: `View source for ${panel.id} (opens in a new tab)`,
      }),
      exercise: ({ panel, envelope }) =>
        render(<PullRequestHealthPanel panel={panel} envelope={envelope} />).container,
      verify: (rendered, { sourceActionLabel, summary }) => {
        expect(rendered.textContent).toContain('✓ Healthy')
        expect(
          rendered.querySelector('[data-panel-layout]')?.getAttribute('data-panel-layout'),
        ).toBe('status-band')
        expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain('1 workflow')
        expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain('0 open PRs')
        expect(rendered.textContent).toContain('Observed')
        expect(rendered.querySelector(`[title="${summary}"]`)?.textContent).toContain(
          'No open update PRs',
        )
        expect(rendered.querySelector('[data-compact-facts]')?.getAttribute('title')).toBe(summary)
        expect(screen.getByRole('link', { name: sourceActionLabel })).not.toBeNull()
        expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain(
          'Update workflows:',
        )
        expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain(
          'Open update pull requests:',
        )
      },
    }),
  )

  test(
    'keeps a failure actionable while preserving the detailed item text',
    mint({
      setup: () => {
        const pullRequest = {
          label: 'PR #42',
          status: 'failed' as const,
          detail: 'Checks failed',
          link: null,
        }
        return {
          panel,
          envelope: {
            ...envelope,
            signal: {
              ...healthySignal,
              status: 'failed',
              summary: '1 update workflow · 1 open update PR',
              pullRequests: [pullRequest],
            },
          } satisfies Envelope,
          pullRequest,
        }
      },
      exercise: ({ panel, envelope }) =>
        render(<PullRequestHealthPanel panel={panel} envelope={envelope} />).container,
      verify: (rendered, { pullRequest }) => {
        expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain(
          `${pullRequest.label} ${pullRequest.status}`,
        )
        expect(
          rendered.querySelector('[data-compact-facts]')?.querySelector('p')?.getAttribute('title'),
        ).toBe(pullRequest.detail)
        expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain(
          `Detail: ${pullRequest.detail}`,
        )
      },
    }),
  )

  test(
    'visibly presents warning evidence as a warning',
    mint({
      setup: () => {
        const pullRequest = {
          label: 'PR #42',
          status: 'warning' as const,
          detail: 'Checks had warnings',
          link: null,
        }
        return {
          panel,
          envelope: {
            ...envelope,
            signal: {
              ...healthySignal,
              status: 'warning',
              summary: `${pullRequest.label}: ${pullRequest.detail}`,
              pullRequests: [pullRequest],
            },
          } satisfies Envelope,
          pullRequest,
        }
      },
      exercise: ({ panel, envelope }) =>
        render(<PullRequestHealthPanel panel={panel} envelope={envelope} />).container,
      verify: (rendered, { pullRequest }) => {
        expect(rendered.textContent).toContain('⚠ Warning')
        expect(rendered.querySelector('[data-compact-facts]')?.textContent).toContain(
          `${pullRequest.label} ${pullRequest.status}`,
        )
        expect(rendered.textContent).toContain('Warning item:')
      },
    }),
  )
})
