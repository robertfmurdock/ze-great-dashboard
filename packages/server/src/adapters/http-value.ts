import {
  type HttpValue,
  httpValueGroupedPanelSchema,
  httpValueScalarPanelSchema,
  type Panel,
} from '@ze-great-dashboard/shared'
import {
  type AdapterResult,
  forwardValidators,
  observedAt,
  publicLink,
  safeNetworkCode,
  upstreamErrorEnvelope,
  upstreamErrorKind,
  upstreamErrorResponse,
} from '../upstream.ts'
import type { PermittedCall } from './types.ts'

export function permittedHttpValueCalls(panel: Panel): PermittedCall[] {
  const grouped = httpValueGroupedPanelSchema.safeParse(panel)
  const urls = grouped.success
    ? grouped.data.facts.map((fact) => fact.url)
    : [httpValueScalarPanelSchema.parse(panel).url]
  return urls.map(permittedCall)
}

/** Resolves a stable grouped-fact address without ever accepting a browser-supplied URL. */
export function httpValueFact(panel: Panel, factId: string) {
  const grouped = httpValueGroupedPanelSchema.parse(panel)
  return grouped.facts.find((fact) => fact.id === factId)
}

export async function fetchHttpValue(args: {
  panel: Panel
  requestHeaders: Headers
  fetcher: typeof fetch
}): Promise<AdapterResult> {
  const panel = httpValueScalarPanelSchema.parse(args.panel)
  const [call] = permittedHttpValueCalls(args.panel)
  if (!call) throw new Error('http-value adapter declared no permitted call')
  forwardValidators(args.requestHeaders, call.headers)

  let upstream: Response
  try {
    upstream = await args.fetcher(call.url, { headers: call.headers })
  } catch (error) {
    return {
      response: errorResponse('unreachable', error, panel),
      failure: {
        kind: 'unreachable',
        ...(safeNetworkCode(error) ? { networkCode: safeNetworkCode(error) } : {}),
      },
    }
  }
  if (upstream.status === 304) return { response: upstream }
  if (!upstream.ok) {
    return {
      response: errorResponse(
        upstreamErrorKind(upstream.status),
        `${upstream.status} ${upstream.statusText}`,
        panel,
        upstream,
      ),
      failure: { kind: upstreamErrorKind(upstream.status), upstreamStatus: upstream.status },
    }
  }

  try {
    const text = await upstream.text()
    const value = panel.json_path
      ? extractJsonPath(JSON.parse(text), panel.json_path)
      : parseValue(text)
    const signal: HttpValue = { type: 'http-value', value }
    return {
      envelope: {
        panelId: panel.id,
        state: 'ok',
        observedAt: observedAt(upstream.headers.get('date')),
        link: publicLink(panel.link ?? panel.url),
        signal,
      },
      response: upstream,
    }
  } catch (error) {
    return {
      response: errorResponse('upstream-error', error, panel, upstream),
      failure: { kind: 'upstream-error', upstreamStatus: upstream.status },
    }
  }
}

/** Reads one configured fact. Grouping happens in the client so each source keeps its own cache contract. */
export async function fetchHttpValueFact(args: {
  panel: Panel
  factId: string
  requestHeaders: Headers
  fetcher: typeof fetch
}): Promise<AdapterResult> {
  const fact = httpValueFact(args.panel, args.factId)
  if (!fact) throw new Error(`http-value fact "${args.factId}" is not configured`)
  return fetchHttpValue({
    panel: { id: args.panel.id, type: 'http-value', url: fact.url, json_path: fact.json_path },
    requestHeaders: args.requestHeaders,
    fetcher: args.fetcher,
  })
}

function permittedCall(value: string): PermittedCall {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('http-value URLs must use http or https')
  return { url: url.toString(), headers: new Headers({ accept: 'application/json, text/plain' }) }
}

function parseValue(text: string): string | number | boolean {
  const trimmed = text.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed === 'string' || typeof parsed === 'number' || typeof parsed === 'boolean')
      return parsed
  } catch {
    // Plain text endpoints are valid http-value sources.
  }
  return trimmed
}

function extractJsonPath(value: unknown, path: string): string | number | boolean {
  let current = value
  const segments =
    path === '$'
      ? []
      : path
          .slice(1)
          .split(/\.|\[|\]/)
          .filter(Boolean)
  for (const segment of segments) {
    if (typeof current !== 'object' || current === null || !(segment in current))
      throw new Error(`JSON path ${path} was not found`)
    current = (current as Record<string, unknown>)[segment]
  }
  if (typeof current !== 'string' && typeof current !== 'number' && typeof current !== 'boolean') {
    throw new Error(`JSON path ${path} did not select a scalar value`)
  }
  return current
}

function errorResponse(
  kind: 'unreachable' | 'unauthorized' | 'not-found' | 'upstream-error',
  error: unknown,
  panel: ReturnType<typeof httpValueScalarPanelSchema.parse>,
  response?: Response,
): Response {
  return upstreamErrorResponse(
    upstreamErrorEnvelope({
      panelId: panel.id,
      kind,
      error,
      link: panel.link ?? panel.url,
      upstreamDate: response?.headers.get('date'),
    }),
  )
}
