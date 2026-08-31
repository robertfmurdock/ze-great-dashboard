import type { ClientEnv, Envelope } from '@ze-great-dashboard/shared'
import {
  type BrowserStorageLike,
  browserLocalStorage,
  readBrowserJson,
  removeBrowserValue,
  writeBrowserJson,
} from './browser-storage.ts'
import { type DiagnosticsSummary, summarizeDiagnostics } from './diagnostics-summary.ts'
import { clientReleaseVersion } from './release-version.ts'

const storageKey = 'ze-great-dashboard.diagnostics.v1'
export const diagnosticsSchemaVersion = 1
const maximumEvents = 2_000
const maximumAgeMillis = 7 * 24 * 60 * 60 * 1_000
const diagnosticKinds = [
  'session-start',
  'client-update-check',
  'client-update-failure',
  'client-update-detected',
  'board-fetch-start',
  'board-fetch-response',
  'board-fetch-parse-failure',
  'board-fetch-failure',
  'layout-analyzed',
  'panel-fetch-start',
  'panel-fetch-response',
  'panel-fetch-parse-failure',
  'panel-fetch-failure',
  'panel-rendered',
] as const

export type CacheMetadata = Partial<
  Record<'cacheControl' | 'etag' | 'lastModified' | 'date' | 'age', string>
>

export type GithubConsistencyIncident = {
  at: string
  board: string
  panelId: string
  endpoint: string
  identity: { source: string; workflow: string; branch: string }
  accepted: { sourceUpdatedAt: string; status: string; link: string | null }
  regressed: { sourceUpdatedAt: string; status: string; link: string | null }
  response: { httpStatus?: number; date?: string; etag?: string; cacheControl?: string }
}

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
  | { kind: 'client-update-check'; path: string }
  | { kind: 'client-update-failure'; path: string; message: string }
  | {
      kind: 'client-update-detected'
      path: string
      current: { assetPath: string }
      next: { assetPath: string }
    }
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
  | { kind: 'layout-analyzed'; issueCount: number; affectedPanelIds: string[] }
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
  recordGithubConsistencyIncident(incident: Omit<GithubConsistencyIncident, 'at' | 'board'>): void
}

type PersistedDiagnosticEvent = Omit<DiagnosticEvent, 'schemaVersion'> & { schemaVersion?: number }
export type DiagnosticRetention = {
  eventsPrunedByAge: number
  eventsPrunedByCount: number
}

type StoredDiagnostics = {
  schemaVersion: number
  events: PersistedDiagnosticEvent[]
  retention?: Partial<DiagnosticRetention>
  githubConsistencyIncidents?: GithubConsistencyIncident[]
}

type StorageLike = BrowserStorageLike & Pick<Storage, 'removeItem'>

/** Browser-local diagnostic evidence. It deliberately has no server or shared-contract counterpart. */
export class BrowserDiagnosticStore implements DiagnosticSink {
  private events: DiagnosticEvent[] = []
  private retention: DiagnosticRetention = emptyRetention()
  private revision = 0
  private incidents: GithubConsistencyIncident[] = []
  private readonly listeners = new Set<() => void>()
  private readonly sessionId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

  constructor(
    private readonly env: ClientEnv,
    private readonly storage: StorageLike | undefined = browserLocalStorage() as
      | StorageLike
      | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.events = this.read()
    this.record({ kind: 'session-start' })
  }

  recordGithubConsistencyIncident(incident: Omit<GithubConsistencyIncident, 'at' | 'board'>) {
    this.incidents.push({ ...incident, at: this.now().toISOString(), board: this.env.board })
    this.persist()
    this.revision++
    this.notify()
  }

  githubConsistencyIncidentCount = () => this.incidents.length

  record(event: DiagnosticEventInput) {
    const pruned = prune(
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
      this.retention,
    )
    this.events = pruned.events
    this.retention = pruned.retention
    this.persist()
    this.revision++
    this.notify()
  }

  count = () => {
    return this.events.length
  }

  clientVersion = () => clientReleaseVersion

  assetPath = () => this.env.assetPath

  snapshot = () => this.revision

  summary = (): DiagnosticsSummary =>
    summarizeDiagnostics(this.events, this.retention, this.incidents.length)

  clear() {
    this.events = []
    this.incidents = []
    this.retention = emptyRetention()
    removeBrowserValue(this.storage, storageKey)
    this.revision++
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
        version: clientReleaseVersion,
        assetPath: this.env.assetPath,
        board: this.env.board,
        sessionId: this.sessionId,
      },
      events: this.events,
      githubConsistencyIncidents: this.incidents,
      summary: this.summary(),
    }
  }

  private read(): DiagnosticEvent[] {
    const parsed = readBrowserJson<Partial<StoredDiagnostics>>(this.storage, storageKey)
    if (
      !parsed ||
      parsed.schemaVersion !== diagnosticsSchemaVersion ||
      !Array.isArray(parsed.events)
    ) {
      removeBrowserValue(this.storage, storageKey)
      return []
    }
    if (!parsed.events.every(isDiagnosticEvent)) {
      removeBrowserValue(this.storage, storageKey)
      return []
    }
    // v1 retained events predate per-event versions. Their containing store was already v1, so
    // retain them and normalize on the next write rather than discarding viewer evidence.
    const pruned = prune(
      parsed.events.map(
        (event) => ({ ...event, schemaVersion: diagnosticsSchemaVersion }) as DiagnosticEvent,
      ),
      this.now(),
      validRetention(parsed.retention),
    )
    this.retention = pruned.retention
    this.incidents = validIncidents(parsed.githubConsistencyIncidents)
    return pruned.events
  }

  private persist() {
    writeBrowserJson(this.storage, storageKey, {
      schemaVersion: diagnosticsSchemaVersion,
      events: this.events,
      retention: this.retention,
      githubConsistencyIncidents: this.incidents,
    })
  }

  private notify() {
    for (const listener of this.listeners) listener()
  }
}

function validIncidents(value: unknown): GithubConsistencyIncident[] {
  if (!Array.isArray(value)) return []
  return value.filter((incident): incident is GithubConsistencyIncident => {
    if (!incident || typeof incident !== 'object') return false
    const item = incident as Partial<GithubConsistencyIncident>
    return (
      typeof item.at === 'string' &&
      typeof item.board === 'string' &&
      typeof item.panelId === 'string' &&
      typeof item.endpoint === 'string' &&
      !!item.accepted &&
      !!item.regressed &&
      !!item.response
    )
  })
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

function emptyRetention(): DiagnosticRetention {
  return { eventsPrunedByAge: 0, eventsPrunedByCount: 0 }
}

function validRetention(value: unknown): DiagnosticRetention {
  if (!value || typeof value !== 'object') return emptyRetention()
  const retention = value as Partial<DiagnosticRetention>
  return {
    eventsPrunedByAge:
      typeof retention.eventsPrunedByAge === 'number' && retention.eventsPrunedByAge >= 0
        ? retention.eventsPrunedByAge
        : 0,
    eventsPrunedByCount:
      typeof retention.eventsPrunedByCount === 'number' && retention.eventsPrunedByCount >= 0
        ? retention.eventsPrunedByCount
        : 0,
  }
}

function prune(events: DiagnosticEvent[], now: Date, priorRetention: DiagnosticRetention) {
  const cutoff = now.valueOf() - maximumAgeMillis
  const current = events.filter(
    (event) =>
      Number.isFinite(new Date(event.at).valueOf()) && new Date(event.at).valueOf() >= cutoff,
  )
  const discardedByAge = events.length - current.length
  const discardedByCount = Math.max(0, current.length - maximumEvents)
  return {
    events: current.slice(-maximumEvents),
    retention: {
      eventsPrunedByAge: priorRetention.eventsPrunedByAge + discardedByAge,
      eventsPrunedByCount: priorRetention.eventsPrunedByCount + discardedByCount,
    },
  }
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
