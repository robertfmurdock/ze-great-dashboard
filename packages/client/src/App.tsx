import {
  type Board,
  type ClientEnv,
  type Envelope,
  parseDuration,
  pipelineStatusSchema,
  resolveRefreshMillis,
} from '@ze-great-dashboard/shared'
import { useEffect, useRef, useState } from 'react'
import { Diagnostics } from './Diagnostics.tsx'
import { cacheMetadata, DiagnosticLog } from './diagnostics.ts'
import { HttpValuePanel } from './HttpValuePanel.tsx'
import { PanelPlaceholder } from './PanelPlaceholder.tsx'
import { PipelinePanel, parseEnvelope } from './PipelinePanel.tsx'

/**
 * The board shell.
 *
 * Stage 1 has no data: there is no proxy endpoint to poll yet. What this proves is the plumbing —
 * that the client was handed its configuration by the server and knows which version of itself it
 * is. The version readout is what makes two published versions visibly different, which is the
 * whole point of the Stage 1 exit criterion.
 */
export function App({ env }: { env: ClientEnv }) {
  const [board, setBoard] = useState<Board>()
  const [loadedBoardName, setLoadedBoardName] = useState<string>()
  const [signals, setSignals] = useState<Record<string, Envelope | undefined>>({})
  const diagnosticsRef = useRef<DiagnosticLog | null>(null)
  const signalsRef = useRef<Record<string, Envelope | undefined>>({})
  if (!diagnosticsRef.current) diagnosticsRef.current = new DiagnosticLog(env)
  const diagnostics = diagnosticsRef.current

  useEffect(() => {
    let cancelled = false
    setBoard(undefined)
    setLoadedBoardName(undefined)
    setSignals({})
    signalsRef.current = {}
    const path = `${env.proxyPath}/boards/${encodeURIComponent(env.board)}`
    diagnostics.record({ kind: 'board-fetch-start', path })
    fetch(path)
      .then(async (response) => {
        diagnostics.record({
          kind: 'board-fetch-response',
          path,
          status: response.status,
          cache: cacheMetadata(response.headers),
        })
        if (!response.ok) throw new Error(`Board configuration returned ${response.status}`)
        try {
          return await response.json()
        } catch (error) {
          diagnostics.record({
            kind: 'board-fetch-parse-failure',
            path,
            message: errorMessage(error),
          })
          throw new DiagnosticParseFailure(error)
        }
      })
      .then((value: unknown) => {
        if (!cancelled) {
          setBoard(value as Board)
          setLoadedBoardName(env.board)
          const panels = Array.isArray((value as { panels?: unknown }).panels)
            ? (value as { panels: Array<{ id?: unknown }> }).panels
            : []
          diagnostics.record({
            kind: 'board-fetch-response',
            path,
            boardSummary: {
              panelCount: panels.length,
              panelIds: panels.flatMap((panel) => (typeof panel.id === 'string' ? [panel.id] : [])),
            },
          })
        }
      })
      .catch((error) => {
        if (!(error instanceof DiagnosticParseFailure)) {
          diagnostics.record({ kind: 'board-fetch-failure', path, message: errorMessage(error) })
        }
        if (!cancelled) {
          setBoard({ panels: [] })
          setLoadedBoardName(env.board)
        }
      })
    return () => {
      cancelled = true
    }
  }, [diagnostics, env.board, env.proxyPath])

  useEffect(() => {
    if (!board || loadedBoardName !== env.board) return
    let cancelled = false
    const timers: number[] = []

    for (const panel of board.panels) {
      if (panel.type !== 'pipeline-status' && panel.type !== 'http-value') continue

      let inFlight = false
      const refreshMillis = resolveRefreshMillis({
        boardDefaultMillis: parseDuration(board.refresh ?? '60s') ?? 60_000,
        panelOverrideMillis: panel.refresh
          ? (parseDuration(panel.refresh) ?? undefined)
          : undefined,
        adapterFloorMillis: 0,
      })

      const refresh = () => {
        if (cancelled || inFlight) return
        inFlight = true
        const path = `${env.proxyPath}/panel/${encodeURIComponent(env.board)}/${encodeURIComponent(panel.id)}`
        diagnostics.record({ kind: 'panel-fetch-start', panelId: panel.id, path })
        fetch(path)
          .then(async (response) => {
            diagnostics.record({
              kind: 'panel-fetch-response',
              panelId: panel.id,
              path,
              status: response.status,
              cache: cacheMetadata(response.headers),
            })
            if (response.status === 304) return undefined
            try {
              return await response.json()
            } catch (error) {
              diagnostics.record({
                kind: 'panel-fetch-parse-failure',
                panelId: panel.id,
                path,
                message: errorMessage(error),
              })
              throw new DiagnosticParseFailure(error)
            }
          })
          .then((value: unknown) => {
            const envelope = parseEnvelope(value)
            if (value !== undefined && !envelope) {
              diagnostics.record({
                kind: 'panel-fetch-parse-failure',
                panelId: panel.id,
                path,
                message: 'Response was not a valid signal envelope.',
              })
            }
            if (!cancelled && envelope) {
              diagnostics.record({
                kind: 'panel-fetch-response',
                panelId: panel.id,
                path,
                envelope,
              })
              const previous = signalsRef.current[panel.id]
              if (renderedChanged(previous, envelope)) {
                diagnostics.record({
                  kind: 'panel-rendered',
                  panelId: panel.id,
                  path,
                  rendered: renderedState(envelope),
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
  }, [board, diagnostics, env.board, env.proxyPath, loadedBoardName])

  return (
    <div className="board">
      <header className="board__header">
        <h1 className="board__title">{env.board}</h1>
        <dl className="board__meta">
          <div>
            <dt>client</dt>
            <dd>{env.clientVersion}</dd>
          </div>
          <div>
            <dt>assets</dt>
            <dd>{env.assetPath}</dd>
          </div>
        </dl>
      </header>

      <main className="board__grid">
        {!board && <PanelPlaceholder label="board" hint="Loading configuration…" wide />}
        {board?.panels.map((panel) =>
          panel.type === 'pipeline-status' ? (
            <PipelinePanel key={panel.id} panel={panel} data={signals[panel.id]} />
          ) : panel.type === 'http-value' ? (
            <HttpValuePanel key={panel.id} panel={panel} data={signals[panel.id]} />
          ) : (
            <PanelPlaceholder key={panel.id} label={panel.type} hint="Not wired yet" wide />
          ),
        )}
      </main>

      <footer className="board__footer">
        <span>Signals are read live from their configured authorities.</span>
        <Diagnostics log={diagnostics} />
      </footer>
    </div>
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

function renderedState(envelope: Envelope) {
  if (envelope.state === 'error') return { state: envelope.state, link: envelope.link }
  const signal = pipelineStatusSchema.safeParse(envelope.signal)
  return {
    state: envelope.state,
    status: signal.success ? signal.data.status : undefined,
    link: envelope.link,
  }
}

function renderedChanged(previous: Envelope | undefined, next: Envelope) {
  if (!previous) return true
  const before = renderedState(previous)
  const after = renderedState(next)
  return (
    before.state !== after.state || before.status !== after.status || before.link !== after.link
  )
}
