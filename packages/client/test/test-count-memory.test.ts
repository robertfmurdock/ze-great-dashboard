import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { Envelope, Panel } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test, vi } from 'vitest'
import { BrowserPanelMemory } from '../src/panel-memory.ts'
import type { TestSample } from '../src/test-direction.ts'

const panel: Panel = {
  id: 'tests',
  type: 'test-count',
  source: 'github',
  pipeline: 'ci.yml',
  branch: 'main',
  test_results: { artifact: 'evidence', entry: 'tests.json' },
}
const now = () => new Date('2026-11-04T18:00:00Z')
function reported(
  id: number,
  total: number,
  attempt = 1,
  updatedAt = new Date(Date.UTC(2026, 10, 4, 0, id)).toISOString(),
) {
  return {
    panelId: panel.id,
    state: 'ok',
    observedAt: now().toISOString(),
    link: null,
    signal: {
      type: 'test-count',
      status: 'reported',
      total,
      run: { id: String(id), attempt, updatedAt },
    },
  } satisfies Envelope
}
function memoryFixture() {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
  }
  return { storage, memory: new BrowserPanelMemory(storage, now) }
}

/** The browser-storage output is the observable boundary for the retention budget. */
function persistedSamples(serialized: string): TestSample[] {
  const stored = JSON.parse(serialized) as { histories: Record<string, { tests?: TestSample[] }> }
  return Object.values(stored.histories).flatMap((history) => history.tests ?? [])
}

describe('test-count observation identity', () => {
  test(
    'a repeated poll replaces rather than appends its observation',
    mint({
      setup: () => {
        const world = memoryFixture()
        const first = reported(1, 100)
        const current = reported(2, 120)
        world.memory.observeTests('board', panel, first)
        world.memory.observeTests('board', panel, current)
        return { ...world, first, current }
      },
      exercise: ({ memory, current }) => memory.observeTests('board', panel, current),
      verify: (result, { first, current }) =>
        expect(result?.totals).toEqual([first.signal.total, current.signal.total]),
    }),
  )
  test(
    'corrected evidence replaces the total for the same run attempt',
    mint({
      setup: () => {
        const world = memoryFixture()
        const first = reported(1, 100)
        const original = reported(2, 120)
        const correction = { ...original, signal: { ...original.signal, total: 121 } }
        world.memory.observeTests('board', panel, first)
        world.memory.observeTests('board', panel, original)
        return { ...world, first, correction }
      },
      exercise: ({ memory, correction }) => memory.observeTests('board', panel, correction),
      verify: (result, { first, correction }) =>
        expect(result?.totals).toEqual([first.signal.total, correction.signal.total]),
    }),
  )
  test(
    'a rerun attempt is a distinct observation',
    mint({
      setup: () => {
        const world = memoryFixture()
        const original = reported(1, 100)
        const rerun = {
          ...original,
          signal: { ...original.signal, total: 120, run: { ...original.signal.run, attempt: 2 } },
        }
        world.memory.observeTests('board', panel, original)
        return { ...world, original, rerun }
      },
      exercise: ({ memory, rerun }) => memory.observeTests('board', panel, rerun),
      verify: (result, { original, rerun }) =>
        expect(result?.totals).toEqual([original.signal.total, rerun.signal.total]),
    }),
  )
  test(
    'an observation after reload retains earlier run comparisons',
    mint({
      setup: () => {
        const world = memoryFixture()
        const first = reported(1, 100)
        const next = reported(2, 120)
        world.memory.observeTests('board', panel, first)
        return { first, next, reloaded: new BrowserPanelMemory(world.storage, now) }
      },
      exercise: ({ reloaded, next }) => reloaded.observeTests('board', panel, next),
      verify: (result, { first, next }) =>
        expect(result?.totals).toEqual([first.signal.total, next.signal.total]),
    }),
  )
  const identities: { name: string; board: string; panel: Panel }[] = [
    { name: 'board', board: 'other', panel },
    { name: 'panel', board: 'board', panel: { ...panel, id: 'other' } },
    { name: 'source', board: 'board', panel: { ...panel, source: 'other' } },
    { name: 'workflow', board: 'board', panel: { ...panel, pipeline: 'other.yml' } },
    { name: 'branch', board: 'board', panel: { ...panel, branch: 'other' } },
    {
      name: 'artifact',
      board: 'board',
      panel: { ...panel, test_results: { artifact: 'other', entry: 'tests.json' } },
    },
    {
      name: 'entry',
      board: 'board',
      panel: { ...panel, test_results: { artifact: 'evidence', entry: 'other.json' } },
    },
  ]
  for (const identity of identities)
    test(
      `isolates ${identity.name}`,
      mint({
        setup: () => {
          const world = memoryFixture()
          world.memory.observeTests('board', panel, reported(1, 100))
          return { ...world, identity, next: reported(2, 120) }
        },
        exercise: ({ memory, identity, next }) =>
          memory.observeTests(identity.board, identity.panel, next),
        verify: (result, { next }) => expect(result?.totals).toEqual([next.signal.total]),
      }),
    )
})

describe('test-count reading admission', () => {
  const olderCases = [
    {
      name: 'earlier source timestamp',
      earlierUpdatedAt: '2026-11-04T17:00:00Z',
      currentUpdatedAt: '2026-11-04T18:00:00Z',
    },
    {
      name: 'earlier run at the same source timestamp',
      earlierUpdatedAt: '2026-11-04T18:00:00Z',
      currentUpdatedAt: '2026-11-04T18:00:00Z',
    },
  ]
  for (const scenario of olderCases)
    test(
      `retains ${scenario.name} in source order while projecting the supplied run`,
      mint({
        setup: () => {
          const world = memoryFixture()
          const current = reported(2, 100, 1, scenario.currentUpdatedAt)
          world.memory.observeTests('board', panel, current)
          world.storage.setItem.mockClear()
          return { ...world, current, earlier: reported(1, 80, 1, scenario.earlierUpdatedAt) }
        },
        exercise: ({ memory, earlier }) => memory.observeTests('board', panel, earlier),
        verify: (result, { storage, earlier, current }) => {
          expect(result?.totals).toEqual([earlier.signal.total])
          const written = storage.setItem.mock.lastCall?.[1]
          expect(persistedSamples(written ?? '').map((reading) => reading.total)).toEqual([
            earlier.signal.total,
            current.signal.total,
          ])
        },
      }),
    )
  const exclusions: { name: string; signal: unknown }[] = [
    { name: 'pending', signal: { type: 'test-count', status: 'pending' } },
    { name: 'not reported', signal: { type: 'test-count', status: 'not-reported' } },
    { name: 'missing run metadata', signal: { type: 'test-count', status: 'reported', total: 0 } },
    {
      name: 'invalid timestamp',
      signal: {
        type: 'test-count',
        status: 'reported',
        total: 0,
        run: { id: '2', attempt: 1, updatedAt: 'invalid' },
      },
    },
  ]
  for (const exclusion of exclusions)
    test(
      `does not count ${exclusion.name} as zero`,
      mint({
        setup: () => {
          const world = memoryFixture()
          world.memory.observeTests('board', panel, reported(1, 100))
          world.storage.setItem.mockClear()
          return { ...world, excluded: { ...reported(2, 0), signal: exclusion.signal } }
        },
        exercise: ({ memory, excluded }) => memory.observeTests('board', panel, excluded),
        verify: (result, { storage }) => {
          expect(result).toBeUndefined()
          expect(storage.setItem).not.toHaveBeenCalled()
        },
      }),
    )
})

describe('test-count browser storage', () => {
  test(
    'ignores an already expired observation',
    mint({
      setup: () => ({ ...memoryFixture(), expired: reported(0, 50, 1, '2026-10-20T00:00:00Z') }),
      exercise: ({ memory, expired }) => memory.observeTests('board', panel, expired),
      verify: (result) => expect(result).toBeUndefined(),
    }),
  )
  test(
    'bounds persisted history to the latest 32 observations',
    mint({
      setup: () => ({
        ...memoryFixture(),
        inputs: Array.from({ length: 40 }, (_, i) => reported(i + 1, 100 + i)),
        retainedLimit: 32,
      }),
      // Repetition is the subject: fill the history past its retention budget.
      exercise: ({ memory, inputs }) => {
        for (const input of inputs) memory.observeTests('board', panel, input)
      },
      verify: (_, { storage, inputs, retainedLimit }) => {
        const written = storage.setItem.mock.lastCall?.[1]
        expect(written).toBeDefined()
        expect(persistedSamples(written ?? '').map((sample) => sample.total)).toEqual(
          inputs.slice(-retainedLimit).map((input) => input.signal.total),
        )
      },
    }),
  )
  test(
    'reload prunes observations older than 14 days from persisted history',
    mint({
      setup: () => {
        const world = memoryFixture()
        world.memory.observeTests('board', panel, reported(1, 100))
        world.storage.setItem.mockClear()
        return { storage: world.storage, later: new Date('2026-11-20T18:00:00Z') }
      },
      exercise: ({ storage, later }) => new BrowserPanelMemory(storage, () => later),
      verify: (_, { storage }) => {
        expect(storage.setItem).toHaveBeenCalledTimes(1)
        expect(persistedSamples(storage.setItem.mock.lastCall?.[1] ?? '')).toEqual([])
      },
    }),
  )
  test(
    'retains session evidence when storage throws',
    mint({
      setup: () => {
        const memory = new BrowserPanelMemory(
          {
            getItem: () => {
              throw new Error('blocked')
            },
            setItem: () => {
              throw new Error('full')
            },
          },
          now,
        )
        const first = reported(1, 100)
        const next = reported(2, 0)
        memory.observeTests('board', panel, first)
        return { memory, first, next }
      },
      exercise: ({ memory, next }) => memory.observeTests('board', panel, next),
      verify: (result, { first, next }) =>
        expect(result).toMatchObject({
          mode: 'zero',
          totals: [first.signal.total, next.signal.total],
        }),
    }),
  )
})
