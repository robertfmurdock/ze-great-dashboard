import { type Envelope, envelopeSchema } from '@ze-great-dashboard/shared'
import { cacheMetadata, type DiagnosticSink } from './diagnostics.ts'

export type ComponentObservation = { envelope?: Envelope; error?: string }

/**
 * Reads one bounded panel component while retaining its browser cache conversation and public
 * diagnostics. Composite panels use this instead of inventing an aggregate source response.
 */
export async function readPanelObservation(args: {
  diagnostics: DiagnosticSink
  panelId: string
  path: string
  signal?: AbortSignal
  cache: Map<string, Envelope>
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}): Promise<ComponentObservation> {
  args.diagnostics.record({ kind: 'panel-fetch-start', panelId: args.panelId, path: args.path })
  try {
    const response = await args.fetcher(args.path, { signal: args.signal })
    const transport = {
      kind: 'panel-fetch-response' as const,
      panelId: args.panelId,
      path: args.path,
      status: response.status,
      cache: cacheMetadata(response.headers),
    }
    if (response.status === 304) {
      args.diagnostics.record(transport)
      const cached = args.cache.get(args.path)
      return cached
        ? { envelope: cached }
        : { error: 'Source returned not modified before an initial observation.' }
    }
    const parsed = envelopeSchema.safeParse(await response.json())
    if (!parsed.success) {
      args.diagnostics.record(transport)
      args.diagnostics.record({
        kind: 'panel-fetch-parse-failure',
        panelId: args.panelId,
        path: args.path,
        message: 'Response was not a valid signal envelope.',
      })
      return { error: 'Response was not a valid signal envelope.' }
    }
    const envelope = parsed.data
    args.diagnostics.record({
      ...transport,
      envelope,
      ...(envelope.state === 'error' ? { failure: failedObservation(envelope, response) } : {}),
    })
    if (envelope.state === 'ok') args.cache.set(args.path, envelope)
    return { envelope }
  } catch (error) {
    if (!args.signal?.aborted)
      args.diagnostics.record({
        kind: 'panel-fetch-failure',
        panelId: args.panelId,
        path: args.path,
        message: errorMessage(error),
      })
    return { error: errorMessage(error) }
  }
}

function failedObservation(envelope: Extract<Envelope, { state: 'error' }>, response: Response) {
  const supportReference = response.headers.get('x-dashboard-request-id')
  return {
    reason: envelope.error.message,
    ...(supportReference ? { supportReference } : {}),
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
