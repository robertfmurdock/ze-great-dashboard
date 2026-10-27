import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { BrowserPanelMemory, type PanelMemoryIdentity } from '../src/panel-memory.ts'

const identity: PanelMemoryIdentity = {
  board: 'team',
  panelId: 'build',
  source: 'github',
  workflow: 'build.yml',
  branch: 'main',
}

function storage(initial?: string) {
  let value = initial
  return {
    getItem: () => value ?? null,
    setItem: (_key: string, next: string) => {
      value = next
    },
    value: () => value,
  }
}

describe('browser-local panel memory', () => {
  describe('successful-run duration history', () => {
    test(
      'deduplicates replacement successful runs when calculating an even median',
      mint({
        setup: () => {
          const now = () => new Date('2026-08-28T12:00:00Z')
          return { memory: new BrowserPanelMemory(storage(), now) }
        },
        exercise: ({ memory }) => {
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/1',
            durationMs: 100,
            sourceUpdatedAt: '2026-08-28T10:00:00Z',
          })
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/1',
            durationMs: 900,
            sourceUpdatedAt: '2026-08-28T10:00:00Z',
          })
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/2',
            durationMs: 300,
            sourceUpdatedAt: '2026-08-28T10:00:00Z',
          })
          return memory.medianDuration(identity)
        },
        verify: (medianDuration) => expect(medianDuration).toBe(600),
      }),
    )

    test(
      'calculates an odd median from unique successful runs',
      mint({
        setup: () => {
          const now = () => new Date('2026-08-28T12:00:00Z')
          return { memory: new BrowserPanelMemory(storage(), now) }
        },
        exercise: ({ memory }) => {
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/1',
            durationMs: 900,
            sourceUpdatedAt: '2026-08-28T10:00:00Z',
          })
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/2',
            durationMs: 300,
            sourceUpdatedAt: '2026-08-28T10:00:00Z',
          })
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/3',
            durationMs: 500,
            sourceUpdatedAt: '2026-08-28T10:00:00Z',
          })
          return memory.medianDuration(identity)
        },
        verify: (medianDuration) => expect(medianDuration).toBe(500),
      }),
    )

    test(
      'prunes source-old successful samples across a reload',
      mint({
        setup: () => {
          const store = storage()
          const now = () => new Date('2026-08-28T12:00:00Z')
          return { memory: new BrowserPanelMemory(store, now), store, now }
        },
        exercise: ({ memory, store, now }) => {
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/old',
            durationMs: 100,
            sourceUpdatedAt: '2026-08-13T11:59:59Z',
          })
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/recent',
            durationMs: 300,
            sourceUpdatedAt: '2026-08-14T12:00:00Z',
          })

          const reloaded = new BrowserPanelMemory(store, now)
          return reloaded.medianDuration(identity)
        },
        verify: (medianDuration) => expect(medianDuration).toBe(300),
      }),
    )
  })

  describe('completed-run fallback estimates', () => {
    for (const status of ['failed', 'warning', 'cancelled', 'unknown'] as const) {
      test(
        `uses a ${status} completed run as a fallback estimate`,
        mint({
          setup: () => ({
            status,
            memory: new BrowserPanelMemory(storage(), () => new Date('2026-08-28T12:00:00Z')),
          }),
          exercise: ({ status, memory }) => {
            memory.recordCompletedRun(identity, {
              link: `https://github.test/${status}`,
              durationMs: 420,
              sourceUpdatedAt: '2026-08-28T11:00:00Z',
            })
            return memory.resolveEstimatedDuration(identity)
          },
          verify: (estimatedDuration) => expect(estimatedDuration).toBe(420),
        }),
      )
    }

    test(
      'selects the latest completed sample as the fallback estimate',
      mint({
        setup: () => {
          const now = () => new Date('2026-08-28T12:00:00Z')
          return { memory: new BrowserPanelMemory(storage(), now) }
        },
        exercise: ({ memory }) => {
          memory.recordCompletedRun(identity, {
            link: 'https://github.test/old',
            durationMs: 300,
            sourceUpdatedAt: '2026-08-28T10:00:00Z',
          })
          memory.recordCompletedRun(identity, {
            link: 'https://github.test/new',
            durationMs: 700,
            sourceUpdatedAt: '2026-08-28T11:00:00Z',
          })
          return memory.resolveEstimatedDuration(identity)
        },
        verify: (estimatedDuration) => expect(estimatedDuration).toBe(700),
      }),
    )

    test(
      'uses successful history before a completed-run fallback estimate',
      mint({
        setup: () => {
          const now = () => new Date('2026-08-28T12:00:00Z')
          return { memory: new BrowserPanelMemory(storage(), now) }
        },
        exercise: ({ memory }) => {
          memory.recordCompletedRun(identity, {
            link: 'https://github.test/completed',
            durationMs: 700,
            sourceUpdatedAt: '2026-08-28T11:00:00Z',
          })
          memory.recordSuccessfulRun(identity, {
            link: 'https://github.test/pass',
            durationMs: 500,
            sourceUpdatedAt: '2026-08-28T09:00:00Z',
          })
          return memory.resolveEstimatedDuration(identity)
        },
        verify: (estimatedDuration) => expect(estimatedDuration).toBe(500),
      }),
    )
  })

  describe('stored-memory boundaries', () => {
    test(
      'persists the latest accepted timestamp across a reload',
      mint({
        setup: () => {
          const store = storage()
          const now = () => new Date('2026-08-28T12:00:00Z')
          return { memory: new BrowserPanelMemory(store, now), store, now }
        },
        exercise: ({ memory, store, now }) => {
          memory.rememberLatest(identity, {
            sourceUpdatedAt: '2026-08-28T11:00:00Z',
            status: 'failed',
            link: 'https://github.test/new',
          })
          const reloaded = new BrowserPanelMemory(store, now)
          return reloaded.latest(identity)?.link
        },
        verify: (latestLink) => expect(latestLink).toBe('https://github.test/new'),
      }),
    )

    test(
      'ignores malformed persisted completed samples without throwing',
      mint({
        setup: () => {
          const key = JSON.stringify([
            identity.board,
            identity.panelId,
            identity.source,
            identity.workflow,
            identity.branch,
          ])
          return {
            store: storage(
              JSON.stringify({
                schemaVersion: 1,
                histories: {
                  [key]: {
                    durations: {},
                    latestCompleted: { durationMs: 'not-a-duration' },
                  },
                },
              }),
            ),
          }
        },
        exercise: ({ store }) => {
          const memory = new BrowserPanelMemory(store)
          return memory.resolveEstimatedDuration(identity)
        },
        verify: (estimatedDuration) => expect(estimatedDuration).toBeUndefined(),
      }),
    )
  })
})
