import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import type { ClientEnv } from '@ze-great-dashboard/shared/browser'
import { describe, expect } from 'vitest'
import {
  BrowserDiagnosticStore,
  type DiagnosticEvent,
  diagnosticsSchemaVersion,
} from '../src/diagnostics.ts'
import { summarizeDiagnostics } from '../src/diagnostics-summary.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  assetPathId: 'sha256:3f454a601d3791a603e550652cec7ca1fb4359489df99605e72e051dd5b02731',
  proxyPath: '/api',
  board: 'ze-great-team',
}

function memory(initial?: string) {
  const values = new Map<string, string>()
  if (initial) values.set('ze-great-dashboard.diagnostics.v2', initial)
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, next: string) => {
      values.set(key, next)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    value: () => values.get('ze-great-dashboard.diagnostics.v2') ?? null,
  }
}

describe('browser-local diagnostics', () => {
  const now = () => new Date('2026-08-21T12:00:00Z')

  describe('event recording and export', () => {
    mintTest('exports public client metadata and retained events', {
      setup: () => ({ log: new BrowserDiagnosticStore(env, memory(), now) }),
      exercise: ({ log }) => {
        log.record({
          kind: 'panel-fetch-start',
          panelId: 'build',
          path: '/api/panel/ze-great-team/build',
        })
        return log.export()
      },
      verify: (exported) => {
        expect(exported).toMatchObject({
          schemaVersion: diagnosticsSchemaVersion,
          client: { version: 'dev', board: 'ze-great-team', assetPathId: env.assetPathId },
          summary: { retained: { eventCount: 2, evidenceMayBeIncomplete: false } },
          events: expect.arrayContaining([expect.objectContaining({ panelId: 'build' })]),
        })
      },
    })

    mintTest(
      'stamps new events with the client identity while retaining historical events unchanged',
      {
        setup: () => {
          const historical = {
            schemaVersion: diagnosticsSchemaVersion,
            events: [
              {
                schemaVersion: diagnosticsSchemaVersion,
                at: '2026-08-21T11:00:00.000Z',
                sessionId: 'historic',
                board: 'ze-great-team',
                kind: 'board-fetch-start',
                path: '/api/boards/ze-great-team',
              },
            ],
          }
          return { log: new BrowserDiagnosticStore(env, memory(JSON.stringify(historical)), now) }
        },
        exercise: ({ log }) => {
          log.record({
            kind: 'client-update-response',
            path: '/api/client',
            serverVersion: 'server-1.4.0',
            assetPathIdMatches: true,
          })
          return log.export().events
        },
        verify: (events) => {
          expect(events.find((event) => event.sessionId === 'historic')).not.toHaveProperty(
            'clientVersion',
          )
          expect(events.find((event) => event.kind === 'client-update-response')).toMatchObject({
            clientVersion: 'dev',
            clientAssetPath: env.assetPath,
            clientAssetPathId: env.assetPathId,
            serverVersion: 'server-1.4.0',
            assetPathIdMatches: true,
          })
        },
      },
    )
  })

  describe('persisted-store loading', () => {
    mintTest('expires old events and retains at most 2,000', {
      setup: () => {
        const current = now()
        const stale = new Date(current.valueOf() - 8 * 24 * 60 * 60 * 1_000).toISOString()
        const events = Array.from({ length: 2_100 }, (_, index) => ({
          at: index === 0 ? stale : current.toISOString(),
          sessionId: 'old',
          board: 'ze-great-team',
          kind: 'panel-fetch-start',
          panelId: String(index),
        }))
        const store = memory(JSON.stringify({ schemaVersion: diagnosticsSchemaVersion, events }))
        return { stale, log: new BrowserDiagnosticStore(env, store, now) }
      },
      exercise: ({ log }) => ({ count: log.count(), exported: log.export() }),
      verify: ({ count, exported }, { stale }) => {
        expect(count).toBe(2_000)
        expect(exported.events.some((event) => event.at === stale)).toBe(false)
        expect(exported.summary.retained.retention).toEqual({
          eventsPrunedByAge: 1,
          eventsPrunedByCount: 100,
        })
      },
    })

    for (const { persistedPayload, scenario } of [
      { scenario: 'invalid JSON', persistedPayload: 'not json' },
      {
        scenario: 'an unsupported schema version',
        persistedPayload: JSON.stringify({ schemaVersion: 99, events: [] }),
      },
      {
        scenario: 'an invalid event shape',
        persistedPayload: JSON.stringify({
          schemaVersion: diagnosticsSchemaVersion,
          events: [{ kind: 'not-a-real-event' }],
        }),
      },
    ] as const) {
      mintTest(`discards ${scenario} without affecting diagnostics`, {
        setup: () => {
          const store = memory(persistedPayload)
          return { log: new BrowserDiagnosticStore(env, store, now), store }
        },
        exercise: ({ log, store }) => ({ count: log.count(), persisted: store.value() }),
        verify: ({ count, persisted }) => {
          expect(count).toBe(1)
          expect(persisted).toContain(String(diagnosticsSchemaVersion))
        },
      })
    }

    mintTest('purges legacy v1 diagnostics instead of retaining historic raw error text', {
      setup: () => {
        const values = new Map<string, string>([
          ['ze-great-dashboard.diagnostics.v1', JSON.stringify({ error: 'upstream secret value' })],
        ])
        const storage = {
          getItem: (key: string) => values.get(key) ?? null,
          setItem: (key: string, value: string) => values.set(key, value),
          removeItem: (key: string) => values.delete(key),
        }
        return {
          values,
          log: new BrowserDiagnosticStore(env, storage, now),
        }
      },
      exercise: ({ log }) => log.export(),
      verify: (exported, { values }) => {
        expect(values.has('ze-great-dashboard.diagnostics.v1')).toBe(false)
        expect(JSON.stringify(exported)).not.toContain('upstream secret value')
      },
    })
  })

  describe('failure disclosure', () => {
    mintTest('exports a failed observation reason and its opaque support reference', {
      setup: () => ({ log: new BrowserDiagnosticStore(env, memory(), now) }),
      exercise: ({ log }) => {
        log.record({
          kind: 'panel-fetch-response',
          panelId: 'build',
          path: '/api/panel/ze-great-team/build',
          status: 200,
          failure: { reason: 'The source could not be reached.', supportReference: '8ecf1a94' },
        })
        return { summary: log.summary(), exported: log.export() }
      },
      verify: ({ summary, exported }) => {
        expect(summary.panels[0]).toMatchObject({
          latestFailedObservation: {
            reason: 'The source could not be reached.',
            supportReference: '8ecf1a94',
          },
        })
        expect(exported.events).toContainEqual(
          expect.objectContaining({
            failure: expect.objectContaining({ supportReference: '8ecf1a94' }),
          }),
        )
      },
    })
  })

  describe('storage fault tolerance', () => {
    mintTest('continues in memory when storage throws', {
      setup: () => {
        const storage = {
          getItem: () => {
            throw new Error('blocked')
          },
          setItem: () => {
            throw new Error('blocked')
          },
          removeItem: () => {
            throw new Error('blocked')
          },
        }
        return { log: new BrowserDiagnosticStore(env, storage, now) }
      },
      exercise: ({ log }) => {
        log.record({
          kind: 'panel-fetch-failure',
          panelId: 'build',
          path: '/api/panel/ze-great-team/build',
          message: 'offline',
        })
        return log.count()
      },
      verify: (count) => expect(count).toBe(2),
    })
  })

  describe('GitHub consistency incidents', () => {
    mintTest('persists consistency incidents outside ordinary pruning', {
      setup: () => {
        const store = memory()
        return { store, log: new BrowserDiagnosticStore(env, store, now) }
      },
      exercise: ({ log, store }) => {
        log.recordGithubConsistencyIncident({
          panelId: 'build',
          endpoint: '/api/panel/team/build',
          identity: { source: 'github', workflow: 'build.yml', branch: 'main' },
          accepted: {
            sourceUpdatedAt: '2026-08-21T11:00:00Z',
            status: 'failed',
            link: 'https://github.test/new',
          },
          regressed: {
            sourceUpdatedAt: '2026-08-21T10:00:00Z',
            status: 'passed',
            link: 'https://github.test/old',
          },
          response: { httpStatus: 200, date: 'Fri, 21 Aug 2026 12:00:00 GMT', etag: 'old' },
        })
        const reloaded = new BrowserDiagnosticStore(env, store, now)
        return {
          count: log.githubConsistencyIncidentCount(),
          exported: log.export(),
          reloadedCount: reloaded.githubConsistencyIncidentCount(),
        }
      },
      verify: ({ count, exported, reloadedCount }) => {
        expect(count).toBe(1)
        expect(exported.githubConsistencyIncidents).toHaveLength(1)
        expect(reloadedCount).toBe(1)
      },
    })

    mintTest('clears consistency incidents explicitly', {
      setup: () => {
        const store = memory(
          JSON.stringify({
            schemaVersion: diagnosticsSchemaVersion,
            events: [],
            githubConsistencyIncidents: [
              {
                at: '2026-08-21T12:00:00Z',
                board: 'ze-great-team',
                panelId: 'build',
                endpoint: '/api/panel/team/build',
                identity: { source: 'github', workflow: 'build.yml', branch: 'main' },
                accepted: {
                  sourceUpdatedAt: '2026-08-21T11:00:00Z',
                  status: 'failed',
                  link: 'https://github.test/new',
                },
                regressed: {
                  sourceUpdatedAt: '2026-08-21T10:00:00Z',
                  status: 'passed',
                  link: 'https://github.test/old',
                },
                response: {
                  httpStatus: 200,
                  date: 'Fri, 21 Aug 2026 12:00:00 GMT',
                  etag: 'old',
                },
              },
            ],
          }),
        )
        return { log: new BrowserDiagnosticStore(env, store, now) }
      },
      exercise: ({ log }) => {
        log.clear()
        return log.githubConsistencyIncidentCount()
      },
      verify: (count) => expect(count).toBe(0),
    })
  })

  describe('retained-evidence summaries', () => {
    mintTest('summarizes retained healthy, failed, malformed, and multi-session panel evidence', {
      setup: () => ({
        events: [
          event({ kind: 'session-start', sessionId: 'first' }),
          event({ kind: 'panel-fetch-start', panelId: 'build' }),
          event({ kind: 'panel-fetch-response', panelId: 'build', status: 200, envelope: {} }),
          event({
            kind: 'panel-rendered',
            panelId: 'build',
            rendered: { state: 'ok', status: 'passed', link: null },
          }),
          event({ kind: 'session-start', sessionId: 'second', at: '2026-08-21T12:05:00.000Z' }),
          event({ kind: 'panel-fetch-start', panelId: 'build' }),
          event({ kind: 'panel-fetch-response', panelId: 'build', status: 503 }),
          event({ kind: 'panel-fetch-parse-failure', panelId: 'build', message: 'invalid JSON' }),
          event({ kind: 'panel-fetch-start', panelId: 'deploy' }),
          event({ kind: 'panel-fetch-failure', panelId: 'deploy', message: 'offline' }),
          event({ kind: 'client-update-failure', message: 'offline' }),
          event({ kind: 'board-fetch-parse-failure', message: 'invalid board' }),
        ],
      }),
      exercise: ({ events }) =>
        summarizeDiagnostics(events, { eventsPrunedByAge: 3, eventsPrunedByCount: 4 }),
      verify: (summary) =>
        expect(summary).toMatchObject({
          retained: {
            eventCount: 12,
            sessionCount: 2,
            evidenceMayBeIncomplete: true,
            retention: { eventsPrunedByAge: 3, eventsPrunedByCount: 4 },
          },
          failures: { clientUpdate: 1, boardFetch: 1 },
          panels: [
            {
              panelId: 'build',
              requests: 2,
              httpStatuses: { 200: 1, 503: 1 },
              parseFailures: 1,
              networkFailures: 0,
              visibleStateChanges: 1,
              latestRendered: { state: 'ok', status: 'passed' },
            },
            { panelId: 'deploy', requests: 1, parseFailures: 0, networkFailures: 1 },
          ],
        }),
    })
  })
})

function event(input: Record<string, unknown>): DiagnosticEvent {
  return {
    schemaVersion: diagnosticsSchemaVersion,
    at: '2026-08-21T12:00:00.000Z',
    sessionId: 'first',
    board: 'ze-great-team',
    path: '/api/test',
    ...input,
  } as DiagnosticEvent
}
