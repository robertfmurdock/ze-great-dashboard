import type { ErrorKind } from '@ze-great-dashboard/shared'

export function errorPresentation(kind: ErrorKind) {
  switch (kind) {
    case 'unauthorized':
      return { label: 'Access denied', emphasis: 'serious' as const }
    case 'not-found':
      return { label: 'Source not found', emphasis: 'serious' as const }
    case 'unreachable':
    case 'upstream-error':
      return { label: 'Source unavailable', emphasis: 'serious' as const }
    case 'no-runs':
      return { label: 'No workflow runs', emphasis: 'warning' as const }
  }
}
