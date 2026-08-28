import type { Envelope, Panel } from '@ze-great-dashboard/shared'

export type PanelProps = {
  panel: Panel
  envelope: Envelope | undefined
  checkedAt?: string
}
