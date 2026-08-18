import type { Panel } from '@ze-great-dashboard/shared'
import type { CSSProperties } from 'react'

/** Convert the advisory board position into CSS grid placement. */
export function panelLayout(panel: Panel): CSSProperties | undefined {
  const position = panel.position
  if (!position) return undefined

  return {
    '--panel-column': `${position.x + 1} / span ${position.w}`,
    '--panel-row': `${position.y + 1} / span ${position.h}`,
  } as CSSProperties
}
