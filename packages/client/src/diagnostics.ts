import type { ClientEnv, Envelope } from '@ze-great-dashboard/shared'

const storageKey = 'ze-great-dashboard.diagnostics.v1'
export const diagnosticsSchemaVersion = 1
const maximumEvents = 2_000
const maximumAgeMillis = 7 * 24 * 60 * 60 * 1_000
const diagnosticKinds = [
  'session-start',
  'board-fetch-start',
  'board-fetch-response',
  'board-fetch-parse-failure',
  'board-fetch-failure',
  'panel-fetch-start',
  'panel-fetch-response',
  'panel-fetch-parse-failure',
  'panel-fetch-failure',
  'panel-rendered',
] as const

type CacheMetadata = Record<'cacheControl' | 'etag' | 'lastModified' | 'date' | 'age', string>

export type DiagnosticEvent = {
  at: string
  sessionId: string
  board: string
  kind:
    | 'session-start'
    | 'board-fetch-start'
    | 'board-fetch-response'
    | 'board-fetch-parse-failure'
    | 'board-fetch-failure'
    | 'panel-fetch-start'
    | 'panel-fetch-response'
    | 'panel-fetch-parse-failure'
    | 'panel-fetch-failure'
    | 'panel-rendered'
  panelId?: string
  path?: string
  status?: number
  cache?: CacheMetadata
  envelope?: Envelope
  rendered?: { state: Envelope['state']; status?: string; link: string | null }
  message?: string
  boardSummary?: { panelCount: number; panelIds: string[] }
}

type StoredDiagnostics = { schemaVersion: number; events: DiagnosticEvent[] }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export class DiagnosticLog {
  private events: DiagnosticEvent[] = []
  private readonly listeners = new Set<() => void>()
  private readonly sessionId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

  constructor(
    private readonly env: ClientEnv,
    private readonly storage: StorageLike | undefined = storageOrUndefined(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events = this.read()
    this.record({ kind: 'session-start' })
  }

  record(event: Omit<DiagnosticEvent, 'at' | 'sessionId' | 'board'>) {
    this.events = prune(
      [
        ...this.events,
        {
          ...event,
          at: this.now().toISOString(),
          sessionId: this.sessionId,
          board: this.env.board,
        },
      ],
      this.now(),
    )
    this.persist()
    this.notify()
  }

  count() {
    return this.events.length
  }

  clear() {
    this.events = []
    try {
      this.storage?.removeItem(storageKey)
    } catch {
      // Diagnostics must not interrupt the radiator when browser storage is unavailable.
    }
    this.notify()
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  export() {
    return {
      schemaVersion: diagnosticsSchemaVersion,
      exportedAt: this.now().toISOString(),
      client: {
        version: this.env.clientVersion,
        assetPath: this.env.assetPath,
        board: this.env.board,
        sessionId: this.sessionId,
      },
      events: this.events,
    }
  }

  private read(): DiagnosticEvent[] {
    try {
      const raw = this.storage?.getItem(storageKey)
      if (!raw) return []
      const parsed = JSON.parse(raw) as Partial<StoredDiagnostics>
      if (parsed.schemaVersion !== diagnosticsSchemaVersion || !Array.isArray(parsed.events)) {
        this.storage?.removeItem(storageKey)
        return []
      }
      if (!parsed.events.every(isDiagnosticEvent)) {
        this.storage?.removeItem(storageKey)
        return []
      }
      return prune(parsed.events, this.now())
    } catch {
      try {
        this.storage?.removeItem(storageKey)
      } catch {
        // Storage can fail on both reads and writes (for example, private browsing policies).
      }
      return []
    }
  }

  private persist() {
    try {
      this.storage?.setItem(
        storageKey,
        JSON.stringify({ schemaVersion: diagnosticsSchemaVersion, events: this.events }),
      )
    } catch {
      // Keep the in-memory record for this page, but never make diagnostics a rendering failure.
    }
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}

export function cacheMetadata(headers: Headers): CacheMetadata | undefined {
  const entries = [
    ['cacheControl', 'cache-control'],
    ['etag', 'etag'],
    ['lastModified', 'last-modified'],
    ['date', 'date'],
    ['age', 'age'],
  ] as const
  const metadata = Object.fromEntries(
    entries.flatMap(([key, header]) => {
      const value = headers.get(header)
      return value ? [[key, value]] : []
    }),
  ) as CacheMetadata
  return Object.keys(metadata).length ? metadata : undefined
}

function prune(events: DiagnosticEvent[], now: Date) {
  const cutoff = now.valueOf() - maximumAgeMillis
  return events
    .filter(
      (event) =>
        Number.isFinite(new Date(event.at).valueOf()) && new Date(event.at).valueOf() >= cutoff,
    )
    .slice(-maximumEvents)
}

function isDiagnosticEvent(value: unknown): value is DiagnosticEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<DiagnosticEvent>
  return (
    typeof event.at === 'string' &&
    Number.isFinite(new Date(event.at).valueOf()) &&
    typeof event.sessionId === 'string' &&
    typeof event.board === 'string' &&
    diagnosticKinds.includes(event.kind as (typeof diagnosticKinds)[number])
  )
}

function storageOrUndefined(): StorageLike | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}
