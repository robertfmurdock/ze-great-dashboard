import type { PipelineStatus } from '@ze-great-dashboard/shared/browser'

/**
 * The compact tile contract. These are primary scan symbols, so a glyph has one meaning here.
 * Secondary metadata may reuse familiar symbols only when it retains that same meaning.
 */
export const panelTypeSymbols = {
  'pipeline-status': { glyph: '▣', label: 'Pipeline status' },
  'pull-request-health': { glyph: '⌘', label: 'Pull request health' },
  'http-value': { glyph: '◌', label: 'HTTP value' },
  'pipeline-animation-demo': { glyph: '✦', label: 'Pipeline animation demo' },
} as const

/** Renderable client panel types are defined by the compact identity contract. */
export type RenderablePanelType = keyof typeof panelTypeSymbols

export const statusSymbols: Record<PipelineStatus['status'], { glyph: string; label: string }> = {
  passed: { glyph: '✓', label: 'Passed' },
  failed: { glyph: '✕', label: 'Failed' },
  warning: { glyph: '⚠', label: 'Warning' },
  running: { glyph: '↻', label: 'Running' },
  cancelled: { glyph: '⊘', label: 'Cancelled' },
  unknown: { glyph: '?', label: 'Unknown' },
}

export function panelTypeSymbol(type: string) {
  return panelTypeSymbols[type as keyof typeof panelTypeSymbols]
}

/** Every primary glyph and its single semantic meaning, useful for keeping the registry auditable. */
export const primarySymbolMeanings = [
  ...Object.entries(panelTypeSymbols).map(([type, symbol]) => ({
    glyph: symbol.glyph,
    meaning: `panel type: ${type}`,
  })),
  ...Object.entries(statusSymbols).map(([status, symbol]) => ({
    glyph: symbol.glyph,
    meaning: `status: ${status}`,
  })),
]
