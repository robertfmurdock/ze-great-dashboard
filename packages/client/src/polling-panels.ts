import {
  type Board,
  type ClientEnv,
  isZeroPosition,
  resolvePollingSettings,
} from '@ze-great-dashboard/shared'
import type { PollingScheduleSnapshot } from './polling-schedule.ts'

type PollingPanel = Board['panels'][number] & {
  type: 'pipeline-status' | 'pull-request-health' | 'http-value'
}

/** The exact visible panel types that originate proxy polling in this client. */
export function pollingPanels(board: Board): PollingPanel[] {
  return board.panels.filter(
    (panel): panel is PollingPanel =>
      !isZeroPosition(panel.position) &&
      (panel.type === 'pipeline-status' ||
        panel.type === 'pull-request-health' ||
        panel.type === 'http-value'),
  )
}

export function panelProxyPath(env: ClientEnv, panelId: string) {
  return `${env.proxyPath}/panel/${encodeURIComponent(env.board)}/${encodeURIComponent(panelId)}`
}

/** Build the initial schedule without claiming branch-dependent fan-out before it is observed. */
export function initialPollingSchedule(
  board: Board,
  env: ClientEnv,
  panel: PollingPanel,
): PollingScheduleSnapshot {
  const path = panelProxyPath(env, panel.id)
  const knownPaths =
    panel.type === 'http-value' && panel.facts
      ? panel.facts.map((fact) => `${path}/facts/${encodeURIComponent(fact.id)}`)
      : panel.type === 'pull-request-health'
        ? [
            `${path}/pull-requests`,
            ...readUpdateWorkflows(panel).map(
              ({ workflow }) => `${path}/update-workflow/${encodeURIComponent(workflow)}`,
            ),
          ]
        : [path]
  return {
    panelId: panel.id,
    label: panel.label ?? panel.id,
    settings: resolvePollingSettings(board, panel),
    cadence: 'normal',
    inFlight: false,
    knownPaths,
  }
}

export function readUpdateWorkflows(panel: unknown) {
  const value =
    typeof panel === 'object' && panel !== null
      ? (panel as { update_workflows?: unknown }).update_workflows
      : undefined
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { workflow?: unknown }).workflow === 'string'
      ? [{ workflow: (entry as { workflow: string }).workflow }]
      : [],
  )
}
