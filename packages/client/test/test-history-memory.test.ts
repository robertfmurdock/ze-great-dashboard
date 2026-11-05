import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { Panel, TestHistory, TestHistorySample } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { BrowserPanelMemory } from '../src/panel-memory.ts'

const panel: Panel = {
  id: 'tests',
  type: 'test-count',
  source: 'github',
  pipeline: 'ci.yml',
  test_results: { artifact: 'evidence', entry: 'tests.json' },
}
function fixture() {
  const clock = { value: Date.parse('2026-11-05T00:00:00Z') }
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
  }
  return { clock, storage, memory: new BrowserPanelMemory(storage, () => new Date(clock.value)) }
}
function inspection(samples: TestHistorySample[] = [], complete = true): TestHistory {
  return { inspectedAt: '2026-11-05T00:00:00Z', inspectedRuns: samples.length, complete, samples }
}
function sample(id: number, total: number, attempt = 1): TestHistorySample {
  return {
    id: String(id),
    total,
    attempt,
    updatedAt: new Date(Date.UTC(2026, 10, 4, id)).toISOString(),
  }
}
function live(reading: TestHistorySample) {
  const { total, ...run } = reading
  return {
    panelId: panel.id,
    state: 'ok',
    observedAt: '2026-11-05T00:00:00Z',
    link: null,
    signal: { type: 'test-count', status: 'reported', total, run },
  } as const
}
describe('repair scheduling persistence', () => {
  test(
    'merged source readings and incomplete-inspection context survive reload',
    mint({
      setup: () => {
        const world = fixture()
        const current = sample(3, 120)
        const previous = [sample(1, 100), sample(2, 110)]
        const envelope = live(current)
        world.memory.observeTests('team', panel, envelope)
        world.memory.finishTestRepair('team', panel, inspection(previous, false))
        const reloaded = new BrowserPanelMemory(world.storage, () => new Date(world.clock.value))
        return {
          reloaded,
          envelope,
          expected: [...previous, current].map((reading) => reading.total),
        }
      },
      exercise: ({ reloaded, envelope }) => reloaded.testDirection('team', panel, envelope),
      verify: (direction, { expected }) => {
        expect(direction?.totals).toEqual(expected)
        expect(direction?.explanation).toContain('inspection was incomplete')
      },
    }),
  )
  test(
    'the attempt throttle survives reloads',
    mint({
      setup: () => {
        const world = fixture()
        world.memory.beginTestRepair('team', panel)
        return { memory: new BrowserPanelMemory(world.storage, () => new Date(world.clock.value)) }
      },
      exercise: ({ memory }) => memory.testRepairDue('team', panel),
      verify: (due) => expect(due).toBe(false),
    }),
  )
})

describe('historical merge and live-run anchoring', () => {
  test(
    'polling the displayed run after repair retains its anchored direction',
    mint({
      setup: () => {
        const world = fixture()
        const current = sample(3, 120)
        const previous = [sample(1, 100), sample(2, 110)]
        const envelope = live(current)
        world.memory.observeTests('team', panel, envelope)
        world.memory.finishTestRepair('team', panel, inspection([...previous, sample(4, 130)]))
        return {
          ...world,
          envelope,
          expected: [...previous, current].map((reading) => reading.total),
        }
      },
      exercise: ({ memory, envelope }) => memory.observeTests('team', panel, envelope),
      verify: (direction, { expected }) => expect(direction?.totals).toEqual(expected),
    }),
  )
})
