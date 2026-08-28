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
import { reconcilePipelineResponse } from './pipeline-reconciliation.ts'
import { nextPollDelayMillis } from './polling-schedule.ts'

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
  const [checkedAt, setCheckedAt] = useState<Record<string, string | undefined>>({})
  const signalsRef = useRef<Record<string, Envelope | undefined>>({})
  const memoryRef = useRef<BrowserPanelMemory | null>(null)
  if (!memoryRef.current) memoryRef.current = memory ?? new BrowserPanelMemory()

  useEffect(() => {
    signalsRef.current = {}
    setSignals({})
    setCheckedAt({})
    if (!board) return

    let cancelled = false
    const timers = new Set<number>()
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
      const refresh = () => {
        if (cancelled || inFlight) return
        inFlight = true
        diagnostics.record({ kind: 'panel-fetch-start', panelId: panel.id, path })
        fetch(path)
          .then(async (response) => {
            if (!cancelled) {
              setCheckedAt((current) => ({
                ...current,
                [panel.id]: new Date().toISOString(),
              }))
            }
            const transport = {
              kind: 'panel-fetch-response' as const,
              panelId: panel.id,
              path,
              status: response.status,
              cache: cacheMetadata(response.headers),
            }
            if (response.status === 304) {
              diagnostics.record(transport)
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
                return undefined
              }
              diagnostics.record({ ...transport, envelope })
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
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [board, diagnostics, env.board, env.proxyPath])

  return { signals, checkedAt }
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
