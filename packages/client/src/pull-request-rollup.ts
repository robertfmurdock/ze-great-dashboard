import type {
  Envelope,
  PipelineStatus,
  PullRequestCandidate,
  PullRequestHealth,
} from '@ze-great-dashboard/shared'
import {
  pullRequestBuildObservationSchema,
  pullRequestCandidatesSchema,
  pullRequestWorkflowObservationSchema,
} from '@ze-great-dashboard/shared'

type Observation = { envelope?: Envelope; error?: string }

/** Purely combines normalized, public component observations; it never constructs source URLs. */
export function rollupPullRequestHealth(args: {
  panelId: string
  link: string | null
  workflows: Array<{ workflow: string; observation: Observation }>
  candidates: Observation
  builds: Map<string, Observation>
}): Envelope | undefined {
  const incomplete: Array<{ label: string; message: string }> = []
  const workflows = args.workflows.map(({ workflow, observation }) => {
    const signal = observationItem(observation.envelope, 'pull-request-workflow')
    if (signal) return signal.item as PullRequestHealth['workflows'][number]
    const message = observation.error ?? 'No usable observation is available.'
    incomplete.push({ label: `Update workflow ${workflow}`, message })
    return {
      label: workflow,
      status: 'unknown' as const,
      detail: `Update workflow ${workflow} · Unavailable: ${message}`,
      link: null,
    }
  })
  const candidatesSignal = candidateSignal(args.candidates.envelope)
  if (!candidatesSignal) {
    const message = args.candidates.error ?? 'No usable observation is available.'
    incomplete.push({ label: 'Open update PR candidates', message })
    if (workflows.every((item) => item.status === 'unknown')) return undefined
    return buildEnvelope(
      args,
      workflows,
      [],
      incomplete,
      observationDates(args.workflows.map(({ observation }) => observation)),
    )
  }
  if (candidatesSignal.truncated)
    incomplete.push({
      label: 'Open update PR candidates',
      message: 'The first 100 candidates were observed; additional open update PRs may exist.',
    })
  const pullRequests = candidatesSignal.pullRequests.map((candidate: PullRequestCandidate) => {
    const observation = args.builds.get(candidate.branch)
    const signal = observationItem(observation?.envelope, 'pull-request-build')
    if (signal)
      return {
        ...signal.item,
        label: `PR #${candidate.number}`,
        detail: signal.item.detail,
        link: candidate.link,
      }
    const message = observation?.error ?? 'No usable observation is available.'
    incomplete.push({ label: `PR #${candidate.number}`, message })
    return {
      label: `PR #${candidate.number}`,
      status: 'unknown' as const,
      detail: `${candidate.branch} · Unavailable: ${message}`,
      link: candidate.link,
    }
  })
  return buildEnvelope(
    args,
    workflows,
    pullRequests,
    incomplete,
    observationDates([
      ...args.workflows.map(({ observation }) => observation),
      args.candidates,
      ...args.builds.values(),
    ]),
  )
}

function buildEnvelope(
  args: Parameters<typeof rollupPullRequestHealth>[0],
  workflows: PullRequestHealth['workflows'],
  pullRequests: PullRequestHealth['pullRequests'],
  incomplete: Array<{ label: string; message: string }>,
  dates: string[],
) {
  const status = aggregateStatus([...workflows, ...pullRequests].map((item) => item.status))
  const failed = [...workflows, ...pullRequests].find((item) => item.status === status)
  const summary =
    status !== 'passed' && failed
      ? `${failed.label}: ${failed.detail}`
      : pullRequests.length === 0
        ? `${workflows.length} update workflow${workflows.length === 1 ? '' : 's'} · No open update PRs`
        : `${workflows.length} update workflow${workflows.length === 1 ? '' : 's'} · ${pullRequests.length} open update PR${pullRequests.length === 1 ? '' : 's'}`
  const sorted = dates.sort()
  return {
    panelId: args.panelId,
    state: 'ok' as const,
    observedAt: sorted[0] ?? new Date().toISOString(),
    link: args.link,
    signal: {
      type: 'pull-request-health' as const,
      status,
      summary,
      workflows,
      pullRequests,
      ...(incomplete.length ? { incompleteObservations: incomplete } : {}),
      ...(sorted.length > 1 ? { newestObservedAt: sorted.at(-1) } : {}),
    } satisfies PullRequestHealth,
  }
}

function observationItem(
  envelope: Envelope | undefined,
  type: 'pull-request-workflow' | 'pull-request-build',
): { item: PullRequestHealth['workflows'][number] } | undefined {
  if (envelope?.state !== 'ok') return undefined
  const schema =
    type === 'pull-request-workflow'
      ? pullRequestWorkflowObservationSchema
      : pullRequestBuildObservationSchema
  const result = schema.safeParse(envelope.signal)
  return result.success ? { item: result.data.item } : undefined
}
function candidateSignal(
  envelope: Envelope | undefined,
): { pullRequests: PullRequestCandidate[]; truncated?: boolean } | undefined {
  if (envelope?.state !== 'ok') return undefined
  const result = pullRequestCandidatesSchema.safeParse(envelope.signal)
  return result.success ? result.data : undefined
}
function observationDates(observations: Observation[]) {
  return observations.flatMap(({ envelope }) =>
    envelope?.state === 'ok' ? [envelope.observedAt] : [],
  )
}
function aggregateStatus(statuses: PipelineStatus['status'][]): PipelineStatus['status'] {
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.some((status) => status === 'running')) return 'running'
  if (statuses.some((status) => status === 'unknown')) return 'unknown'
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled'
  return 'passed'
}
