import { mintTest } from '@continuous-excellence/testmints-js/vitest'
import { expect } from 'vitest'
import {
  createLeaseTracker,
  createPipelineRefreshService,
  type PipelineObservation,
} from '../src/pipeline-refresh.ts'

mintTest('reports a provider failure after a successful refresh', {
  setup: async () => {
    const observation: PipelineObservation = {
      pipelineId: 'deploy',
      status: 'passed',
      sourceRunId: '101',
      observedAt: '2026-10-06T12:00:00.000Z',
    }
    const published: PipelineObservation[] = []
    const leases = createLeaseTracker()
    let reads = 0
    const service = createPipelineRefreshService(
      {
        read: async () => {
          reads += 1
          if (reads === 1) return observation
          throw new Error('transport failed')
        },
      },
      { publish: (next) => published.push(next) },
      leases,
    )
    await service.refresh()
    return {
      observation,
      published,
      leases,
      service,
      cachedBeforeFailure: JSON.stringify(service.cachedObservation()),
    }
  },
  exercise: ({ service }) => service.refresh(),
  verify: (result, { observation, published, leases, service, cachedBeforeFailure }) => {
    expect(result).toEqual({ state: 'error', error: 'provider-unavailable' })
    expect(cachedBeforeFailure).toBe(JSON.stringify(observation))
    expect(JSON.stringify(service.cachedObservation())).toBeUndefined()
    expect(published).toEqual([observation])
    expect(leases.active).toBe(0)
  },
})
