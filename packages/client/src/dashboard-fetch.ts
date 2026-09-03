import type { ClientEnv } from '@ze-great-dashboard/shared'
import { clientReleaseVersion } from './release-version.ts'

/**
 * Adds browser-supplied diagnostic claims to same-origin dashboard API requests. These headers
 * are deliberately not credentials or authorization inputs: the server treats them as untrusted
 * evidence and normalizes only safe values before logging.
 */
export function dashboardFetch(
  env: ClientEnv,
  input: RequestInfo | URL,
  init?: RequestInit,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('X-Dashboard-Client-Version', clientReleaseVersion)
  headers.set('X-Dashboard-Client-Origin', globalThis.window.location.origin)
  headers.set('X-Dashboard-Client-Asset-Id', env.assetPathId)
  return fetcher(input, { ...init, headers })
}
