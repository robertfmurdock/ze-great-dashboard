import type { BoardConfig, Panel, Source } from '@ze-great-dashboard/shared'
import { permittedAzureDevOpsCalls } from './adapters/azure-devops.ts'
import { permittedGithubActionsCalls } from './adapters/github-actions.ts'
import { permittedHttpValueCalls } from './adapters/http-value.ts'

/**
 * Security boundary: the browser names a configured panel, never a URL. Keep changes here small
 * and reviewed—the permitted upstream calls are the proxy's credential boundary.
 */
export const panelOperations = [
  'read',
  'pull-requests',
  'update-workflow',
  'pull-request-build',
] as const
export type PanelOperation = (typeof panelOperations)[number]

export function deriveAllowlist(config: BoardConfig): Map<string, Set<PanelOperation>> {
  const allowed = new Map<string, Set<PanelOperation>>()
  for (const [boardName, board] of Object.entries(config.boards)) {
    for (const panel of board.panels) {
      const source = panel.source ? config.sources[panel.source] : undefined
      const calls = callsFor(panel, source)
      if (calls) allowed.set(`${boardName}/${panel.id}`, new Set(['read']))
      if (panel.type === 'pull-request-health' && source?.type === 'github-actions') {
        // Named operations, not an aggregate declaration: the dynamic build branch is validated
        // at the route boundary against this configured panel's prefixes.
        allowed.set(
          `${boardName}/${panel.id}`,
          new Set(['pull-requests', 'update-workflow', 'pull-request-build']),
        )
      }
    }
  }
  return allowed
}

export function permitsPanelOperation(
  allowlist: Map<string, Set<PanelOperation>>,
  board: string,
  panel: string,
  operation: PanelOperation,
) {
  return allowlist.get(`${board}/${panel}`)?.has(operation) ?? false
}

function callsFor(panel: Panel, source: Source | undefined) {
  if (panel.type === 'pipeline-status' && source?.type === 'github-actions') {
    return permittedGithubActionsCalls(panel, source)
  }
  if (panel.type === 'pipeline-status' && source?.type === 'azure-devops') {
    return permittedAzureDevOpsCalls(panel, source)
  }
  if (panel.type === 'http-value') return permittedHttpValueCalls(panel)
  return undefined
}
