import { PanelMetadata } from './PanelFrame.tsx'
import type { PanelUpdateHealth } from './panel-props.ts'

export function ObservedAt({ value, label = 'Observed' }: { value: string; label?: string }) {
  return <TimeAge value={value} label={label} />
}

export function PipelineAge({
  sourceUpdatedAt,
  observedAt,
  running,
  runStartedAt,
}: {
  sourceUpdatedAt?: string
  observedAt: string
  running: boolean
  runStartedAt?: string
}) {
  if (running && runStartedAt) return <TimeAge value={runStartedAt} label="Started" />
  return (
    <TimeAge
      value={sourceUpdatedAt ?? observedAt}
      label={sourceUpdatedAt ? 'Last update' : 'Observed'}
    />
  )
}

export function UpdateHealth({ health }: { health: PanelUpdateHealth }) {
  const unavailable = health.consecutiveFailures >= 3
  const label = unavailable ? 'Updates unavailable' : 'Updates delayed'
  return (
    <>
      <PanelMetadata
        glyph="⚠"
        label={label}
        value={`${label} · ${health.message}`}
        title={health.message}
        emphasis={unavailable ? 'serious' : 'warning'}
      />
      <TimeAge value={health.lastConfirmedAt} label="Last confirmed" />
    </>
  )
}

function TimeAge({ value, label }: { value: string; label: string }) {
  const observed = new Date(value)
  const formatted = observed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const age = Date.now() - observed.getTime()
  const content = `${label} ${formatAge(age)}`
  return (
    <PanelMetadata
      glyph="◷"
      label={label}
      value={content}
      compact={{ kind: 'short-value', value: formatCompactAge(age) }}
      title={`${label} at ${formatted}`}
      observed
    />
  )
}

export function formatAge(milliseconds: number) {
  if (milliseconds < 60_000) return 'just now'
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}

function formatCompactAge(milliseconds: number) {
  if (milliseconds < 60_000) return 'now'
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}
