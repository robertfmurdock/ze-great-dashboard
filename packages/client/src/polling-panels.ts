import type { Panel } from '@ze-great-dashboard/shared/browser'
import {
  type Board,
  type ClientEnv,
  isZeroPosition,
  resolvePollingSettings,
} from '@ze-great-dashboard/shared/browser'
import type { RemotePanelPolling } from './panel-feature.ts'
import { panelFeature } from './panel-registry.tsx'
import type { PollingScheduleSnapshot } from './polling-schedule.ts'

export { readUpdateWorkflows } from './update-workflows.ts'

export type PollingPanel = { panel: Panel; polling: RemotePanelPolling }

/** Visible remote features carry their registered polling behavior into the lifecycle. */
export function pollingPanels(board: Board): PollingPanel[] {
  return board.panels.flatMap((panel) => {
    if (isZeroPosition(panel.position)) return []
    const polling = panelFeature(panel.type)?.polling
    return polling && polling.kind !== 'local' ? [{ panel, polling }] : []
  })
}

export function panelProxyPath(env: ClientEnv, panelId: string) {
  return `${env.proxyPath}/panel/${encodeURIComponent(env.board)}/${encodeURIComponent(panelId)}`
}

/** Build the initial schedule without claiming branch-dependent fan-out before it is observed. */
export function initialPollingSchedule(
  board: Board,
  env: ClientEnv,
  { panel, polling }: PollingPanel,
): PollingScheduleSnapshot {
  const path = panelProxyPath(env, panel.id)
  const knownPaths = polling.initialPaths(panel, path)
  return {
    panelId: panel.id,
    label: panel.label ?? panel.id,
    settings: resolvePollingSettings(board, panel),
    cadence: 'normal',
    inFlight: false,
    knownPaths,
  }
}
