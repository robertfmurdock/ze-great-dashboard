import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import type { Board, Envelope } from '@ze-great-dashboard/shared/browser'
import { describe, expect } from 'vitest'
import { projectAttention } from '../src/attention.ts'

type AttentionInput = Parameters<typeof projectAttention>[0]

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

const nonAttentionStatuses = ['passed', 'warning', 'running', 'cancelled', 'unknown'] as const

describe('attention projection', () => {
  describe('unreadable panel and fact evidence', () => {
    mintTest('projects important failures, unreadable values, and grouped facts in board order', {
      setup: (): Pick<AttentionInput, 'signals' | 'factSignals'> => ({
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
      }),
      exercise: ({ signals, factSignals }) =>
        projectAttention({ board, signals, updateHealth: {}, factSignals }),
      verify: (drivers) => {
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
      },
    })
  })

  describe('pipeline states that do not need attention', () => {
    for (const status of nonAttentionStatuses) {
      mintTest(`excludes ${status} pipelines and unimportant failures`, {
        setup: () => ({
          signals: { build: pipeline('build', status), ordinary: pipeline('ordinary', 'failed') },
        }),
        exercise: ({ signals }) =>
          projectAttention({ board, signals, updateHealth: {}, factSignals: {} }),
        verify: (drivers) => expect(drivers).toEqual([]),
      })
    }
  })

  describe('missed updates', () => {
    mintTest('projects missed updates for an important panel', {
      setup: () => ({
        updateHealth: {
          build: {
            consecutiveFailures: 2,
            message: 'Request failed',
            lastConfirmedAt: '2026-09-11T12:00:00.000Z',
          },
        },
      }),
      exercise: ({ updateHealth }) =>
        projectAttention({ board, signals: {}, updateHealth, factSignals: {} }),
      verify: (drivers) => {
        expect(drivers).toMatchObject([
          { panelId: 'build', reason: 'Updates unavailable — Request failed' },
        ])
      },
    })
  })
})
