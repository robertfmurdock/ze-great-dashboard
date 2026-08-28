import { describe, expect, it } from 'vitest'
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
  it('deduplicates successful runs and calculates odd and even medians', () => {
    const store = storage()
    const now = () => new Date('2026-08-28T12:00:00Z')
    const memory = new BrowserPanelMemory(store, now)
    const sample = (link: string, durationMs: number, sourceUpdatedAt = '2026-08-28T10:00:00Z') =>
      memory.recordSuccessfulRun(identity, { link, durationMs, sourceUpdatedAt })

    sample('https://github.test/1', 100)
    sample('https://github.test/1', 900)
    sample('https://github.test/2', 300)
    expect(memory.medianDuration(identity)).toBe(600)
    sample('https://github.test/3', 500)
    expect(memory.medianDuration(identity)).toBe(500)
  })

  it('persists accepted timestamps and prunes source-old samples', () => {
    const store = storage()
    const memory = new BrowserPanelMemory(store, () => new Date('2026-08-28T12:00:00Z'))
    memory.rememberLatest(identity, {
      sourceUpdatedAt: '2026-08-28T11:00:00Z',
      status: 'failed',
      link: 'https://github.test/new',
    })
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

    const reloaded = new BrowserPanelMemory(store, () => new Date('2026-08-28T12:00:00Z'))
    expect(reloaded.latest(identity)?.link).toBe('https://github.test/new')
    expect(reloaded.medianDuration(identity)).toBe(300)
  })

  it.each([
    ['failed', 'failed'],
    ['cancelled', 'cancelled'],
    ['unknown', 'unknown'],
  ] as const)('uses a %s completed run as a fallback estimate', (_label, _status) => {
    const memory = new BrowserPanelMemory(storage(), () => new Date('2026-08-28T12:00:00Z'))
    memory.recordCompletedRun(identity, {
      link: `https://github.test/${_status}`,
      durationMs: 420,
      sourceUpdatedAt: '2026-08-28T11:00:00Z',
    })
    expect(memory.resolveEstimatedDuration(identity)).toBe(420)
  })

  it('selects the latest completed sample, while successful history takes precedence', () => {
    const memory = new BrowserPanelMemory(storage(), () => new Date('2026-08-28T12:00:00Z'))
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
    expect(memory.resolveEstimatedDuration(identity)).toBe(700)

    memory.recordSuccessfulRun(identity, {
      link: 'https://github.test/pass',
      durationMs: 500,
      sourceUpdatedAt: '2026-08-28T09:00:00Z',
    })
    expect(memory.resolveEstimatedDuration(identity)).toBe(500)
  })

  it('ignores malformed persisted completed samples without throwing', () => {
    const key = JSON.stringify([
      identity.board,
      identity.panelId,
      identity.source,
      identity.workflow,
      identity.branch,
    ])
    const memory = new BrowserPanelMemory(
      storage(
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
    )
    expect(memory.resolveEstimatedDuration(identity)).toBeUndefined()
  })
})
