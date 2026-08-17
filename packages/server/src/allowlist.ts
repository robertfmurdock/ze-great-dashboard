import type { BoardConfig, Panel, Source } from '@ze-great-dashboard/shared'
import { type PermittedCall, permittedGithubActionsCalls } from './adapters/github-actions.ts'

/**
 * Security boundary: the browser names a configured panel, never a URL. Keep changes here small
 * and reviewed—the permitted upstream calls are the proxy's credential boundary.
 */
export function deriveAllowlist(config: BoardConfig): Map<string, PermittedCall[]> {
  const allowed = new Map<string, PermittedCall[]>()
  for (const [boardName, board] of Object.entries(config.boards)) {
    for (const panel of board.panels) {
      const source = panel.source ? config.sources[panel.source] : undefined
      if (!source) continue
      const calls = callsFor(panel, source)
      if (calls) allowed.set(`${boardName}/${panel.id}`, calls)
    }
  }
  return allowed
}

function callsFor(panel: Panel, source: Source): PermittedCall[] | undefined {
  if (panel.type === 'pipeline-status' && source.type === 'github-actions') {
    return permittedGithubActionsCalls(panel, source)
  }
  return undefined
}
