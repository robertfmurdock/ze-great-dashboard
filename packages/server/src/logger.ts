import type { ErrorKind } from '@ze-great-dashboard/shared'

/** The complete production log vocabulary. Values are deliberately public-safe metadata only. */
export type ServerLogEvent =
  | { event: 'server.starting' }
  | { event: 'server.ready'; board: string; host: string; port: number; serverRelease: string }
  | {
      event: 'server.startup_failed'
      category: 'configuration' | 'template' | 'board-config' | 'credentials' | 'unknown'
    }
  | { event: 'server.no_auth_warning'; host: string; port: number }
  | {
      event: 'api.operation_rejected'
      requestId: string
      boardId: string
      panelId: string
      operation: string
    }
  | {
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
    }
  | { event: 'server.unhandled_exception'; requestId?: string; operation: string }

export interface ServerLogger {
  log(event: ServerLogEvent): void
}

/** Keeps the immutable server-image identity in the startup event without coupling it to assets. */
export function serverReadyEvent(args: {
  board: string
  host: string
  port: number
  serverRelease: string
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
