import type { PipelineStatus } from '@ze-great-dashboard/shared/browser'

import { panelFeature, panelFeatures } from './panel-registry.tsx'

export const statusSymbols: Record<PipelineStatus['status'], { glyph: string; label: string }> = {
  passed: { glyph: '✓', label: 'Passed' },
  failed: { glyph: '✕', label: 'Failed' },
  warning: { glyph: '⚠', label: 'Warning' },
  running: { glyph: '↻', label: 'Running' },
  cancelled: { glyph: '⊘', label: 'Cancelled' },
  unknown: { glyph: '?', label: 'Unknown' },
}

export function panelTypeSymbol(type: string) {
  return panelFeature(type)?.symbol
}

/** Every primary glyph and its single semantic meaning, useful for keeping the registry auditable. */
export function primarySymbolMeanings() {
  return [
    ...Object.entries(panelFeatures).map(([type, { symbol }]) => ({
      glyph: symbol.glyph,
      meaning: `panel type: ${type}`,
    })),
    ...Object.entries(statusSymbols).map(([status, symbol]) => ({
      glyph: symbol.glyph,
      meaning: `status: ${status}`,
    })),
  ]
}
