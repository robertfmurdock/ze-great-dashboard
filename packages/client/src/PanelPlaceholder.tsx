/**
 * A panel-shaped hole, so the grid can be looked at and argued with before any signal exists.
 * Replaced by real panels in Stage 2 — nothing here is meant to survive.
 */
export function PanelPlaceholder({
  label,
  hint,
  wide = false,
}: {
  label: string
  hint: string
  wide?: boolean
}) {
  return (
    <section className={wide ? 'panel panel--wide' : 'panel'}>
      <h2 className="panel__label">{label}</h2>
      <p className="panel__hint">{hint}</p>
    </section>
  )
}
