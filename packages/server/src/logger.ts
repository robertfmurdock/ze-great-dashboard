import type { ErrorKind } from '@ze-great-dashboard/shared'

/** The complete production log vocabulary. Values are deliberately public-safe metadata only. */
type ServerIdentity = { serverVersion: string }
type ClientDiagnosticClaims = {
  clientVersion?: string
  clientOrigin?: string
  clientAssetPathMatchesConfigured?: boolean
}
export type ServerDiagnosticContext = ServerIdentity & { configuredAssetPathId: string }

export type ServerLogEvent = ServerIdentity &
  (
    | { event: 'server.starting' }
    | { event: 'server.ready'; board: string; host: string; port: number }
    | {
        event: 'server.startup_failed'
        category: 'configuration' | 'template' | 'board-config' | 'credentials' | 'unknown'
      }
    | { event: 'server.no_auth_warning'; host: string; port: number }
    | ({
        event: 'api.operation_rejected'
        requestId: string
        boardId: string
        panelId: string
        operation: string
      } & ClientDiagnosticClaims)
    | ({
        event: 'panel.observation_failed'
        requestId: string
        boardId: string
        panelId: string
        operation: string
        errorKind: ErrorKind
        elapsedMs: number
        sourceName?: string
        sourceType?: string
        destinationOrigin?: string
        upstreamStatus?: number
        networkCode?: string
      } & ClientDiagnosticClaims)
    | ({
        event: 'server.unhandled_exception'
        requestId?: string
        operation: string
      } & ClientDiagnosticClaims)
  )

export interface ServerLogger {
  log(event: ServerLogEvent): void
}

/** Keeps the immutable server-image identity in the startup event without coupling it to assets. */
export function serverReadyEvent(args: {
  board: string
  host: string
  port: number
  serverVersion: string
}): ServerLogEvent {
  return { event: 'server.ready', ...args }
}

/** JSON Lines lets local output and CloudWatch use the exact same safe event contract. */
export const consoleLogger: ServerLogger = {
  log(event) {
    console.log(JSON.stringify({ at: new Date().toISOString(), ...event }))
  },
}

export function requestId(): string {
  return crypto.randomUUID()
}

export function destinationOrigin(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value).origin
  } catch {
    return undefined
  }
}

/** Immutable per-app diagnostic values, computed once from trusted server configuration. */
export function serverDiagnosticContext(
  serverVersion: string,
  configuredAssetPathId: string,
): ServerDiagnosticContext {
  return { serverVersion, configuredAssetPathId }
}

/** Normalizes browser-supplied diagnostic claims without retaining raw header values. */
export function clientDiagnosticClaims(
  headers: Headers,
  context: ServerDiagnosticContext,
): ClientDiagnosticClaims {
  const version = headers.get('x-dashboard-client-version')
  const origin = headers.get('x-dashboard-client-origin')
  const assetPathId = headers.get('x-dashboard-client-asset-id')
  const clientOrigin = safeOrigin(origin)
  return {
    ...(version && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(version)
      ? { clientVersion: version }
      : {}),
    ...(clientOrigin ? { clientOrigin } : {}),
    ...(assetPathId && /^sha256:[a-f0-9]{64}$/.test(assetPathId)
      ? { clientAssetPathMatchesConfigured: assetPathId === context.configuredAssetPathId }
      : {}),
  }
}

function safeOrigin(value: string | null): string | undefined {
  if (!value) return undefined
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? undefined : origin
  } catch {
    return undefined
  }
}
