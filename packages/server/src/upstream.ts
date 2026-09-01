import type { Envelope, ErrorKind } from '@ze-great-dashboard/shared'

/** The common result shape for a bounded source adapter. */
export type AdapterFailure = {
  kind: ErrorKind
  /** The upstream status is safe operational evidence; response bodies are never retained. */
  upstreamStatus?: number
  /** Only known transport codes are retained, never an arbitrary exception property. */
  networkCode?: 'ECONNREFUSED' | 'ENOTFOUND' | 'ETIMEDOUT' | 'EAI_AGAIN'
}

export type AdapterResult = { envelope?: Envelope; response: Response; failure?: AdapterFailure }
export type AdaptedRouteResponse = { response: Response; envelope?: Envelope }

export function publicErrorMessage(kind: ErrorKind): string {
  switch (kind) {
    case 'unreachable':
      return 'The source could not be reached. Check its address and network connectivity.'
    case 'unauthorized':
      return 'The dashboard is not authorized to read this source. Check the configured access.'
    case 'not-found':
      return 'The configured source was not found. Check the board configuration.'
    case 'no-runs':
      return 'No matching workflow runs were found. Check the configured workflow and branch.'
    case 'upstream-error':
      return 'The source returned an unreadable response. Check the source service and configuration.'
  }
}

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
    link: publicLink(args.link),
    error: {
      kind: args.kind,
      // Raw failures regularly contain URLs, query values, response fragments, or credentials.
      // The specific evidence stays server-side; the browser gets this fixed actionable vocabulary.
      message: publicErrorMessage(args.kind),
    },
  }
}

/** Dashboard links are useful evidence, but query strings can carry credentials or identifiers. */
export function publicLink(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
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
export async function adapterRouteResponse(result: AdapterResult): Promise<AdaptedRouteResponse> {
  const headers = passthroughHeaders(result.response.headers)
  if (result.response.status === 304)
    return { response: new Response(null, { status: 304, headers }) }
  const envelope = result.envelope ?? JSON.parse(await result.response.text())
  headers.set('content-type', 'application/json; charset=utf-8')
  return { response: new Response(JSON.stringify(envelope), { status: 200, headers }), envelope }
}

export function safeNetworkCode(error: unknown): AdapterFailure['networkCode'] | undefined {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EAI_AGAIN'
    ? code
    : undefined
}

function passthroughHeaders(upstream: Headers): Headers {
  const headers = new Headers()
  for (const name of ['cache-control', 'etag', 'last-modified', 'date', 'vary']) {
    const value = upstream.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}
