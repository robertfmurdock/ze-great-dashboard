export type PipelineObservation = {
  pipelineId: string
  status: 'passed' | 'failed'
  sourceRunId: string
  observedAt: string
}

export type RefreshOutcome =
  | { state: 'ok'; observation: PipelineObservation }
  | { state: 'error'; error: 'provider-unavailable' }

export type PipelineProvider = { read(): Promise<PipelineObservation> }
export type EvidencePublisher = { publish(observation: PipelineObservation): void }
export type LeaseTracker = { acquire(): () => void; readonly active: number }

export function createLeaseTracker(): LeaseTracker {
  let active = 0
  return {
    acquire() {
      active += 1
      let released = false
      return () => {
        if (!released) {
          released = true
          active -= 1
        }
      }
    },
    get active() {
      return active
    },
  }
}

export function createPipelineRefreshService(
  provider: PipelineProvider,
  publisher: EvidencePublisher,
  leases: LeaseTracker,
) {
  let cachedObservation: PipelineObservation | undefined
  return {
    async refresh(): Promise<RefreshOutcome> {
      const release = leases.acquire()
      try {
        const observation = await provider.read()
        cachedObservation = observation
        publisher.publish(observation)
        return { state: 'ok', observation }
      } catch {
        cachedObservation = undefined
        return { state: 'error', error: 'provider-unavailable' }
      } finally {
        release()
      }
    },
    cachedObservation() {
      return cachedObservation
    },
  }
}
