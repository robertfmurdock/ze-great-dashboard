import type { PipelineStatus, PullRequestHealth } from '@ze-great-dashboard/shared'
import { describe, expect, it } from 'vitest'
import { formatCount } from '../src/panel-formatting.ts'
import { compactPullRequestHealthFacts } from '../src/pull-request-health.ts'
import { rollupPullRequestHealth } from '../src/pull-request-rollup.ts'

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

  it('identifies a warning item as needing attention without calling it failed', () => {
    expect(
      compactPullRequestHealthFacts(
        signal({
          status: 'warning',
          summary: 'Dependency update needs attention',
          pullRequests: [
            { label: 'PR #42', status: 'warning', detail: 'Checks had warnings', link: null },
          ],
        }),
      ),
    ).toMatchObject({
      primary: 'PR #42 warning',
      primaryKind: 'warning',
      primaryDetail: 'Checks had warnings',
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

describe('rollupPullRequestHealth', () => {
  it('uses the oldest component evidence and makes a missing build explicit without hiding successful evidence', () => {
    const workflow = {
      panelId: 'updates',
      state: 'ok' as const,
      observedAt: '2026-08-29T12:00:00.000Z',
      link: null,
      signal: {
        type: 'pull-request-workflow',
        workflow: 'updates.yml',
        item: { label: 'updates.yml', status: 'passed', detail: 'Passed', link: null },
      },
    }
    const candidates = {
      panelId: 'updates',
      state: 'ok' as const,
      observedAt: '2026-08-29T12:05:00.000Z',
      link: 'https://github.com/example/repo',
      signal: {
        type: 'pull-request-candidates',
        pullRequests: [
          { number: 42, branch: 'deps/42', link: 'https://github.com/example/repo/pull/42' },
        ],
      },
    }
    const result = rollupPullRequestHealth({
      panelId: 'updates',
      link: candidates.link,
      workflows: [{ workflow: 'updates.yml', observation: { envelope: workflow } }],
      candidates: { envelope: candidates },
      builds: new Map([['deps/42', { error: 'offline' }]]),
    })
    expect(result).toMatchObject({
      observedAt: workflow.observedAt,
      signal: {
        status: 'unknown',
        newestObservedAt: candidates.observedAt,
        pullRequests: [{ label: 'PR #42', status: 'unknown' }],
        incompleteObservations: [{ label: 'PR #42', message: 'offline' }],
      },
    })
  })

  it('marks a bounded candidate observation as incomplete instead of silently treating it as exhaustive', () => {
    const result = rollupPullRequestHealth({
      panelId: 'updates',
      link: 'https://github.com/example/repo',
      workflows: [],
      candidates: {
        envelope: {
          panelId: 'updates',
          state: 'ok',
          observedAt: '2026-08-29T12:00:00.000Z',
          link: 'https://github.com/example/repo',
          signal: { type: 'pull-request-candidates', pullRequests: [], truncated: true },
        },
      },
      builds: new Map(),
    })
    expect(result).toMatchObject({
      signal: { incompleteObservations: [{ label: 'Open update PR candidates' }] },
    })
  })

  it('ranks warning above running, unknown, cancelled, and passed', () => {
    const workflow = (status: PipelineStatus['status']) => ({
      panelId: 'updates',
      state: 'ok' as const,
      observedAt: '2026-08-29T12:00:00.000Z',
      link: null,
      signal: {
        type: 'pull-request-workflow' as const,
        workflow: `${status}.yml`,
        item: { label: `${status}.yml`, status, detail: status, link: null },
      },
    })
    const result = rollupPullRequestHealth({
      panelId: 'updates',
      link: null,
      workflows: [
        { workflow: 'warning.yml', observation: { envelope: workflow('warning') } },
        { workflow: 'running.yml', observation: { envelope: workflow('running') } },
        { workflow: 'unknown.yml', observation: { envelope: workflow('unknown') } },
        { workflow: 'cancelled.yml', observation: { envelope: workflow('cancelled') } },
      ],
      candidates: {
        envelope: {
          panelId: 'updates',
          state: 'ok',
          observedAt: '2026-08-29T12:00:00.000Z',
          link: null,
          signal: { type: 'pull-request-candidates', pullRequests: [] },
        },
      },
      builds: new Map(),
    })
    expect(result).toMatchObject({ signal: { status: 'warning', summary: 'warning.yml: warning' } })
  })

  it('ranks a failure above a warning', () => {
    const observation = (status: 'failed' | 'warning') => ({
      panelId: 'updates',
      state: 'ok' as const,
      observedAt: '2026-08-29T12:00:00.000Z',
      link: null,
      signal: {
        type: 'pull-request-workflow' as const,
        workflow: `${status}.yml`,
        item: { label: `${status}.yml`, status, detail: status, link: null },
      },
    })
    const result = rollupPullRequestHealth({
      panelId: 'updates',
      link: null,
      workflows: [
        { workflow: 'failed.yml', observation: { envelope: observation('failed') } },
        { workflow: 'warning.yml', observation: { envelope: observation('warning') } },
      ],
      candidates: {
        envelope: {
          panelId: 'updates',
          state: 'ok',
          observedAt: '2026-08-29T12:00:00.000Z',
          link: null,
          signal: { type: 'pull-request-candidates', pullRequests: [] },
        },
      },
      builds: new Map(),
    })
    expect(result).toMatchObject({ signal: { status: 'failed', summary: 'failed.yml: failed' } })
  })
})
