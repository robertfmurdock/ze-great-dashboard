import type { Board, ClientEnv } from '@ze-great-dashboard/shared/browser'
import { useEffect, useState } from 'react'
import type { DashboardAuth } from './dashboard-fetch.ts'
import { dashboardFetch } from './dashboard-fetch.ts'
import { cacheMetadata, type DiagnosticSink } from './diagnostics.ts'

/** Fetches the board configuration and records the evidence that led to its rendered shape. */
export function useBoardConfig({
  env,
  diagnostics,
  auth,
}: {
  env: ClientEnv
  diagnostics: DiagnosticSink
  auth?: DashboardAuth
}) {
  const [board, setBoard] = useState<Board>()
  const [loadedBoardName, setLoadedBoardName] = useState<string>()

  useEffect(() => {
    let cancelled = false
    setBoard(undefined)
    setLoadedBoardName(undefined)
    const path = `${env.proxyPath}/boards/${encodeURIComponent(env.board)}`
    diagnostics.record({ kind: 'board-fetch-start', path })
    dashboardFetch(env, path, undefined, globalThis.fetch, auth)
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
        if (cancelled) return
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
      })
      .catch((error) => {
        if (!(error instanceof DiagnosticParseFailure))
          diagnostics.record({ kind: 'board-fetch-failure', path, message: errorMessage(error) })
        if (!cancelled) {
          setBoard({ panels: [] })
          setLoadedBoardName(env.board)
        }
      })
    return () => {
      cancelled = true
    }
  }, [auth, diagnostics, env])

  return { board, loadedBoardName }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

class DiagnosticParseFailure extends Error {
  constructor(error: unknown) {
    super(errorMessage(error))
  }
}
