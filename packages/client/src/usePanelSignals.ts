import {
  type Board,
  type ClientEnv,
  type Envelope,
  envelopeSchema,
} from '@ze-great-dashboard/shared'
import { useEffect, useRef, useState } from 'react'
import { dashboardFetch } from './dashboard-fetch.ts'
import { cacheMetadata, type DiagnosticSink } from './diagnostics.ts'
import {
  httpValueFactsDiagnosticChanged,
  panelDiagnosticChanged,
  projectHttpValueFactsDiagnostic,
  projectPanelDiagnostic,
} from './panel-diagnostics.ts'
import { BrowserPanelMemory, resolvePanelMemoryIdentity } from './panel-memory.ts'
import { readPanelObservation } from './panel-observation.ts'
import type { HttpValueFactObservation, PanelUpdateHealth } from './panel-props.ts'
import { reconcilePipelineResponse } from './pipeline-reconciliation.ts'
import {
  initialPollingSchedule,
  panelProxyPath,
  pollingPanels,
  readUpdateWorkflows,
} from './polling-panels.ts'
import { type PollingScheduleSnapshot, resolveNextPoll } from './polling-schedule.ts'
import { rollupPullRequestHealth } from './pull-request-rollup.ts'

export function usePanelSignals({
  board,
  env,
  diagnostics,
  memory,
}: {
  board: Board | undefined
  env: ClientEnv
  diagnostics: DiagnosticSink
  memory?: BrowserPanelMemory
}) {
  const [signals, setSignals] = useState<Record<string, Envelope | undefined>>({})
  const [updateHealth, setUpdateHealth] = useState<Record<string, PanelUpdateHealth | undefined>>(
    {},
  )
  const [factSignals, setFactSignals] = useState<
    Record<string, Record<string, HttpValueFactObservation | undefined> | undefined>
  >({})
  const [schedules, setSchedules] = useState<PollingScheduleSnapshot[]>([])
  const signalsRef = useRef<Record<string, Envelope | undefined>>({})
  const factSignalsRef = useRef<
    Record<string, Record<string, HttpValueFactObservation | undefined> | undefined>
  >({})
  const memoryRef = useRef<BrowserPanelMemory | null>(null)
  if (!memoryRef.current) memoryRef.current = memory ?? new BrowserPanelMemory()

  useEffect(() => {
    signalsRef.current = {}
    factSignalsRef.current = {}
    setSignals({})
    setUpdateHealth({})
    setFactSignals({})
    setSchedules([])
    if (!board) return

    let cancelled = false
    const timers = new Set<number>()
    const abortControllers = new Set<AbortController>()
    const panels = pollingPanels(board)
    const initialSchedules = panels.map((panel) => initialPollingSchedule(board, env, panel))
    const schedulesByPanelId = new Map(
      initialSchedules.map((schedule) => [schedule.panelId, schedule]),
    )
    setSchedules(initialSchedules)
    const updateSchedule = (panelId: string, update: Partial<PollingScheduleSnapshot>) => {
      if (cancelled) return
      setSchedules((current) =>
        current.map((schedule) =>
          schedule.panelId === panelId ? { ...schedule, ...update } : schedule,
        ),
      )
    }
    for (const panel of panels) {
      let inFlight = false
      const memory = memoryRef.current
      if (!memory) return
      const schedule = schedulesByPanelId.get(panel.id)
      if (!schedule) continue
      const { settings } = schedule
      const path = panelProxyPath(env, panel.id)
      let lastEnvelope: Envelope | undefined
      let lastConfirmedAt: string | undefined
      const recordConfirmedUpdate = () => {
        lastConfirmedAt = new Date().toISOString()
        if (!cancelled)
          setUpdateHealth((current) => {
            if (!current[panel.id]) return current
            const next = { ...current }
            delete next[panel.id]
            return next
          })
      }
      const recordUpdateFailure = (error: unknown) => {
        const confirmedAt = lastConfirmedAt
        if (cancelled || !confirmedAt) return
        const message = errorMessage(error)
        setUpdateHealth((current) => {
          const previous = current[panel.id]
          return {
            ...current,
            [panel.id]: {
              consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
              message,
              lastConfirmedAt: confirmedAt,
            },
          }
        })
      }
      if (panel.type === 'http-value' && panel.facts) {
        const facts = panel.facts
        const components = new Map<string, Envelope>()
        let activeController: AbortController | undefined
        const refreshFacts = async () => {
          if (cancelled || inFlight) return
          inFlight = true
          updateSchedule(panel.id, {
            inFlight: true,
            lastRequestStartedAt: new Date().toISOString(),
            nextDueAt: undefined,
          })
          activeController = new AbortController()
          abortControllers.add(activeController)
          const root = `${path}/facts`
          const observations = await Promise.all(
            facts.map(async (fact) => {
              const factPath = `${root}/${encodeURIComponent(fact.id)}`
              const result = await readPanelObservation({
                diagnostics,
                panelId: panel.id,
                path: factPath,
                signal: activeController?.signal,
                cache: components,
                fetcher: (input, init) => dashboardFetch(env, input, init),
              })
              return [fact.id, result.error ? { failure: result.error } : result] as const
            }),
          )
          if (!cancelled && !activeController.signal.aborted) {
            const next = Object.fromEntries(observations)
            const previous = factSignalsRef.current[panel.id]
            if (httpValueFactsDiagnosticChanged(previous, next))
              diagnostics.record({
                kind: 'panel-rendered',
                panelId: panel.id,
                path,
                rendered: projectHttpValueFactsDiagnostic(next),
              })
            factSignalsRef.current = { ...factSignalsRef.current, [panel.id]: next }
            setFactSignals(factSignalsRef.current)
          }
          inFlight = false
          abortControllers.delete(activeController)
          if (!cancelled) {
            const due = Date.now() + settings.refreshMillis
            updateSchedule(panel.id, {
              inFlight: false,
              cadence: 'normal',
              nextDueAt: new Date(due).toISOString(),
            })
            const timer = window.setTimeout(() => {
              timers.delete(timer)
              void refreshFacts()
            }, settings.refreshMillis)
            timers.add(timer)
          }
        }
        void refreshFacts()
        continue
      }
      if (panel.type === 'pull-request-health') {
        const workflows = readUpdateWorkflows(panel)
        const components = new Map<string, Envelope>()
        let activeController: AbortController | undefined
        const request = async (componentPath: string) => {
          const result = await readPanelObservation({
            diagnostics,
            panelId: panel.id,
            path: componentPath,
            signal: activeController?.signal,
            cache: components,
            fetcher: (input, init) => dashboardFetch(env, input, init),
          })
          if (result.envelope?.state === 'error') return { error: result.envelope.error.message }
          return result
        }
        const refreshPullRequestHealth = async () => {
          if (cancelled || inFlight) return
          inFlight = true
          updateSchedule(panel.id, {
            inFlight: true,
            lastRequestStartedAt: new Date().toISOString(),
            nextDueAt: undefined,
          })
          activeController = new AbortController()
          abortControllers.add(activeController)
          const root = path
          const [candidateResult, ...workflowResults] = await Promise.all([
            request(`${root}/pull-requests`),
            ...workflows.map(({ workflow }) =>
              request(`${root}/update-workflow/${encodeURIComponent(workflow)}`),
            ),
          ])
          const candidates =
            candidateResult.envelope?.state === 'ok' &&
            isCandidates(candidateResult.envelope.signal)
              ? candidateResult.envelope.signal.pullRequests
              : []
          if (cancelled || activeController.signal.aborted) {
            abortControllers.delete(activeController)
            return
          }
          const buildResults = await Promise.all(
            candidates.map(
              async (candidate) =>
                [
                  candidate.branch,
                  await request(
                    `${root}/pull-request-build?branch=${encodeURIComponent(candidate.branch)}`,
                  ),
                ] as const,
            ),
          )
          const rolled = rollupPullRequestHealth({
            panelId: panel.id,
            link: candidateResult.envelope?.link ?? null,
            workflows: workflows.map(({ workflow }, index) => ({
              workflow,
              observation: workflowResults[index] ?? { error: 'Missing workflow result.' },
            })),
            candidates: candidateResult,
            builds: new Map(buildResults),
          })
          if (cancelled || activeController.signal.aborted) {
            abortControllers.delete(activeController)
            return
          }
          if (rolled && !cancelled) {
            lastEnvelope = rolled
            recordConfirmedUpdate()
            const previous = signalsRef.current[panel.id]
            if (panelDiagnosticChanged(previous, panel, rolled))
              diagnostics.record({
                kind: 'panel-rendered',
                panelId: panel.id,
                path,
                rendered: projectPanelDiagnostic(panel, rolled),
              })
            signalsRef.current = { ...signalsRef.current, [panel.id]: rolled }
            setSignals(signalsRef.current)
          } else if (!cancelled) recordUpdateFailure('No usable pull-request observations.')
          inFlight = false
          abortControllers.delete(activeController)
          if (!cancelled) {
            const next = resolveNextPoll(lastEnvelope, Date.now(), settings)
            const due = Date.now() + next.delayMillis
            updateSchedule(panel.id, {
              inFlight: false,
              cadence: next.cadence,
              nextDueAt: new Date(due).toISOString(),
            })
            const nextTimer = window.setTimeout(() => {
              timers.delete(nextTimer)
              void refreshPullRequestHealth()
            }, next.delayMillis)
            timers.add(nextTimer)
          }
        }
        void refreshPullRequestHealth()
        continue
      }
      const refresh = () => {
        if (cancelled || inFlight) return
        inFlight = true
        updateSchedule(panel.id, {
          inFlight: true,
          lastRequestStartedAt: new Date().toISOString(),
          nextDueAt: undefined,
        })
        diagnostics.record({ kind: 'panel-fetch-start', panelId: panel.id, path })
        dashboardFetch(env, path)
          .then(async (response) => {
            const transport = {
              kind: 'panel-fetch-response' as const,
              panelId: panel.id,
              path,
              status: response.status,
              cache: cacheMetadata(response.headers),
            }
            if (response.status === 304) {
              diagnostics.record(transport)
              recordConfirmedUpdate()
              return undefined
            }
            try {
              const value: unknown = await response.json()
              const envelope = parseEnvelope(value)
              if (!envelope) {
                diagnostics.record(transport)
                diagnostics.record({
                  kind: 'panel-fetch-parse-failure',
                  panelId: panel.id,
                  path,
                  message: 'Response was not a valid signal envelope.',
                })
                recordUpdateFailure('Response was not a valid signal envelope.')
                return undefined
              }
              diagnostics.record({
                ...transport,
                envelope,
                ...(envelope.state === 'error'
                  ? { failure: failedObservation(envelope, response) }
                  : {}),
              })
              recordConfirmedUpdate()
              return { envelope, cache: transport.cache, status: response.status }
            } catch (error) {
              diagnostics.record(transport)
              diagnostics.record({
                kind: 'panel-fetch-parse-failure',
                panelId: panel.id,
                path,
                message: errorMessage(error),
              })
              throw new DiagnosticParseFailure(error)
            }
          })
          .then((result) => {
            if (!result) return
            let envelope = result.envelope
            if (panel.type === 'pipeline-status') {
              const identity = resolvePanelMemoryIdentity(env.board, panel)
              const accepted = memory.latest(identity)
              const reconciliation = reconcilePipelineResponse({
                envelope,
                accepted,
                estimatedDurationMs: memory.resolveEstimatedDuration(identity),
              })
              if (reconciliation.kind === 'rejected' && accepted) {
                const signal = reconciliation.signal
                diagnostics.recordGithubConsistencyIncident({
                  panelId: panel.id,
                  endpoint: path,
                  identity: {
                    source: identity.source,
                    workflow: identity.workflow,
                    branch: identity.branch,
                  },
                  accepted,
                  regressed: {
                    sourceUpdatedAt: signal.sourceUpdatedAt,
                    status: signal.status,
                    link: envelope.link,
                  },
                  response: {
                    httpStatus: result.status,
                    date: result.cache?.date,
                    etag: result.cache?.etag,
                    cacheControl: result.cache?.cacheControl,
                  },
                })
                return
              }
              if (reconciliation.kind === 'accepted') {
                envelope = reconciliation.envelope
                if (reconciliation.accepted)
                  memory.rememberLatest(identity, reconciliation.accepted)
                if (reconciliation.durationSample) {
                  const sample = {
                    link: reconciliation.durationSample.link,
                    ...(reconciliation.durationSample.sourceRunId
                      ? { sourceRunId: reconciliation.durationSample.sourceRunId }
                      : {}),
                    durationMs: reconciliation.durationSample.durationMs,
                    sourceUpdatedAt: reconciliation.durationSample.sourceUpdatedAt,
                  }
                  memory.recordRun(identity, sample, reconciliation.signal.status === 'passed')
                }
              }
            }
            lastEnvelope = envelope
            if (!cancelled) {
              const previous = signalsRef.current[panel.id]
              if (panelDiagnosticChanged(previous, panel, envelope)) {
                diagnostics.record({
                  kind: 'panel-rendered',
                  panelId: panel.id,
                  path,
                  rendered: projectPanelDiagnostic(panel, envelope),
                })
              }
              signalsRef.current = { ...signalsRef.current, [panel.id]: envelope }
              setSignals(signalsRef.current)
            }
          })
          .catch((error) => {
            recordUpdateFailure(error)
            if (!(error instanceof DiagnosticParseFailure)) {
              diagnostics.record({
                kind: 'panel-fetch-failure',
                panelId: panel.id,
                path,
                message: errorMessage(error),
              })
            }
          })
          .finally(() => {
            inFlight = false
            if (!cancelled) {
              const next = resolveNextPoll(lastEnvelope, Date.now(), settings)
              const due = Date.now() + next.delayMillis
              updateSchedule(panel.id, {
                inFlight: false,
                cadence: next.cadence,
                nextDueAt: new Date(due).toISOString(),
              })
              const nextTimer = window.setTimeout(() => {
                timers.delete(nextTimer)
                refresh()
              }, next.delayMillis)
              timers.add(nextTimer)
            }
          })
      }
      refresh()
    }
    return () => {
      cancelled = true
      for (const controller of abortControllers) controller.abort()
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [board, diagnostics, env])

  return { signals, updateHealth, factSignals, schedules }
}

function failedObservation(envelope: Extract<Envelope, { state: 'error' }>, response: Response) {
  const supportReference = response.headers.get('x-dashboard-request-id')
  return {
    reason: envelope.error.message,
    ...(supportReference ? { supportReference } : {}),
  }
}

function isCandidates(
  value: unknown,
): value is { type: 'pull-request-candidates'; pullRequests: Array<{ branch: string }> } {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'pull-request-candidates' &&
    Array.isArray((value as { pullRequests?: unknown }).pullRequests)
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class DiagnosticParseFailure extends Error {
  constructor(error: unknown) {
    super(errorMessage(error))
  }
}

function parseEnvelope(value: unknown): Envelope | undefined {
  const result = envelopeSchema.safeParse(value)
  return result.success ? result.data : undefined
}
