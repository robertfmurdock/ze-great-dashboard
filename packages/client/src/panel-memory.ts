import type { Panel, PipelineStatus } from '@ze-great-dashboard/shared'
import { browserLocalStorage, readBrowserJson, writeBrowserJson } from './browser-storage.ts'

const storageKey = 'ze-great-dashboard.panel-memory.v1'
const schemaVersion = 1
const historyWindowMillis = 14 * 24 * 60 * 60 * 1_000

export type PanelMemoryIdentity = {
  board: string
  panelId: string
  source: string
  workflow: string
  branch: string
}

export type AcceptedPipeline = {
  sourceUpdatedAt: string
  status: PipelineStatus['status']
  link: string | null
}

type DurationSample = { durationMs: number; sourceUpdatedAt: string }
type History = { latest?: AcceptedPipeline; durations: Record<string, DurationSample> }
type StoredMemory = { schemaVersion: number; histories: Record<string, History> }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

export class BrowserPanelMemory {
  private histories: Record<string, History>
  private readonly storage: StorageLike | undefined

  constructor(
    storage: StorageLike | undefined = browserLocalStorage(),
    private readonly now: () => Date = () => new Date(),
  ) {
    this.storage = storage
    this.histories = this.read()
    this.pruneAll()
  }

  latest(identity: PanelMemoryIdentity): AcceptedPipeline | undefined {
    return this.history(identity).latest
  }

  rememberLatest(identity: PanelMemoryIdentity, latest: AcceptedPipeline) {
    this.history(identity).latest = latest
    this.persist()
  }

  recordSuccessfulRun(identity: PanelMemoryIdentity, link: string, sample: DurationSample) {
    const history = this.history(identity)
    history.durations[link] = sample
    this.pruneHistory(history)
    this.persist()
  }

  medianDuration(identity: PanelMemoryIdentity): number | undefined {
    const history = this.history(identity)
    this.pruneHistory(history)
    const durations = Object.values(history.durations)
      .map(({ durationMs }) => durationMs)
      .sort((left, right) => left - right)
    if (durations.length === 0) return undefined
    const middle = Math.floor(durations.length / 2)
    if (durations.length % 2 === 1) return durations[middle]
    const lower = durations[middle - 1]
    const upper = durations[middle]
    return lower === undefined || upper === undefined ? undefined : Math.floor((lower + upper) / 2)
  }

  private history(identity: PanelMemoryIdentity) {
    const key = identityKey(identity)
    const existing = this.histories[key]
    if (existing) return existing
    const created: History = { durations: {} }
    this.histories[key] = created
    return created
  }

  private pruneAll() {
    for (const history of Object.values(this.histories)) this.pruneHistory(history)
    this.persist()
  }

  private pruneHistory(history: History) {
    const cutoff = this.now().valueOf() - historyWindowMillis
    for (const [link, sample] of Object.entries(history.durations)) {
      const at = new Date(sample.sourceUpdatedAt).valueOf()
      if (!Number.isFinite(at) || at < cutoff) delete history.durations[link]
    }
  }

  private read(): Record<string, History> {
    const parsed = readBrowserJson<Partial<StoredMemory>>(this.storage, storageKey)
    if (parsed?.schemaVersion !== schemaVersion || !parsed.histories) return {}
    return isHistories(parsed.histories) ? parsed.histories : {}
  }

  private persist() {
    writeBrowserJson(this.storage, storageKey, { schemaVersion, histories: this.histories })
  }
}

export function resolvePanelMemoryIdentity(board: string, panel: Panel): PanelMemoryIdentity {
  return {
    board,
    panelId: panel.id,
    source: panel.source ?? '',
    workflow:
      typeof panel.pipeline === 'string' || typeof panel.pipeline === 'number'
        ? String(panel.pipeline)
        : '',
    branch: panel.branch ?? '',
  }
}

function identityKey(identity: PanelMemoryIdentity) {
  return JSON.stringify([
    identity.board,
    identity.panelId,
    identity.source,
    identity.workflow,
    identity.branch,
  ])
}

function isHistories(value: unknown): value is Record<string, History> {
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every((history) => {
    if (!history || typeof history !== 'object') return false
    const candidate = history as Partial<History>
    return !!candidate.durations && typeof candidate.durations === 'object'
  })
}
