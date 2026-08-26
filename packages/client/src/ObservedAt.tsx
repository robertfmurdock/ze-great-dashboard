import { PanelObserved } from './PanelFrame.tsx'

export function ObservedAt({ value, label = 'As of' }: { value: string; label?: string }) {
  const observed = new Date(value)
  const formatted = observed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const age = Date.now() - observed.getTime()
  const stale = age > 5 * 60 * 1000
  const ageText = formatAge(age)
  return (
    <PanelObserved stale={stale}>
      <span aria-hidden="true">◷</span> {label} {formatted} · {ageText}
    </PanelObserved>
  )
}

export function formatAge(milliseconds: number) {
  if (milliseconds < 60_000) return 'just now'
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}
