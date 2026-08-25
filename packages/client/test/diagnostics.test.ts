import type { ClientEnv } from '@ze-great-dashboard/shared'
import { describe, expect, it } from 'vitest'
import {
  BrowserDiagnosticStore,
  type DiagnosticEvent,
  diagnosticsSchemaVersion,
} from '../src/diagnostics.ts'
import { summarizeDiagnostics } from '../src/diagnostics-summary.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1.0.7',
  proxyPath: '/api',
  board: 'ze-great-team',
  clientVersion: '1.0.7',
}

function memory(initial?: string) {
  let value = initial ?? null
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next
    },
    removeItem: () => {
      value = null
    },
    value: () => value,
  }
}

describe('browser-local diagnostics', () => {
  it('exports public client metadata and retained events', () => {
    const store = memory()
    const log = new BrowserDiagnosticStore(env, store, () => new Date('2026-08-21T12:00:00Z'))
    log.record({
      kind: 'panel-fetch-start',
      panelId: 'build',
      path: '/api/panel/ze-great-team/build',
    })

    expect(log.export()).toMatchObject({
      schemaVersion: diagnosticsSchemaVersion,
      client: { version: '1.0.7', board: 'ze-great-team' },
      summary: { retained: { eventCount: 2, evidenceMayBeIncomplete: false } },
      events: expect.arrayContaining([expect.objectContaining({ panelId: 'build' })]),
    })
  })

  it('expires old events and retains at most 2,000', () => {
    const now = new Date('2026-08-21T12:00:00Z')
    const stale = new Date(now.valueOf() - 8 * 24 * 60 * 60 * 1_000).toISOString()
    const events = Array.from({ length: 2_100 }, (_, index) => ({
      at: index === 0 ? stale : now.toISOString(),
      sessionId: 'old',
      board: 'ze-great-team',
      kind: 'panel-fetch-start',
      panelId: String(index),
    }))
    const store = memory(JSON.stringify({ schemaVersion: diagnosticsSchemaVersion, events }))
    const log = new BrowserDiagnosticStore(env, store, () => now)

    expect(log.count()).toBe(2_000)
    expect(log.export().events.some((event) => event.at === stale)).toBe(false)
    expect(log.export().summary.retained.retention).toEqual({
      eventsPrunedByAge: 1,
      eventsPrunedByCount: 100,
    })
  })

  it('discards malformed or mismatched persisted data without affecting diagnostics', () => {
    for (const initial of [
      'not json',
      JSON.stringify({ schemaVersion: 99, events: [] }),
      JSON.stringify({
        schemaVersion: diagnosticsSchemaVersion,
        events: [{ kind: 'not-a-real-event' }],
      }),
    ]) {
      const store = memory(initial)
      const log = new BrowserDiagnosticStore(env, store, () => new Date('2026-08-21T12:00:00Z'))
      expect(log.count()).toBe(1)
      expect(store.value()).toContain(String(diagnosticsSchemaVersion))
    }
  })

  it('continues in memory when storage throws', () => {
    const broken = {
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
    const log = new BrowserDiagnosticStore(env, broken, () => new Date('2026-08-21T12:00:00Z'))
    log.record({
      kind: 'panel-fetch-failure',
      panelId: 'build',
      path: '/api/panel/ze-great-team/build',
      message: 'offline',
    })
    expect(log.count()).toBe(2)
  })

  it('summarizes retained healthy, failed, malformed, and multi-session panel evidence', () => {
    const events = [
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
    ]

    expect(
      summarizeDiagnostics(events, { eventsPrunedByAge: 3, eventsPrunedByCount: 4 }),
    ).toMatchObject({
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
