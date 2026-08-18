export function ObservedAt({ value }: { value: string }) {
  const observed = new Date(value)
  const formatted = observed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const age = Date.now() - observed.getTime()
  const stale = age > 5 * 60 * 1000
  const ageText = formatAge(age)
  return (
    <p className={`panel__hint panel__observed${stale ? ' panel__observed--stale' : ''}`}>
      <span aria-hidden="true">◷</span> As of {formatted} · {ageText}
    </p>
  )
}

function formatAge(milliseconds: number) {
  if (milliseconds < 60_000) return 'just now'
  const minutes = Math.floor(milliseconds / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m ago`
}
