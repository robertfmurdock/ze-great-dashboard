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

export type DurationSample = {
  link: string | null
  sourceRunId?: string
  durationMs: number
  sourceUpdatedAt: string
}
type History = {
  latest?: AcceptedPipeline
  durations: Record<string, DurationSample>
  latestCompleted?: DurationSample
}
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

  recordRun(identity: PanelMemoryIdentity, sample: DurationSample, successful = false) {
    const history = this.history(identity)
    if (successful) history.durations[sampleKey(sample)] = sample
    const previous = history.latestCompleted
    if (!previous || isAtLeastAsRecent(sample.sourceUpdatedAt, previous.sourceUpdatedAt)) {
      history.latestCompleted = sample
    }
    this.pruneHistory(history)
    this.persist()
  }

  recordSuccessfulRun(identity: PanelMemoryIdentity, sample: DurationSample) {
    this.recordRun(identity, sample, true)
  }

  recordCompletedRun(identity: PanelMemoryIdentity, sample: DurationSample) {
    this.recordRun(identity, sample)
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

  resolveEstimatedDuration(identity: PanelMemoryIdentity): number | undefined {
    const successful = this.medianDuration(identity)
    if (successful !== undefined) return successful

    const history = this.history(identity)
    this.pruneHistory(history)
    return history.latestCompleted?.durationMs
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
      const at = sourceTimestamp(sample.sourceUpdatedAt)
      if (at === undefined || at < cutoff) delete history.durations[link]
    }
    const latestCompletedAt = history.latestCompleted
      ? sourceTimestamp(history.latestCompleted.sourceUpdatedAt)
      : undefined
    if (
      history.latestCompleted &&
      (latestCompletedAt === undefined || latestCompletedAt < cutoff)
    ) {
      delete history.latestCompleted
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

function sampleKey(sample: DurationSample) {
  return sample.sourceRunId ?? sample.link ?? sample.sourceUpdatedAt
}

function isAtLeastAsRecent(left: string, right: string) {
  const leftAt = sourceTimestamp(left)
  const rightAt = sourceTimestamp(right)
  return leftAt !== undefined && (rightAt === undefined || leftAt >= rightAt)
}

function sourceTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : undefined
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
  if (!isRecord(value)) return false
  return Object.values(value).every(isHistory)
}

function isHistory(value: unknown): value is History {
  if (!isRecord(value) || !isRecord(value.durations)) return false
  if (!Object.values(value.durations).every(isDurationSample)) return false
  return value.latestCompleted === undefined || isDurationSample(value.latestCompleted)
}

function isDurationSample(value: unknown): value is DurationSample {
  if (!isRecord(value)) return false
  return (
    (typeof value.link === 'string' || value.link === null) &&
    (value.sourceRunId === undefined || typeof value.sourceRunId === 'string') &&
    typeof value.durationMs === 'number' &&
    Number.isInteger(value.durationMs) &&
    value.durationMs >= 0 &&
    typeof value.sourceUpdatedAt === 'string' &&
    sourceTimestamp(value.sourceUpdatedAt) !== undefined
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
