import type { PullRequestHealth } from '@ze-great-dashboard/shared'
import { describe, expect, it } from 'vitest'
import { formatCount } from '../src/panel-formatting.ts'
import { compactPullRequestHealthFacts } from '../src/pull-request-health.ts'

const signal = (overrides: Partial<PullRequestHealth> = {}): PullRequestHealth => ({
  type: 'pull-request-health',
  status: 'passed',
  summary: '1 update workflow · No open update PRs',
  workflows: [{ label: 'build', status: 'passed', detail: 'Passed', link: null }],
  pullRequests: [],
  ...overrides,
})

describe('compactPullRequestHealthFacts', () => {
  it('formats healthy single-item counts', () => {
    expect(compactPullRequestHealthFacts(signal())).toMatchObject({
      primary: '1 workflow',
      secondary: '0 open PRs',
      workflow: '1 workflow',
      pullRequests: '0 open PRs',
      title: '1 update workflow · No open update PRs',
    })
  })

  it('formats plural workflow and pull-request counts', () => {
    expect(
      compactPullRequestHealthFacts(
        signal({
          summary: '2 update workflows · 1 open update PR',
          workflows: [
            { label: 'build', status: 'passed', detail: 'Passed', link: null },
            { label: 'test', status: 'passed', detail: 'Passed', link: null },
          ],
          pullRequests: [{ label: 'PR #42', status: 'passed', detail: 'Open', link: null }],
        }),
      ),
    ).toMatchObject({
      primary: '2 workflows',
      secondary: '1 open PR',
      workflow: '2 workflows',
      pullRequests: '1 open PR',
    })
  })

  it('keeps the failing item actionable and retains its detail in the title', () => {
    expect(
      compactPullRequestHealthFacts(
        signal({
          status: 'failed',
          summary: '1 update workflow · 1 open update PR',
          pullRequests: [
            { label: 'PR #42', status: 'failed', detail: 'Checks failed', link: null },
          ],
        }),
      ),
    ).toMatchObject({
      primary: 'PR #42 failed',
      secondary: '1 workflow · 1 open PR',
      workflow: '1 workflow',
      pullRequests: '1 open PR',
      primaryDetail: 'Checks failed',
      title: '1 update workflow · 1 open update PR — PR #42: Checks failed',
    })
  })
})

describe('formatCount', () => {
  it('uses singular and plural labels without branching at call sites', () => {
    expect(formatCount(1, 'workflow')).toBe('1 workflow')
    expect(formatCount(2, 'workflow')).toBe('2 workflows')
    expect(formatCount(2, 'open PR')).toBe('2 open PRs')
  })
})
