import type {
  Envelope,
  Panel,
  PipelineStatus,
  TestHistory,
} from '@ze-great-dashboard/shared/browser'
import { browserLocalStorage, readBrowserJson, writeBrowserJson } from './browser-storage.ts'
import { reportedTests, type TestSample } from './test-direction.ts'
import {
  completeTestRepair,
  confirmTestObservation,
  mergeTestReadings,
  projectTestReadings,
  startTestRepair,
  type TestRepairState,
  testRepairEligible,
} from './test-history-model.ts'

const storageKey = 'ze-great-dashboard.panel-memory.v1'
const schemaVersion = 1
const historyWindowMillis = 14 * 24 * 60 * 60 * 1_000

export type PanelMemoryIdentity = {
  board: string
  panelId: string
  source: string
  workflow: string
  branch: string
  testArtifact?: string
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
  repair?: TestRepairState
  tests?: TestSample[]
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

  observeTests(board: string, panel: Panel, envelope: Envelope) {
    const tests = reportedTests(envelope)
    if (!tests?.run) return undefined
    const history = this.testHistory(board, panel)
    const current: TestSample = { ...tests.run, total: tests.total }
    history.tests = mergeTestReadings(history.tests ?? [], [current], this.now().valueOf())
    if (history.repair)
      history.repair = { ...history.repair, hadSamples: Boolean(history.tests.length) }
    this.persist()
    return projectTestReadings(history.tests, current, history.repair?.partial)
  }

  testDirection(board: string, panel: Panel, envelope: Envelope) {
    const tests = reportedTests(envelope)
    if (!tests?.run) return undefined
    const history = this.testHistory(board, panel)
    this.pruneHistory(history)
    return projectTestReadings(
      history.tests ?? [],
      { ...tests.run, total: tests.total },
      history.repair?.partial,
    )
  }

  confirmTestPoll(board: string, panel: Panel) {
    const history = this.testHistory(board, panel)
    history.repair = confirmTestObservation(history.repair, this.now().valueOf())
    this.persist()
  }

  testRepairDue(board: string, panel: Panel) {
    const history = this.testHistory(board, panel)
    this.pruneHistory(history)
    return testRepairEligible(history.repair, Boolean(history.tests?.length), this.now().valueOf())
  }

  beginTestRepair(board: string, panel: Panel) {
    const history = this.testHistory(board, panel)
    history.repair = startTestRepair(history.repair, this.now().valueOf())
    this.persist()
  }

  finishTestRepair(board: string, panel: Panel, result?: TestHistory, retryAt?: number) {
    const history = this.testHistory(board, panel)
    const now = this.now().valueOf()
    history.tests = mergeTestReadings(history.tests ?? [], result?.samples ?? [], now)
    history.repair = completeTestRepair(
      history.repair,
      result,
      Boolean(history.tests.length),
      now,
      retryAt,
    )
    this.persist()
  }

  private testHistory(board: string, panel: Panel) {
    return this.history({
      ...resolvePanelMemoryIdentity(board, panel),
      testArtifact: JSON.stringify(panel.test_results ?? null),
    })
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
    if (history.tests) history.tests = mergeTestReadings(history.tests, [], this.now().valueOf())
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
  const parts = [
    identity.board,
    identity.panelId,
    identity.source,
    identity.workflow,
    identity.branch,
  ]
  if (identity.testArtifact !== undefined) parts.push(identity.testArtifact)
  return JSON.stringify(parts)
}

function isHistories(value: unknown): value is Record<string, History> {
  if (!isRecord(value)) return false
  return Object.values(value).every(isHistory)
}

function isHistory(value: unknown): value is History {
  if (!isRecord(value) || !isRecord(value.durations)) return false
  if (!Object.values(value.durations).every(isDurationSample)) return false
  if (value.repair !== undefined) {
    if (
      !isRecord(value.repair) ||
      !Number.isInteger(value.repair.failures) ||
      Number(value.repair.failures) < 0 ||
      typeof value.repair.gapPending !== 'boolean'
    )
      return false
    for (const key of ['lastConfirmedAt', 'lastCompleteAt', 'lastAttemptAt', 'nextAttemptAt']) {
      const at = value.repair[key]
      if (at !== undefined && (typeof at !== 'number' || !Number.isFinite(at) || at < 0))
        return false
    }
    if (value.repair.partial !== undefined && typeof value.repair.partial !== 'boolean')
      return false
    if (value.repair.hadSamples !== undefined && typeof value.repair.hadSamples !== 'boolean')
      return false
  }
  if (
    value.tests !== undefined &&
    (!Array.isArray(value.tests) ||
      !value.tests.every(
        (sample) =>
          isRecord(sample) &&
          typeof sample.id === 'string' &&
          sample.id.length > 0 &&
          Number.isInteger(sample.attempt) &&
          Number(sample.attempt) > 0 &&
          typeof sample.updatedAt === 'string' &&
          Number.isFinite(Date.parse(sample.updatedAt)) &&
          Number.isInteger(sample.total) &&
          Number(sample.total) >= 0,
      ))
  )
    return false
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
