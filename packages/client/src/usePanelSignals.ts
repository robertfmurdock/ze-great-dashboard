import {
  type Board,
  type ClientEnv,
  type Envelope,
  envelopeSchema,
  parseDuration,
  resolveRefreshMillis,
} from '@ze-great-dashboard/shared'
import { useEffect, useRef, useState } from 'react'
import { cacheMetadata, type DiagnosticSink } from './diagnostics.ts'
import { panelDiagnosticChanged, projectPanelDiagnostic } from './panel-diagnostics.ts'

export function usePanelSignals({
  board,
  env,
  diagnostics,
}: {
  board: Board | undefined
  env: ClientEnv
  diagnostics: DiagnosticSink
}) {
  const [signals, setSignals] = useState<Record<string, Envelope | undefined>>({})
  const signalsRef = useRef<Record<string, Envelope | undefined>>({})

  useEffect(() => {
    signalsRef.current = {}
    setSignals({})
    if (!board) return

    let cancelled = false
    const timers: number[] = []
    for (const panel of board.panels) {
      if (
        panel.type !== 'pipeline-status' &&
        panel.type !== 'pull-request-health' &&
        panel.type !== 'http-value'
      )
        continue
      let inFlight = false
      const refreshMillis = resolveRefreshMillis({
        boardDefaultMillis: parseDuration(board.refresh ?? '60s') ?? 60_000,
        panelOverrideMillis: panel.refresh
          ? (parseDuration(panel.refresh) ?? undefined)
          : undefined,
        adapterFloorMillis: 0,
      })
      const path = `${env.proxyPath}/panel/${encodeURIComponent(env.board)}/${encodeURIComponent(panel.id)}`
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
              return envelope
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
          .then((envelope) => {
            if (!cancelled && envelope) {
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
          })
      }
      refresh()
      timers.push(window.setInterval(refresh, refreshMillis))
    }
    return () => {
      cancelled = true
      for (const timer of timers) window.clearInterval(timer)
    }
  }, [board, diagnostics, env.board, env.proxyPath])

  return signals
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
