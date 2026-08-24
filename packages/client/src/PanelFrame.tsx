import type { Envelope, Panel } from '@ze-great-dashboard/shared'
import type { ReactNode } from 'react'
import { panelLayout } from './panel-layout.ts'

export function PanelFrame({
  panel,
  envelope,
  error = false,
  children,
}: {
  panel: Panel
  envelope?: Envelope
  error?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={error ? 'panel panel--error' : 'panel'}
      style={panelLayout(panel)}
      aria-busy={envelope ? undefined : true}
    >
      <h2 className="panel__label">{panel.id}</h2>
      {children}
      <PanelSourceLink panelId={panel.id} link={envelope?.link} />
    </section>
  )
}

function PanelSourceLink({ panelId, link }: { panelId: string; link?: string | null }) {
  if (!link) return null

  return (
    <a
      className="panel__link"
      href={link}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`View source for ${panelId} (opens in a new tab)`}
    >
      View source <span aria-hidden="true">↗</span>
    </a>
  )
}
