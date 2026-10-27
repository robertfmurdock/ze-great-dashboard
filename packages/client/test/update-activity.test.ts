import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { PollingSettings } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import type { DiagnosticEvent, DiagnosticRetention } from '../src/diagnostics.ts'
import type { PollingScheduleSnapshot } from '../src/polling-schedule.ts'
import { projectUpdateActivity } from '../src/update-activity.ts'

const now = new Date('2026-09-03T12:00:00.000Z')
const settings: PollingSettings = {
  refreshMillis: 60_000,
  runningRefreshMillis: 15_000,
  runningCompletionRefreshMillis: 5_000,
  runningCompletionWindowMillis: 120_000,
}
const schedule: PollingScheduleSnapshot = {
  panelId: 'versions',
  label: 'Versions',
  settings,
  cadence: 'normal',
  inFlight: false,
  lastRequestStartedAt: '2026-09-03T11:59:00.000Z',
  nextDueAt: '2026-09-03T12:00:00.000Z',
  knownPaths: ['/api/panel/team/versions/facts/api', '/api/panel/team/versions/facts/web'],
}
const retention: DiagnosticRetention = { eventsPrunedByAge: 0, eventsPrunedByCount: 0 }
const [apiPath, webPath] = schedule.knownPaths
if (!apiPath || !webPath) throw new Error('Expected compound-panel proxy paths.')

function event(path: string, at = '2026-09-03T11:59:00.000Z'): DiagnosticEvent {
  return {
    kind: 'panel-fetch-start',
    panelId: 'versions',
    path,
    at,
    schemaVersion: 2,
    sessionId: 'x',
    board: 'team',
    clientVersion: 'dev',
    clientAssetPath: 'x',
    clientAssetPathId: 'x',
  }
}

describe('update activity projection', () => {
  test(
    'groups compound-panel request starts by their actual proxy paths',
    mint({
      setup: () => ({
        schedules: [schedule],
        events: [event(apiPath), event(webPath)],
      }),
      exercise: ({ schedules, events }) =>
        projectUpdateActivity({ schedules, events, retention, now }),
      verify: (activity) => {
        expect(activity.lanes[0]?.observed).toEqual([
          { path: apiPath, starts: ['2026-09-03T11:59:00.000Z'] },
          { path: webPath, starts: ['2026-09-03T11:59:00.000Z'] },
        ])
        expect(activity.lanes[0]).toMatchObject({
          label: 'Versions',
          panelId: 'versions',
          nextDueAt: schedule.nextDueAt,
        })
      },
    }),
  )

  test(
    'keeps schedule expectation separate from empty or pruned retained evidence',
    mint({
      setup: () => ({
        schedules: [{ ...schedule, cadence: 'completion-window' as const, inFlight: true }],
        events: [event(apiPath, '2026-09-03T11:40:00.000Z')],
        retention: { eventsPrunedByAge: 1, eventsPrunedByCount: 0 },
      }),
      exercise: ({ schedules, events, retention }) =>
        projectUpdateActivity({ schedules, events, retention, now }),
      verify: (activity) => {
        expect(activity.lanes[0]).toMatchObject({
          hasRetainedEvidence: false,
          cadence: 'completion-window',
          inFlight: true,
        })
        expect(activity.evidenceMayBeIncomplete).toBe(true)
        expect(activity.window).toEqual({
          from: '2026-09-03T11:50:00.000Z',
          to: '2026-09-03T12:00:00.000Z',
        })
      },
    }),
  )
})
