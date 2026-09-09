import type { PipelineStatus } from '@ze-great-dashboard/shared'
import { statusSymbols } from './panel-symbols.ts'

export type PanelStatusKind = PipelineStatus['status']

export function statusPresentation(status: PanelStatusKind, passedLabel = 'Passed') {
  const presentation = statusSymbols[status]
  return status === 'passed' ? { ...presentation, label: passedLabel } : presentation
}
