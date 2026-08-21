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

export type CacheMetadata = Partial<
  Record<'cacheControl' | 'etag' | 'lastModified' | 'date' | 'age', string>
>

type EventMetadata = {
  schemaVersion: typeof diagnosticsSchemaVersion
  at: string
  sessionId: string
  board: string
}

export type RenderedPanelDiagnostic = {
  state: Envelope['state']
  status?: string
  link: string | null
}

export type DiagnosticEventInput =
  | { kind: 'session-start' }
  | { kind: 'board-fetch-start'; path: string }
  | {
      kind: 'board-fetch-response'
      path: string
      status?: number
      cache?: CacheMetadata
      boardSummary?: { panelCount: number; panelIds: string[] }
    }
  | { kind: 'board-fetch-parse-failure'; path: string; message: string }
  | { kind: 'board-fetch-failure'; path: string; message: string }
  | { kind: 'panel-fetch-start'; panelId: string; path: string }
  | {
      kind: 'panel-fetch-response'
      panelId: string
      path: string
      status?: number
      cache?: CacheMetadata
      envelope?: Envelope
    }
  | { kind: 'panel-fetch-parse-failure'; panelId: string; path: string; message: string }
  | { kind: 'panel-fetch-failure'; panelId: string; path: string; message: string }
  | {
      kind: 'panel-rendered'
      panelId: string
      path: string
      rendered: RenderedPanelDiagnostic
    }

export type DiagnosticEvent = DiagnosticEventInput extends infer Event
  ? Event extends DiagnosticEventInput
    ? Event & EventMetadata
    : never
  : never

/** The only interface client features need in order to emit browser diagnostics. */
export interface DiagnosticSink {
  record(event: DiagnosticEventInput): void
}

type PersistedDiagnosticEvent = Omit<DiagnosticEvent, 'schemaVersion'> & { schemaVersion?: number }
type StoredDiagnostics = { schemaVersion: number; events: PersistedDiagnosticEvent[] }

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/** Browser-local diagnostic evidence. It deliberately has no server or shared-contract counterpart. */
export class BrowserDiagnosticStore implements DiagnosticSink {
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

  record(event: DiagnosticEventInput) {
    this.events = prune(
      [
        ...this.events,
        {
          ...event,
          schemaVersion: diagnosticsSchemaVersion,
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

  count = () => {
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

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  export = () => {
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
      // v1 retained events predate per-event versions. Their containing store was already v1, so
      // retain them and normalize on the next write rather than discarding viewer evidence.
      return prune(
        parsed.events.map(
          (event) => ({ ...event, schemaVersion: diagnosticsSchemaVersion }) as DiagnosticEvent,
        ),
        this.now(),
      )
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

function isDiagnosticEvent(value: unknown): value is PersistedDiagnosticEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<DiagnosticEvent>
  return (
    (event.schemaVersion === undefined || event.schemaVersion === diagnosticsSchemaVersion) &&
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
