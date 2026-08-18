export function ObservedAt({ value }: { value: string }) {
  const formatted = new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return <p className="panel__hint">As of {formatted}</p>
}
