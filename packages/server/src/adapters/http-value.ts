import type { Envelope, HttpValue, Panel } from '@ze-great-dashboard/shared'
import { z } from 'zod'
import type { PermittedCall } from './github-actions.ts'

const httpValuePanelSchema = z.object({
  id: z.string().min(1),
  type: z.literal('http-value'),
  url: z.url(),
  json_path: z
    .string()
    .regex(/^\$(?:\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\])*$/)
    .optional(),
  link: z.url().optional(),
})

export function permittedHttpValueCalls(panel: Panel): PermittedCall[] {
  const parsed = httpValuePanelSchema.parse(panel)
  const url = new URL(parsed.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('http-value URLs must use http or https')
  }
  return [{ url: url.toString(), headers: new Headers({ accept: 'application/json, text/plain' }) }]
}

export async function fetchHttpValue(args: {
  panel: Panel
  requestHeaders: Headers
  fetcher: typeof fetch
}): Promise<{ envelope?: Envelope; response: Response }> {
  const panel = httpValuePanelSchema.parse(args.panel)
  const [call] = permittedHttpValueCalls(args.panel)
  if (!call) throw new Error('http-value adapter declared no permitted call')
  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = args.requestHeaders.get(name)
    if (value) call.headers.set(name, value)
  }

  let upstream: Response
  try {
    upstream = await args.fetcher(call.url, { headers: call.headers })
  } catch (error) {
    return { response: errorResponse(errorEnvelope(panel.id, 'unreachable', error, panel)) }
  }
  if (upstream.status === 304) return { response: upstream }
  if (!upstream.ok) {
    const kind =
      upstream.status === 401 || upstream.status === 403
        ? 'unauthorized'
        : upstream.status === 404
          ? 'not-found'
          : 'upstream-error'
    return {
      response: errorResponse(
        errorEnvelope(panel.id, kind, `${upstream.status} ${upstream.statusText}`, panel, upstream),
      ),
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
        link: panel.link ?? panel.url,
        signal,
      },
      response: upstream,
    }
  } catch (error) {
    return {
      response: errorResponse(errorEnvelope(panel.id, 'upstream-error', error, panel, upstream)),
    }
  }
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

function errorResponse(envelope: Envelope): Response {
  return new Response(JSON.stringify(envelope), { status: 200 })
}

function errorEnvelope(
  panelId: string,
  kind: 'unreachable' | 'unauthorized' | 'not-found' | 'upstream-error',
  error: unknown,
  panel: z.infer<typeof httpValuePanelSchema>,
  response?: Response,
): Envelope {
  return {
    panelId,
    state: 'error',
    observedAt: observedAt(response?.headers.get('date') ?? null),
    link: panel.link ?? panel.url,
    error: { kind, message: error instanceof Error ? error.message : String(error) },
  }
}

function observedAt(value: string | null): string {
  const parsed = value ? new Date(value) : undefined
  return parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : new Date().toISOString()
}
