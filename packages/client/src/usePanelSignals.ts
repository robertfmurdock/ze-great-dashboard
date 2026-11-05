import {
  type Board,
  type ClientEnv,
  type Envelope,
  envelopeSchema,
  testHistoryHeader,
} from '@ze-great-dashboard/shared/browser'
import { useEffect, useRef, useState } from 'react'
import type { DashboardAuth } from './dashboard-fetch.ts'
import { dashboardFetch } from './dashboard-fetch.ts'
import { cacheMetadata, type DiagnosticSink, type RenderedPanelDiagnostic } from './diagnostics.ts'
import { projectHttpValueFactsDiagnostic, projectPanelDiagnostic } from './panel-diagnostics.ts'
import { BrowserPanelMemory, resolvePanelMemoryIdentity } from './panel-memory.ts'
import { readPanelObservation } from './panel-observation.ts'
import type {
  HttpValueFactObservation,
  PanelUpdateHealth,
  RejectedPipelinePresentation,
} from './panel-props.ts'
import { panelFeature } from './panel-registry.tsx'
import { applyPipelinePresentation, reconcilePipelineResponse } from './pipeline-reconciliation.ts'
import {
  initialPollingSchedule,
  panelProxyPath,
  pollingPanels,
  readUpdateWorkflows,
} from './polling-panels.ts'
import { type PollingScheduleSnapshot, resolveNextPoll } from './polling-schedule.ts'
import { rollupPullRequestHealth } from './pull-request-rollup.ts'
import { projectTestDirection, type TestDirection } from './test-direction.ts'
import { TestHistoryRepair } from './test-history-repair.ts'

export function usePanelSignals({
  board,
  env,
  diagnostics,
  memory,
  auth,
}: {
  board: Board | undefined
  env: ClientEnv
  diagnostics: DiagnosticSink
  memory?: BrowserPanelMemory
  auth?: DashboardAuth
}) {
  const [testDirections, setTestDirections] = useState<Record<string, TestDirection | undefined>>(
    {},
  )
  const testDirectionsRef = useRef<Record<string, TestDirection | undefined>>({})
  const [signals, setSignals] = useState<Record<string, Envelope | undefined>>({})
  const [updateHealth, setUpdateHealth] = useState<Record<string, PanelUpdateHealth | undefined>>(
    {},
  )
  const [factSignals, setFactSignals] = useState<
    Record<string, Record<string, HttpValueFactObservation | undefined> | undefined>
  >({})
  const [schedules, setSchedules] = useState<PollingScheduleSnapshot[]>([])
  const [rejectedPipelines, setRejectedPipelines] = useState<
    Record<string, RejectedPipelinePresentation | undefined>
  >({})
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
    setTestDirections({})
    testDirectionsRef.current = {}
    setUpdateHealth({})
    setFactSignals({})
    setSchedules([])
    setRejectedPipelines({})
    if (!board) return

    let cancelled = false
    const memory = memoryRef.current
    if (!memory) return
    const rendered = new Map<string, RenderedPanelDiagnostic>()
    const recordRendered = (
      panel: Board['panels'][number],
      projection: RenderedPanelDiagnostic,
    ) => {
      if (JSON.stringify(rendered.get(panel.id)) === JSON.stringify(projection)) return
      rendered.set(panel.id, projection)
      diagnostics.record({
        kind: 'panel-rendered',
        panelId: panel.id,
        path: panelProxyPath(env, panel.id),
        rendered: projection,
      })
    }
    const publish = (panel: Board['panels'][number], envelope: Envelope) => {
      if (cancelled) return
      const direction = panelFeature(panel.type)?.testHistory
        ? memory.testDirection(env.board, panel, envelope)
        : undefined
      const projected = projectTestDirection(direction)
      recordRendered(panel, {
        ...projectPanelDiagnostic(panel, envelope),
        ...(projected ? { testDirection: projected } : {}),
      })
      testDirectionsRef.current = { ...testDirectionsRef.current, [panel.id]: direction }
      setTestDirections(testDirectionsRef.current)
      signalsRef.current = { ...signalsRef.current, [panel.id]: envelope }
      setSignals(signalsRef.current)
    }
    const publishFacts = (
      panel: Board['panels'][number],
      facts: Record<string, HttpValueFactObservation | undefined>,
    ) => {
      if (cancelled) return
      recordRendered(panel, projectHttpValueFactsDiagnostic(facts))
      factSignalsRef.current = { ...factSignalsRef.current, [panel.id]: facts }
      setFactSignals(factSignalsRef.current)
    }
    const repairs = new TestHistoryRepair({
      board: env.board,
      memory,
      diagnostics,
      fetcher: (input, init) => dashboardFetch(env, input, init, globalThis.fetch, auth),
      onMerged: (panel) => {
        const envelope = signalsRef.current[panel.id]
        if (envelope) publish(panel, envelope)
      },
    })
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
    for (const { panel, polling } of panels) {
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
      type CurrentPoll = { signal: AbortSignal; healthy: boolean; historySupported: boolean }
      const poll = async (read: (cycle: CurrentPoll) => Promise<void>) => {
        if (cancelled || inFlight) return
        inFlight = true
        const controller = new AbortController()
        const cycle: CurrentPoll = {
          signal: controller.signal,
          healthy: false,
          historySupported: false,
        }
        abortControllers.add(controller)
        repairs.currentStarted(panel.id)
        updateSchedule(panel.id, {
          inFlight: true,
          lastRequestStartedAt: new Date().toISOString(),
          nextDueAt: undefined,
        })
        try {
          await read(cycle)
        } catch (error) {
          if (!cancelled && !cycle.signal.aborted) {
            recordUpdateFailure(error)
            if (!(error instanceof DiagnosticParseFailure))
              diagnostics.record({
                kind: 'panel-fetch-failure',
                panelId: panel.id,
                path,
                message: errorMessage(error),
              })
          }
        } finally {
          inFlight = false
          abortControllers.delete(controller)
          if (!cancelled && !cycle.signal.aborted) {
            const next = resolveNextPoll(lastEnvelope, Date.now(), settings)
            updateSchedule(panel.id, {
              inFlight: false,
              cadence: next.cadence,
              nextDueAt: new Date(Date.now() + next.delayMillis).toISOString(),
            })
            const timer = window.setTimeout(() => {
              timers.delete(timer)
              void poll(read)
            }, next.delayMillis)
            timers.add(timer)
          }
          repairs.currentSettled(panel, path, cycle.healthy, cycle.historySupported)
        }
      }
      switch (polling.kind) {
        case 'facts': {
          if (!panel.facts) break
          const facts = panel.facts
          const components = new Map<string, Envelope>()
          void poll(async ({ signal }) => {
            const observations = await Promise.all(
              facts.map(async (fact) => {
                const result = await readPanelObservation({
                  diagnostics,
                  panelId: panel.id,
                  path: `${path}/facts/${encodeURIComponent(fact.id)}`,
                  signal,
                  cache: components,
                  fetcher: (input, init) =>
                    dashboardFetch(env, input, init, globalThis.fetch, auth),
                })
                return [fact.id, result.error ? { failure: result.error } : result] as const
              }),
            )
            if (!signal.aborted) publishFacts(panel, Object.fromEntries(observations))
          })
          continue
        }
        case 'pull-request-health': {
          const workflows = readUpdateWorkflows(panel)
          const components = new Map<string, Envelope>()
          void poll(async ({ signal }) => {
            const request = async (componentPath: string) => {
              const result = await readPanelObservation({
                diagnostics,
                panelId: panel.id,
                path: componentPath,
                signal,
                cache: components,
                fetcher: (input, init) => dashboardFetch(env, input, init, globalThis.fetch, auth),
              })
              return result.envelope?.state === 'error'
                ? { error: result.envelope.error.message }
                : result
            }
            const [candidateResult, ...workflowResults] = await Promise.all([
              request(`${path}/pull-requests`),
              ...workflows.map(({ workflow }) =>
                request(`${path}/update-workflow/${encodeURIComponent(workflow)}`),
              ),
            ])
            if (cancelled || signal.aborted) return
            const candidates =
              candidateResult.envelope?.state === 'ok' &&
              isCandidates(candidateResult.envelope.signal)
                ? candidateResult.envelope.signal.pullRequests
                : []
            const buildResults = await Promise.all(
              candidates.map(
                async (candidate) =>
                  [
                    candidate.branch,
                    await request(
                      `${path}/pull-request-build?branch=${encodeURIComponent(candidate.branch)}`,
                    ),
                  ] as const,
              ),
            )
            if (cancelled || signal.aborted) return
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
            if (rolled) {
              lastEnvelope = rolled
              recordConfirmedUpdate()
              publish(panel, rolled)
            } else recordUpdateFailure('No usable pull-request observations.')
          })
          continue
        }
        case 'single':
          break
        default:
          polling satisfies never
      }
      void poll(async (cycle) => {
        diagnostics.record({ kind: 'panel-fetch-start', panelId: panel.id, path })
        const response = await dashboardFetch(
          env,
          path,
          { signal: cycle.signal },
          globalThis.fetch,
          auth,
        )
        cycle.historySupported =
          panelFeature(panel.type)?.testHistory === true &&
          response.headers.get(testHistoryHeader) === 'supported'
        const transport = {
          kind: 'panel-fetch-response' as const,
          panelId: panel.id,
          path,
          status: response.status,
          cache: cacheMetadata(response.headers),
        }
        if (response.status === 304) {
          cycle.healthy = lastEnvelope?.state === 'ok'
          diagnostics.record(transport)
          recordConfirmedUpdate()
          return
        }
        let envelope: Envelope
        try {
          const parsed = parseEnvelope(await response.json())
          if (!parsed) {
            diagnostics.record(transport)
            diagnostics.record({
              kind: 'panel-fetch-parse-failure',
              panelId: panel.id,
              path,
              message: 'Response was not a valid signal envelope.',
            })
            recordUpdateFailure('Response was not a valid signal envelope.')
            return
          }
          envelope = parsed
          diagnostics.record({
            ...transport,
            envelope,
            ...(envelope.state === 'error'
              ? { failure: failedObservation(envelope, response) }
              : {}),
          })
          cycle.healthy = envelope.state === 'ok'
          recordConfirmedUpdate()
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
        if (cancelled || cycle.signal.aborted) return
        const result = { status: response.status, cache: transport.cache }
        if (panel.type === 'pipeline-status') {
          const identity = resolvePanelMemoryIdentity(env.board, panel)
          const accepted = memory.latest(identity)
          const reconciliation = reconcilePipelineResponse({
            envelope,
            accepted,
            estimatedDurationMs: memory.resolveEstimatedDuration(identity),
          })
          const presentation = applyPipelinePresentation({
            current: signalsRef.current[panel.id],
            reconciliation,
            accepted,
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
            if (!cancelled)
              setRejectedPipelines((current) => ({
                ...current,
                [panel.id]: presentation.rejected,
              }))
            return
          }
          if (reconciliation.kind === 'accepted') {
            envelope = reconciliation.envelope
            if (!cancelled && presentation.rejected === undefined)
              setRejectedPipelines((current) => {
                if (!current[panel.id]) return current
                const next = { ...current }
                delete next[panel.id]
                return next
              })
            if (reconciliation.accepted) memory.rememberLatest(identity, reconciliation.accepted)
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
        if (panelFeature(panel.type)?.testHistory) memory.observeTests(env.board, panel, envelope)
        publish(panel, envelope)
      })
    }

    return () => {
      cancelled = true
      repairs.dispose()
      for (const controller of abortControllers) controller.abort()
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [auth, board, diagnostics, env])

  return { signals, updateHealth, factSignals, schedules, rejectedPipelines, testDirections }
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
