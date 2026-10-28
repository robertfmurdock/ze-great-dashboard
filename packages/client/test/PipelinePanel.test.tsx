import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import type { Panel } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test, vi } from 'vitest'
import { PipelinePanel } from '../src/PipelinePanel.tsx'

const panel: Panel = { id: 'build', type: 'pipeline-status' }

describe('PipelinePanel', () => {
  test(
    'discloses a GitHub-rejected older response as historical evidence, not loading or attention',
    mint({
      setup: ({ scope }) => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-08-28T12:00:00.000Z'))
        scope.defer('restore real timers', () => vi.useRealTimers())
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
