import type { Board, Envelope } from '@ze-great-dashboard/shared/browser'
import { describe, expect, it } from 'vitest'
import { projectAttention } from '../src/attention.ts'

const board: Board = {
  attention: { treatment: 'steady' },
  panels: [
    { id: 'build', label: 'Build', type: 'pipeline-status', attention: true },
    { id: 'version', type: 'http-value', attention: true },
    {
      id: 'libraries',
      type: 'http-value',
      attention: true,
      facts: [
        { id: 'api', label: 'API', url: 'https://example.com/api' },
        { id: 'web', label: 'Web', url: 'https://example.com/web' },
      ],
    },
    { id: 'ordinary', type: 'pipeline-status' },
  ],
}
const pipeline = (id: string, status: string): Envelope =>
  ({
    panelId: id,
    state: 'ok',
    observedAt: '2026-09-11T12:00:00.000Z',
    link: null,
    signal: { type: 'pipeline-status', status, rawStatus: status, name: id },
  }) as Envelope

describe('attention projection', () => {
  it('projects important failures, unreadable values, grouped facts, and missed updates in board order', () => {
    const drivers = projectAttention({
      board,
      signals: {
        build: pipeline('build', 'failed'),
        version: {
          panelId: 'version',
          state: 'ok',
          observedAt: '2026-09-11T12:00:00.000Z',
          link: null,
          signal: { unexpected: true },
        },
      },
      updateHealth: {},
      factSignals: {
        libraries: {
          api: { failure: 'Network down' },
          web: {
            envelope: {
              panelId: 'libraries',
              state: 'error',
              observedAt: '2026-09-11T12:00:00.000Z',
              link: null,
              error: { kind: 'unreachable', message: 'Timed out' },
            },
          },
        },
      },
    })
    expect(drivers).toEqual([
      { panelId: 'build', label: 'Build', reason: 'Pipeline failed' },
      { panelId: 'version', label: 'version', reason: 'Invalid value' },
      {
        panelId: 'libraries',
        label: 'libraries',
        factId: 'api',
        reason: 'API: Updates unavailable — Network down',
      },
      { panelId: 'libraries', label: 'libraries', factId: 'web', reason: 'Web: Timed out' },
    ])
  })

  it('clears on recovery and excludes loading, warning, running, cancelled, unknown, passed, and unimportant failures', () => {
    for (const status of ['passed', 'warning', 'running', 'cancelled', 'unknown'])
      expect(
        projectAttention({
          board,
          signals: { build: pipeline('build', status), ordinary: pipeline('ordinary', 'failed') },
          updateHealth: {},
          factSignals: {},
        }),
      ).toEqual([])
    expect(
      projectAttention({
        board,
        signals: {},
        updateHealth: {
          build: {
            consecutiveFailures: 2,
            message: 'Request failed',
            lastConfirmedAt: '2026-09-11T12:00:00.000Z',
          },
        },
        factSignals: {},
      }),
    ).toMatchObject([{ panelId: 'build', reason: 'Updates unavailable — Request failed' }])
  })
})
