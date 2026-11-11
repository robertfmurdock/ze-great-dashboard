import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { boardConfigSchema } from '../../src/board-config.ts'
import { parseDuration } from '../../src/duration.ts'
import { resolvePollingSettings } from '../../src/polling-policy.ts'

const pollingConfig = {
  boards: {
    a: {
      refresh: '60s',
      running_refresh: '15s',
      running_completion_refresh: '5s',
      running_completion_window: '2m',
      panels: [
        {
          id: 'build',
          type: 'pipeline-status',
          running_refresh: '10s',
          running_completion_window: '1m',
        },
      ],
    },
  },
}

describe('polling policy resolution', () => {
  test(
    'preserves board durations and panel overrides during validation',
    mint({
      setup: () => ({ config: pollingConfig }),
      exercise: ({ config }) => boardConfigSchema.parse(config),
      verify: (result, { config }) => expect(result.boards.a).toMatchObject(config.boards.a),
    }),
  )

  test(
    'resolves panel overrides before board polling settings',
    mint({
      setup: () => {
        const board = boardConfigSchema.parse(pollingConfig).boards.a
        if (!board) throw new Error('Expected board fixture')
        const panel = board.panels[0]
        if (!panel) throw new Error('Expected panel fixture')
        return {
          board,
          panel,
          expectedSettings: {
            refreshMillis: 60_000,
            runningRefreshMillis: 10_000,
            runningCompletionRefreshMillis: 5_000,
            runningCompletionWindowMillis: 60_000,
          },
        }
      },
      exercise: ({ board, panel }) => resolvePollingSettings(board, panel),
      verify: (settings, { expectedSettings }) => expect(settings).toEqual(expectedSettings),
    }),
  )

  const scenarios = [
    { name: 'panel override', boardRefresh: '200ms', panelRefresh: '100ms', expectedMillis: 100 },
    { name: 'board default', boardRefresh: '200ms', panelRefresh: undefined, expectedMillis: 200 },
    {
      name: 'product default',
      boardRefresh: undefined,
      panelRefresh: undefined,
      expectedMillis: 60_000,
    },
  ]
  for (const scenario of scenarios) {
    test(
      `uses the ${scenario.name}`,
      mint({
        setup: () => ({
          board: boardConfigSchema.parse({
            boards: {
              a: {
                refresh: scenario.boardRefresh,
                panels: [{ id: 'build', type: 'pipeline-status', refresh: scenario.panelRefresh }],
              },
            },
          }).boards.a,
          expectedMillis: scenario.expectedMillis,
        }),
        exercise: ({ board }) => {
          const panel = board?.panels[0]
          if (!board || !panel) throw new Error('Expected polling fixture')
          return resolvePollingSettings(board, panel)
        },
        verify: (settings, { expectedMillis }) =>
          expect(settings.refreshMillis).toBe(expectedMillis),
      }),
    )
  }
})

describe('duration parsing', () => {
  const acceptedDurations = [
    { input: '500ms', expectedMillis: 500 },
    { input: '30s', expectedMillis: 30_000 },
    { input: '5m', expectedMillis: 300_000 },
    { input: '1h', expectedMillis: 3_600_000 },
  ]
  for (const scenario of acceptedDurations) {
    test(
      `reads ${scenario.input} in milliseconds`,
      mint({
        setup: () => scenario,
        exercise: ({ input }) => parseDuration(input),
        verify: (millis, { expectedMillis }) => expect(millis).toBe(expectedMillis),
      }),
    )
  }

  for (const input of ['', 'soon', '30', '-5s', '0s', '5 s', '5S', '1d']) {
    test(
      `rejects the invalid duration ${JSON.stringify(input)}`,
      mint({
        setup: () => ({ input }),
        exercise: ({ input }) => parseDuration(input),
        verify: (millis) => expect(millis).toBeNull(),
      }),
    )
  }
})
