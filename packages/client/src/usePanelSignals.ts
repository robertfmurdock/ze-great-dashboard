import {
  type Board,
  type ClientEnv,
  type Envelope,
  envelopeSchema,
  isZeroPosition,
  resolvePollingSettings,
} from '@ze-great-dashboard/shared'
import { useEffect, useRef, useState } from 'react'
import { cacheMetadata, type DiagnosticSink } from './diagnostics.ts'
import { panelDiagnosticChanged, projectPanelDiagnostic } from './panel-diagnostics.ts'
import { BrowserPanelMemory, resolvePanelMemoryIdentity } from './panel-memory.ts'
import type { PanelUpdateHealth } from './panel-props.ts'
import { reconcilePipelineResponse } from './pipeline-reconciliation.ts'
import { nextPollDelayMillis } from './polling-schedule.ts'
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
  const signalsRef = useRef<Record<string, Envelope | undefined>>({})
  const memoryRef = useRef<BrowserPanelMemory | null>(null)
  if (!memoryRef.current) memoryRef.current = memory ?? new BrowserPanelMemory()

  useEffect(() => {
    signalsRef.current = {}
    setSignals({})
    setUpdateHealth({})
    if (!board) return

    let cancelled = false
    const timers = new Set<number>()
    const abortControllers = new Set<AbortController>()
    for (const panel of board.panels) {
      if (isZeroPosition(panel.position)) continue
      if (
        panel.type !== 'pipeline-status' &&
        panel.type !== 'pull-request-health' &&
        panel.type !== 'http-value'
      )
        continue
      let inFlight = false
      const memory = memoryRef.current
      if (!memory) return
      const settings = resolvePollingSettings(board, panel)
      const path = `${env.proxyPath}/panel/${encodeURIComponent(env.board)}/${encodeURIComponent(panel.id)}`
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
      if (panel.type === 'pull-request-health') {
        const workflows = readUpdateWorkflows(panel)
        const components = new Map<string, Envelope>()
        let activeController: AbortController | undefined
        const request = async (componentPath: string) => {
          diagnostics.record({ kind: 'panel-fetch-start', panelId: panel.id, path: componentPath })
          try {
            const response = await fetch(componentPath, { signal: activeController?.signal })
            const transport = {
              kind: 'panel-fetch-response' as const,
              panelId: panel.id,
              path: componentPath,
              status: response.status,
              cache: cacheMetadata(response.headers),
            }
            if (response.status === 304) {
              diagnostics.record(transport)
              const cached = components.get(componentPath)
              return cached
                ? { envelope: cached }
                : { error: 'Source returned not modified before an initial observation.' }
            }
            const value: unknown = await response.json()
            const envelope = parseEnvelope(value)
            diagnostics.record({ ...transport, ...(envelope ? { envelope } : {}) })
            if (!envelope) return { error: 'Response was not a valid signal envelope.' }
            if (envelope.state === 'error') return { error: envelope.error.message }
            components.set(componentPath, envelope)
            return { envelope }
          } catch (error) {
            if (activeController?.signal.aborted) return { error: 'Observation cancelled.' }
            diagnostics.record({
              kind: 'panel-fetch-failure',
              panelId: panel.id,
              path: componentPath,
              message: errorMessage(error),
            })
            return { error: errorMessage(error) }
          }
        }
        const refreshPullRequestHealth = async () => {
          if (cancelled || inFlight) return
          inFlight = true
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
            const nextTimer = window.setTimeout(
              () => {
                timers.delete(nextTimer)
                void refreshPullRequestHealth()
              },
              nextPollDelayMillis(lastEnvelope, Date.now(), settings),
            )
            timers.add(nextTimer)
          }
        }
        void refreshPullRequestHealth()
        continue
      }
      const refresh = () => {
        if (cancelled || inFlight) return
        inFlight = true
        diagnostics.record({ kind: 'panel-fetch-start', panelId: panel.id, path })
        fetch(path)
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
              diagnostics.record({ ...transport, envelope })
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
              const nextTimer = window.setTimeout(
                () => {
                  timers.delete(nextTimer)
                  refresh()
                },
                nextPollDelayMillis(lastEnvelope, Date.now(), settings),
              )
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
  }, [board, diagnostics, env.board, env.proxyPath])

  return { signals, updateHealth }
}

function readUpdateWorkflows(panel: Board['panels'][number]) {
  const value = panel.update_workflows
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as { workflow?: unknown }).workflow === 'string'
      ? [{ workflow: (entry as { workflow: string }).workflow }]
      : [],
  )
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
