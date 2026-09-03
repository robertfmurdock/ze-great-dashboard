import type { DiagnosticEvent, DiagnosticRetention } from './diagnostics.ts'
import type { PollingScheduleSnapshot } from './polling-schedule.ts'

export const updateActivityWindowMillis = 10 * 60 * 1_000

export type UpdateActivitySnapshot = {
  capturedAt: string
  window: { from: string; to: string }
  schedules: PollingScheduleSnapshot[]
}

export type UpdateActivityLane = PollingScheduleSnapshot & {
  observed: Array<{ path: string; starts: string[] }>
  hasRetainedEvidence: boolean
}

export function projectUpdateActivity({
  schedules,
  events,
  retention,
  now = new Date(),
}: {
  schedules: PollingScheduleSnapshot[]
  events: DiagnosticEvent[]
  retention: DiagnosticRetention
  now?: Date
}): UpdateActivitySnapshot & {
  lanes: UpdateActivityLane[]
  evidenceMayBeIncomplete: boolean
} {
  const toMillis = now.valueOf()
  const fromMillis = toMillis - updateActivityWindowMillis
  const starts = events.filter(
    (event): event is Extract<DiagnosticEvent, { kind: 'panel-fetch-start' }> =>
      event.kind === 'panel-fetch-start' &&
      Number.isFinite(Date.parse(event.at)) &&
      Date.parse(event.at) >= fromMillis &&
      Date.parse(event.at) <= toMillis,
  )
  const lanes = schedules.map((schedule) => {
    const paths = new Map<string, string[]>()
    for (const event of starts) {
      if (event.panelId !== schedule.panelId) continue
      const observed = paths.get(event.path) ?? []
      observed.push(event.at)
      paths.set(event.path, observed)
    }
    return {
      ...schedule,
      observed: [...paths.entries()].map(([path, requestStarts]) => ({
        path,
        starts: requestStarts,
      })),
      hasRetainedEvidence: paths.size > 0,
    }
  })
  return {
    capturedAt: now.toISOString(),
    window: { from: new Date(fromMillis).toISOString(), to: now.toISOString() },
    schedules,
    lanes,
    evidenceMayBeIncomplete: retention.eventsPrunedByAge > 0 || retention.eventsPrunedByCount > 0,
  }
}
