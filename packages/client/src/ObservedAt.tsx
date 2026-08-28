import { PanelMetadata } from './PanelFrame.tsx'

export function ObservedAt({ value, label = 'As of' }: { value: string; label?: string }) {
  return <TimeAge value={value} label={label} stale variant="clock" />
}

export function CheckedAt({ value }: { value: string }) {
  return <TimeAge value={value} stale label="Checked" variant="age" />
}

export function RunAge({ value, running }: { value: string; running: boolean }) {
  return <TimeAge value={value} label={running ? 'Started' : 'Run updated'} variant="age" />
}

function TimeAge({
  value,
  label,
  stale = false,
  variant,
}: {
  value: string
  label: string
  stale?: boolean
  variant: 'clock' | 'age'
}) {
  const observed = new Date(value)
  const formatted = observed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const age = Date.now() - observed.getTime()
  const content =
    variant === 'clock' ? `${label} ${formatted} · ${formatAge(age)}` : `${label} ${formatAge(age)}`
  return (
    <PanelMetadata
      glyph="◷"
      label={label}
      value={content}
      title={`${label} at ${formatted}`}
      observed
      stale={stale}
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
