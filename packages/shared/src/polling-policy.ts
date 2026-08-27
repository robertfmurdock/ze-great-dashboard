import type { Board, Panel } from './board-config.ts'
import { parseDuration } from './duration.ts'

/** Product defaults for panel polling. Board authors may override each value. */
export const pollingDefaults = {
  refreshMillis: 60_000,
  runningRefreshMillis: 15_000,
  runningCompletionRefreshMillis: 5_000,
  runningCompletionWindowMillis: 120_000,
} as const

export type PollingSettings = {
  refreshMillis: number
  runningRefreshMillis: number
  runningCompletionRefreshMillis: number
  runningCompletionWindowMillis: number
}

/** Resolve polling policy from panel override, board default, then product default. */
export function resolvePollingSettings(board: Board, panel: Panel): PollingSettings {
  const duration = (value: string | undefined, fallback: number) =>
    parseDuration(value ?? '') ?? fallback
  const panelValue = (
    key: keyof Pick<
      Panel,
      'refresh' | 'running_refresh' | 'running_completion_refresh' | 'running_completion_window'
    >,
    boardValue: keyof Pick<
      Board,
      'refresh' | 'running_refresh' | 'running_completion_refresh' | 'running_completion_window'
    >,
    fallback: number,
  ) => duration(panel[key], duration(board[boardValue], fallback))

  return {
    refreshMillis: panelValue('refresh', 'refresh', pollingDefaults.refreshMillis),
    runningRefreshMillis: panelValue(
      'running_refresh',
      'running_refresh',
      pollingDefaults.runningRefreshMillis,
    ),
    runningCompletionRefreshMillis: panelValue(
      'running_completion_refresh',
      'running_completion_refresh',
      pollingDefaults.runningCompletionRefreshMillis,
    ),
    runningCompletionWindowMillis: panelValue(
      'running_completion_window',
      'running_completion_window',
      pollingDefaults.runningCompletionWindowMillis,
    ),
  }
}
