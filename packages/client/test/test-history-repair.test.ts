import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import type { Panel, TestHistory } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test, vi } from 'vitest'
import { BrowserPanelMemory } from '../src/panel-memory.ts'
import { TestHistoryRepair } from '../src/test-history-repair.ts'

const panel: Panel = { id: 'tests', type: 'test-count', source: 'github', pipeline: 'ci.yml' }
const path = '/api/panel/team/tests'
const inspection: TestHistory = {
  inspectedAt: '2026-11-05T00:00:00Z',
  inspectedRuns: 0,
  complete: true,
  samples: [],
}
async function fixture(scope: ResourceScope, response = Response.json(inspection)) {
  await scope.using(
    'controlled clock',
    () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(inspection.inspectedAt))
    },
    () => vi.useRealTimers(),
  )
  const storageValues = new Map<string, string>()
  const storage = {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storageValues.set(key, value)
    },
  }
  const memory = new BrowserPanelMemory(storage)
  const fetcher = vi.fn<typeof fetch>(async () => response)
  const visibility = { visible: true }
  let finish: () => void = () => {}
  const completion = new Promise<void>((resolve) => {
    finish = resolve
  })
  const onMerged = vi.fn(() => finish())
  const diagnostics = { record: vi.fn(), recordGithubConsistencyIncident: vi.fn() }
  const repair = await scope.using(
    'repair coordinator',
    () =>
      new TestHistoryRepair({
        board: 'team',
        memory,
        fetcher,
        diagnostics,
        onMerged,
        visible: () => visibility.visible,
      }),
    (repair) => repair.dispose(),
  )
  return { repair, memory, storage, fetcher, diagnostics, onMerged, visibility, completion }
}

describe('opportunistic history dispatch', () => {
  test(
    'current polling settles before the first repair is dispatched',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.repair.currentStarted('other')
        world.repair.currentStarted(panel.id)
        return world
      },
      exercise: ({ repair }) => repair.currentSettled(panel, path, true, true),
      verify: (_, { fetcher }) => expect(fetcher).not.toHaveBeenCalled(),
    }),
  )
  test(
    'an eligible repair starts once the remaining current poll settles',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.repair.currentStarted('other')
        world.repair.currentSettled(panel, path, true, true)
        return world
      },
      exercise: async ({ repair, completion }) => {
        repair.currentSettled(
          { id: 'other', type: 'http-value' },
          '/api/panel/team/other',
          true,
          false,
        )
        await completion
      },
      verify: (_, { fetcher, onMerged, diagnostics }) => {
        expect(fetcher).toHaveBeenCalledWith(
          `${path}/test-history`,
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        )
        expect(onMerged).toHaveBeenCalledWith(panel)
        expect(diagnostics.record).toHaveBeenCalledWith(
          expect.objectContaining({
            kind: 'test-history-repair',
            outcome: 'complete',
            inspectedRuns: inspection.inspectedRuns,
          }),
        )
      },
    }),
  )
  test(
    'an older server without the capability header triggers no repair request',
    mint({
      setup: ({ scope }) => fixture(scope),
      exercise: ({ repair }) => repair.currentSettled(panel, path, true, false),
      verify: (_, { fetcher }) => expect(fetcher).not.toHaveBeenCalled(),
    }),
  )
  test(
    'withdrawn capability cancels queued repair before another poll releases the queue',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.repair.currentStarted('other')
        world.repair.currentSettled(panel, path, true, true)
        world.repair.currentSettled(panel, path, true, false)
        return world
      },
      exercise: ({ repair }) =>
        repair.currentSettled(
          { id: 'other', type: 'http-value' },
          '/api/panel/team/other',
          true,
          false,
        ),
      verify: (_, { fetcher }) => expect(fetcher).not.toHaveBeenCalled(),
    }),
  )
  test(
    'an unhealthy current observation triggers no repair request',
    mint({
      setup: ({ scope }) => fixture(scope),
      exercise: ({ repair }) => repair.currentSettled(panel, path, false, true),
      verify: (_, { fetcher }) => expect(fetcher).not.toHaveBeenCalled(),
    }),
  )
  test(
    'a hidden document defers repair',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.visibility.visible = false
        return world
      },
      exercise: ({ repair }) => repair.currentSettled(panel, path, true, true),
      verify: (_, { fetcher }) => expect(fetcher).not.toHaveBeenCalled(),
    }),
  )
  test(
    'a subsequent healthy visible poll can dispatch the deferred repair',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.visibility.visible = false
        world.repair.currentSettled(panel, path, true, true)
        world.visibility.visible = true
        return world
      },
      exercise: async ({ repair, completion }) => {
        repair.currentSettled(panel, path, true, true)
        await completion
      },
      verify: (_, { fetcher }) => expect(fetcher).toHaveBeenCalledTimes(1),
    }),
  )
  test(
    'a healthy repaired cache suppresses another history request',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.memory.finishTestRepair('team', panel, inspection)
        return world
      },
      exercise: ({ repair }) => repair.currentSettled(panel, path, true, true),
      verify: (_, { fetcher }) => expect(fetcher).not.toHaveBeenCalled(),
    }),
  )
})

describe('history isolation and cancellation', () => {
  test(
    'only one repair is in flight even when another panel becomes eligible',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.fetcher.mockImplementation(() => new Promise<Response>(() => {}))
        world.repair.currentSettled(panel, path, true, true)
        return world
      },
      exercise: ({ repair }) =>
        repair.currentSettled({ ...panel, id: 'second' }, '/api/panel/team/second', true, true),
      verify: (_, { fetcher }) => expect(fetcher).toHaveBeenCalledTimes(1),
    }),
  )
  test(
    'disposing the board aborts its request and suppresses a late history response',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        let release: (response: Response) => void = () => {}
        const response = new Promise<Response>((resolve) => {
          release = resolve
        })
        world.fetcher.mockImplementation(() => response)
        const merge = await scope.using(
          'memory merge observer',
          () => vi.spyOn(world.memory, 'finishTestRepair'),
          (spy) => spy.mockRestore(),
        )
        world.repair.currentSettled(panel, path, true, true)
        return { ...world, release, merge, response: Response.json(inspection) }
      },
      exercise: async ({ repair, release, response }) => {
        repair.dispose()
        release(response)
        // Allow the late network result and subsequent scheduled work to run after disposal.
        await vi.advanceTimersByTimeAsync(3600000)
      },
      verify: (_, { fetcher, onMerged, diagnostics, merge }) => {
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
        expect(fetcher).toHaveBeenCalledTimes(1)
        expect(merge).not.toHaveBeenCalled()
        expect(onMerged).not.toHaveBeenCalled()
        expect(diagnostics.record).not.toHaveBeenCalled()
      },
    }),
  )
  test(
    'disposing queued history prevents its source request',
    mint({
      setup: async ({ scope }) => {
        const world = await fixture(scope)
        world.repair.currentStarted('other')
        world.repair.currentSettled(panel, path, true, true)
        return world
      },
      exercise: ({ repair }) => repair.dispose(),
      verify: (_, { fetcher }) => expect(fetcher).not.toHaveBeenCalled(),
    }),
  )
  test(
    'an HTTP failure records repair evidence and passes its longer Retry-After to memory',
    mint({
      setup: async ({ scope }) => {
        const retrySeconds = 172800
        const world = await fixture(
          scope,
          new Response(null, { status: 429, headers: { 'retry-after': String(retrySeconds) } }),
        )
        const finish = await scope.using(
          'memory completion observer',
          () => vi.spyOn(world.memory, 'finishTestRepair'),
          (spy) => spy.mockRestore(),
        )
        return { ...world, finish, retryAt: Date.now() + retrySeconds * 1000 }
      },
      exercise: async ({ repair, completion }) => {
        repair.currentSettled(panel, path, true, true)
        await completion
      },
      verify: (_, { diagnostics, finish, retryAt }) => {
        expect(finish).toHaveBeenCalledWith('team', panel, undefined, retryAt)
        expect(diagnostics.record).toHaveBeenCalledWith(
          expect.objectContaining({ outcome: 'failed' }),
        )
      },
    }),
  )
})
