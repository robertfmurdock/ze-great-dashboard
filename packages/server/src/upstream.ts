import type { Envelope, ErrorKind } from '@ze-great-dashboard/shared'

/** The common result shape for a bounded source adapter. */
export type AdapterResult = { envelope?: Envelope; response: Response }

/** Preserve the browser's cache-validation conversation with the upstream source. */
export function forwardValidators(requestHeaders: Headers, upstreamHeaders: Headers) {
  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = requestHeaders.get(name)
    if (value) upstreamHeaders.set(name, value)
  }
}

export function observedAt(upstreamDate: string | null | undefined): string {
  const parsed = upstreamDate ? new Date(upstreamDate) : undefined
  return parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : new Date().toISOString()
}

export function upstreamErrorEnvelope(args: {
  panelId: string
  kind: ErrorKind
  error: unknown
  link: string | null
  upstreamDate?: string | null | undefined
}): Envelope {
  return {
    panelId: args.panelId,
    state: 'error',
    observedAt: observedAt(args.upstreamDate),
    link: args.link,
    error: {
      kind: args.kind,
      message: args.error instanceof Error ? args.error.message : String(args.error),
    },
  }
}

export function upstreamErrorResponse(envelope: Envelope): Response {
  return new Response(JSON.stringify(envelope), { status: 200 })
}

export function upstreamErrorKind(
  status: number,
): Extract<ErrorKind, 'unauthorized' | 'not-found' | 'upstream-error'> {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not-found'
  return 'upstream-error'
}

/** Relays only cache metadata whose semantics survive normalization. */
export async function adapterRouteResponse(result: AdapterResult): Promise<Response> {
  const headers = passthroughHeaders(result.response.headers)
  if (result.response.status === 304) return new Response(null, { status: 304, headers })
  const envelope = result.envelope ?? JSON.parse(await result.response.text())
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(envelope), { status: 200, headers })
}

function passthroughHeaders(upstream: Headers): Headers {
  const headers = new Headers()
  for (const name of ['cache-control', 'etag', 'last-modified', 'date', 'vary']) {
    const value = upstream.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}
