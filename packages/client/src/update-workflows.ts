export function readUpdateWorkflows(panel: unknown) {
  const value =
    typeof panel === 'object' && panel !== null
      ? (panel as { update_workflows?: unknown }).update_workflows
      : undefined
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { workflow?: unknown }).workflow === 'string'
      ? [{ workflow: (entry as { workflow: string }).workflow }]
      : [],
  )
}
