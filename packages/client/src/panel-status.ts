import type { PipelineStatus } from '@ze-great-dashboard/shared'

export type PanelStatusKind = PipelineStatus['status']

export function statusPresentation(status: PanelStatusKind, passedLabel = 'Passed') {
  switch (status) {
    case 'passed':
      return { glyph: '✓', label: passedLabel }
    case 'failed':
      return { glyph: '✕', label: 'Failed' }
    case 'warning':
      return { glyph: '⚠', label: 'Warning' }
    case 'running':
      return { glyph: '↻', label: 'Running' }
    case 'cancelled':
      return { glyph: '⊘', label: 'Cancelled' }
    case 'unknown':
      return { glyph: '?', label: 'Unknown' }
  }
}
