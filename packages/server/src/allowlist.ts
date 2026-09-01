import type { BoardConfig, Panel, Source } from '@ze-great-dashboard/shared'
import { permittedAzureDevOpsCalls } from './adapters/azure-devops.ts'
import {
  permittedGithubActionsCalls,
  pullRequestHealthCapabilities,
} from './adapters/github-actions.ts'
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
type PanelCapability =
  | { kind: 'server'; operations: readonly PanelOperation[] }
  | { kind: 'client-only' }
  | { kind: 'unsupported' }

/**
 * Builds the production allowlist while proving every panel is either explicitly client-only or
 * maps to bounded server operations. This stays beside the allowlist because an adapter that
 * cannot declare a bounded call must not become a browser-addressable panel.
 */
export function deriveValidatedAllowlist(config: BoardConfig): Map<string, Set<PanelOperation>> {
  return derive(config, true)
}

/**
 * Lightweight construction for isolated app tests. Production uses `deriveValidatedAllowlist` at
 * startup; this fallback preserves tests that intentionally render presentation-only panel types.
 */
export function deriveAllowlist(config: BoardConfig): Map<string, Set<PanelOperation>> {
  return derive(config, false)
}

function derive(config: BoardConfig, rejectUnsupported: boolean): Map<string, Set<PanelOperation>> {
  const allowed = new Map<string, Set<PanelOperation>>()
  for (const [boardName, board] of Object.entries(config.boards)) {
    for (const panel of board.panels) {
      const source = panel.source ? config.sources[panel.source] : undefined
      try {
        const capability = panelCapability(panel, source)
        if (capability.kind === 'unsupported') {
          if (rejectUnsupported) throw new Error('no bounded operations')
          continue
        }
        if (capability.kind === 'server')
          allowed.set(`${boardName}/${panel.id}`, new Set(capability.operations))
      } catch (error) {
        if (rejectUnsupported) throw unsupportedPanelOperation(boardName, panel, source, error)
        throw error
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

function panelCapability(panel: Panel, source: Source | undefined): PanelCapability {
  if (panel.type === 'pipeline-status' && source?.type === 'github-actions') {
    permittedGithubActionsCalls(panel, source)
    return { kind: 'server', operations: ['read'] }
  }
  if (panel.type === 'pipeline-status' && source?.type === 'azure-devops') {
    permittedAzureDevOpsCalls(panel, source)
    return { kind: 'server', operations: ['read'] }
  }
  if (panel.type === 'http-value') {
    permittedHttpValueCalls(panel)
    return { kind: 'server', operations: ['read'] }
  }
  if (panel.type === 'pull-request-health' && source?.type === 'github-actions') {
    // Parsing here proves this panel's dynamic request capabilities are bounded before startup.
    pullRequestHealthCapabilities(panel)
    return {
      kind: 'server',
      operations: ['pull-requests', 'update-workflow', 'pull-request-build'],
    }
  }
  // This visualization aid makes no proxy request; keeping it explicit prevents it becoming an
  // accidental exemption for future unknown panels.
  if (panel.type === 'pipeline-animation-demo') return { kind: 'client-only' }
  return { kind: 'unsupported' }
}

function unsupportedPanelOperation(
  boardName: string,
  panel: Panel,
  source: Source | undefined,
  error: unknown,
): Error {
  const sourceName = panel.source ?? '(none)'
  const sourceType = source?.type ?? '(none)'
  const detail =
    error instanceof Error && error.message !== 'no bounded operations' ? ` ${error.message}` : ''
  return new Error(
    `Unsupported configured panel operation: board "${boardName}", panel "${panel.id}", source "${sourceName}" (${sourceType}), signal "${panel.type}".${detail}`,
  )
}
