import type {
  DiagnosticEvent,
  DiagnosticRetention,
  RenderedPanelDiagnostic,
} from './diagnostics.ts'

export type PanelDiagnosticsSummary = {
  panelId: string
  requests: number
  httpStatuses: Record<string, number>
  parseFailures: number
  networkFailures: number
  visibleStateChanges: number
  latestRendered?: RenderedPanelDiagnostic
}

export type DiagnosticsSummary = {
  githubConsistencyIncidents: number
  retained: {
    eventCount: number
    firstEventAt?: string
    lastEventAt?: string
    sessionCount: number
    retention: DiagnosticRetention
    evidenceMayBeIncomplete: boolean
  }
  failures: {
    clientUpdate: number
    boardFetch: number
  }
  panels: PanelDiagnosticsSummary[]
}

/** Summarizes retained browser evidence only; omitted history is disclosed through retention. */
export function summarizeDiagnostics(
  events: readonly DiagnosticEvent[],
  retention: DiagnosticRetention,
  githubConsistencyIncidents = 0,
): DiagnosticsSummary {
  const panels = new Map<string, PanelDiagnosticsSummary>()
  const sessions = new Set<string>()
  let clientUpdate = 0
  let boardFetch = 0

  for (const event of events) {
    sessions.add(event.sessionId)
    if (event.kind === 'client-update-failure') clientUpdate++
    if (event.kind === 'board-fetch-failure' || event.kind === 'board-fetch-parse-failure')
      boardFetch++
    if (!('panelId' in event)) continue

    const panel = panels.get(event.panelId) ?? {
      panelId: event.panelId,
      requests: 0,
      httpStatuses: {},
      parseFailures: 0,
      networkFailures: 0,
      visibleStateChanges: 0,
    }
    if (event.kind === 'panel-fetch-start') panel.requests++
    if (event.kind === 'panel-fetch-response') {
      if (event.status !== undefined) {
        const status = String(event.status)
        panel.httpStatuses[status] = (panel.httpStatuses[status] ?? 0) + 1
      }
    }
    if (event.kind === 'panel-fetch-parse-failure') panel.parseFailures++
    if (event.kind === 'panel-fetch-failure') panel.networkFailures++
    if (event.kind === 'panel-rendered') {
      panel.visibleStateChanges++
      panel.latestRendered = event.rendered
    }
    panels.set(event.panelId, panel)
  }

  const timestamps = events.map((event) => event.at).sort()
  const discarded = retention.eventsPrunedByAge + retention.eventsPrunedByCount
  return {
    githubConsistencyIncidents,
    retained: {
      eventCount: events.length,
      firstEventAt: timestamps[0],
      lastEventAt: timestamps.at(-1),
      sessionCount: sessions.size,
      retention,
      evidenceMayBeIncomplete: discarded > 0,
    },
    failures: { clientUpdate, boardFetch },
    panels: [...panels.values()].sort((left, right) => left.panelId.localeCompare(right.panelId)),
  }
}
