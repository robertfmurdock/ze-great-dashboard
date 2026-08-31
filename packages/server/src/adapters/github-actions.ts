import type {
  Envelope,
  ErrorKind,
  GithubActionsSource,
  Panel,
  PipelineStatus,
  PullRequestHealth,
  Source,
} from '@ze-great-dashboard/shared'
import { githubActionsSourceSchema } from '@ze-great-dashboard/shared'
import { z } from 'zod'
import { type CredentialResolver, environmentCredentials } from '../credentials.ts'
import { createGithubClient, GithubAuthenticationError, type GithubClient } from '../github-auth.ts'
import {
  type AdapterResult,
  upstreamErrorEnvelope,
  upstreamErrorKind,
  observedAt as upstreamObservedAt,
} from '../upstream.ts'

const pipelinePanelSchema = z.object({
  id: z.string().min(1),
  type: z.literal('pipeline-status'),
  source: z.string().min(1),
  /** GitHub accepts a workflow filename or numeric workflow id in this URL segment. */
  pipeline: z.string().min(1),
})

const pullRequestHealthPanelSchema = z.object({
  id: z.string().min(1),
  type: z.literal('pull-request-health'),
  source: z.string().min(1),
  base_branch: z.string().min(1),
  update_workflows: z
    .array(
      z.object({
        workflow: z.string().min(1),
        branch_prefixes: z.array(z.string().min(1)).min(1),
      }),
    )
    .min(1),
  build_workflow: z.string().min(1),
})

const runSchema = z.object({
  id: z.number().int().positive().optional(),
  status: z.string(),
  conclusion: z.string().nullable(),
  name: z.string().min(1),
  html_url: z.url(),
  /** The branch that produced this run; absent for some event types. */
  head_branch: z.string().min(1).nullable().optional(),
  // Timestamp quality should only remove timing advice, never make an otherwise useful run unreadable.
  run_started_at: z.string().nullable().optional(),
  updated_at: z.string().optional(),
})

const runsSchema = z.object({ workflow_runs: z.array(runSchema) })

const jobsSchema = z.object({
  jobs: z.array(
    z.object({
      name: z.string().min(1),
      status: z.string(),
      steps: z.array(z.object({ name: z.string().min(1), status: z.string() })).optional(),
    }),
  ),
})

const pullRequestsSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    html_url: z.url(),
    head: z.object({ ref: z.string().min(1) }),
    base: z.object({ ref: z.string().min(1) }),
  }),
)

export type PermittedCall = { url: string; headers: Headers }

export function permittedGithubActionsCalls(
  panel: Panel,
  source: Source,
  _credentials?: CredentialResolver,
): PermittedCall[] {
  const parsedPanel = pipelinePanelSchema.parse(panel)
  const parsedSource = githubActionsSourceSchema.parse(source)
  const url = new URL(
    `https://api.github.com/repos/${parsedSource.repo}/actions/workflows/${encodeURIComponent(parsedPanel.pipeline)}/runs`,
  )
  if (parsedSource.branch) url.searchParams.set('branch', parsedSource.branch)
  // The browser collects duration history; the adapter only needs GitHub's first run.
  url.searchParams.set('per_page', '1')

  return [{ url: url.toString(), headers: new Headers() }]
}

export function permittedGithubActionsPullRequestHealthCalls(
  panel: Panel,
  source: Source,
): PermittedCall[] {
  const parsedPanel = pullRequestHealthPanelSchema.parse(panel)
  const parsedSource = githubActionsSourceSchema.parse(source)
  const calls = parsedPanel.update_workflows.map(({ workflow }) =>
    githubRunsCall(parsedSource, workflow),
  )
  calls.push({
    ...pullRequestsCall(parsedSource, parsedPanel.base_branch, 1),
  })
  // PR build calls are derived only from head refs returned by the bounded pull request query.
  // The adapter, rather than the browser, owns that dynamic URL construction.
  return calls
}

export async function fetchGithubActionsPullRequestHealth(args: {
  panel: Panel
  source: Source
  requestHeaders: Headers
  fetcher: typeof fetch
  githubClient?: GithubClient
  credentials?: CredentialResolver
}): Promise<AdapterResult> {
  const panel = pullRequestHealthPanelSchema.parse(args.panel)
  const source = githubActionsSourceSchema.parse(args.source)
  try {
    const workflowResults = await Promise.all(
      panel.update_workflows.map(async ({ workflow, branch_prefixes }) => ({
        workflow,
        run: await latestRun({
          source,
          workflow,
          branchPrefixes: branch_prefixes,
          requestHeaders: args.requestHeaders,
          fetcher: args.fetcher,
          githubClient: githubClientFor(args),
        }),
      })),
    )
    const pullRequests = await openPullRequests({
      source,
      baseBranch: panel.base_branch,
      requestHeaders: args.requestHeaders,
      fetcher: args.fetcher,
      githubClient: githubClientFor(args),
    })
    const matching = pullRequests.filter((pullRequest) =>
      panel.update_workflows.some(({ branch_prefixes }) =>
        branch_prefixes.some((prefix) => pullRequest.head.ref.startsWith(prefix)),
      ),
    )
    const pullRequestResults = await Promise.all(
      matching.map(async (pullRequest) => ({
        pullRequest,
        run: await latestRun({
          source,
          workflow: panel.build_workflow,
          branch: pullRequest.head.ref,
          event: 'pull_request',
          requestHeaders: args.requestHeaders,
          fetcher: args.fetcher,
          githubClient: githubClientFor(args),
        }),
      })),
    )

    const workflows = workflowResults.map(({ workflow, run }) =>
      healthItem(workflow, run, `Update workflow ${workflow}`),
    )
    const pullRequestItems = pullRequestResults.map(({ pullRequest, run }) =>
      healthItem(`PR #${pullRequest.number}`, run, pullRequest.head.ref, pullRequest.html_url),
    )
    const allItems = [...workflows, ...pullRequestItems]
    const status = aggregateStatus(allItems.map((item) => item.status))
    const summary = summarize(status, workflows, pullRequestItems)
    const envelope: Envelope = {
      panelId: panel.id,
      state: 'ok',
      observedAt: new Date().toISOString(),
      link: sourceLinkForRepository(source),
      signal: {
        type: 'pull-request-health',
        status,
        summary,
        workflows,
        pullRequests: pullRequestItems,
      } satisfies PullRequestHealth,
    }
    return { envelope, response: new Response(null, { status: 200 }) }
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(
            panel.id,
            error instanceof GithubAuthenticationError ? 'unauthorized' : 'upstream-error',
            error,
            sourceLinkForRepository(source),
          ),
        ),
        { status: 200 },
      ),
    }
  }
}

async function latestRun(args: {
  source: GithubActionsSource
  workflow: string
  branch?: string
  branchPrefixes?: string[]
  event?: string
  requestHeaders: Headers
  fetcher: typeof fetch
  githubClient: GithubClient
}) {
  const call = githubRunsCall(
    args.source,
    args.workflow,
    args.branch,
    args.event,
    args.branchPrefixes ? 100 : 1,
  )
  const response = await githubFetch(call, args)
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const runs = runsSchema.parse(await response.json()).workflow_runs
  const branchPrefixes = args.branchPrefixes
  if (!branchPrefixes) return runs[0]
  return runs.find((run) => {
    const headBranch = run.head_branch
    return (
      headBranch !== undefined &&
      headBranch !== null &&
      branchPrefixes.some((prefix) => headBranch.startsWith(prefix))
    )
  })
}

async function openPullRequests(args: {
  source: GithubActionsSource
  baseBranch: string
  requestHeaders: Headers
  fetcher: typeof fetch
  githubClient: GithubClient
}) {
  const result = []
  for (let page = 1; ; page += 1) {
    const call = pullRequestsCall(args.source, args.baseBranch, page)
    const response = await githubFetch(call, args)
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const pageResults = pullRequestsSchema.parse(await response.json())
    result.push(...pageResults)
    if (pageResults.length < 100) return result
  }
}

function pullRequestsCall(
  source: GithubActionsSource,
  baseBranch: string,
  page: number,
): PermittedCall {
  const url = new URL(`https://api.github.com/repos/${source.repo}/pulls`)
  url.searchParams.set('state', 'open')
  url.searchParams.set('base', baseBranch)
  url.searchParams.set('per_page', '100')
  url.searchParams.set('page', String(page))
  return { url: url.toString(), headers: new Headers() }
}

function githubRunsCall(
  source: GithubActionsSource,
  workflow: string,
  branch?: string,
  event?: string,
  perPage = 1,
): PermittedCall {
  const url = new URL(
    `https://api.github.com/repos/${source.repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
  )
  if (branch) url.searchParams.set('branch', branch)
  if (event) url.searchParams.set('event', event)
  url.searchParams.set('per_page', String(perPage))
  return { url: url.toString(), headers: new Headers() }
}

function healthItem(
  label: string,
  run: z.infer<typeof runSchema> | undefined,
  detail: string,
  link?: string,
) {
  return {
    label,
    status: run ? normalizeStatus(run.status, run.conclusion) : ('unknown' as const),
    detail: run ? `${detail} · ${run.conclusion ?? run.status}` : `${detail} · No run found`,
    link: link ?? run?.html_url ?? null,
  }
}

function aggregateStatus(statuses: PipelineStatus['status'][]): PipelineStatus['status'] {
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.some((status) => status === 'running')) return 'running'
  if (statuses.some((status) => status === 'unknown')) return 'unknown'
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled'
  return 'passed'
}

function summarize(
  status: PipelineStatus['status'],
  workflows: ReturnType<typeof healthItem>[],
  pullRequests: ReturnType<typeof healthItem>[],
) {
  const failed = [...workflows, ...pullRequests].find((item) => item.status === status)
  if (status !== 'passed' && failed) return `${failed.label}: ${failed.detail}`
  return pullRequests.length === 0
    ? `${workflows.length} update workflow${workflows.length === 1 ? '' : 's'} · No open update PRs`
    : `${workflows.length} update workflow${workflows.length === 1 ? '' : 's'} · ${pullRequests.length} open update PR${pullRequests.length === 1 ? '' : 's'}`
}

function sourceLinkForRepository(source: GithubActionsSource) {
  return `https://github.com/${source.repo}`
}

export async function fetchGithubActionsPipeline(args: {
  panel: Panel
  source: Source
  requestHeaders: Headers
  fetcher: typeof fetch
  githubClient?: GithubClient
  credentials?: CredentialResolver
}): Promise<AdapterResult> {
  const parsedSource = githubActionsSourceSchema.parse(args.source)
  const call = permittedGithubActionsCalls(args.panel, args.source)[0]
  if (!call) throw new Error('GitHub Actions adapter declared no permitted call')

  let upstream: Response
  try {
    upstream = await githubFetch(call, {
      requestHeaders: args.requestHeaders,
      fetcher: args.fetcher,
      source: parsedSource,
      githubClient: githubClientFor(args),
    })
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(
            args.panel.id,
            error instanceof GithubAuthenticationError ? 'unauthorized' : 'unreachable',
            error,
            sourceLink(args.panel, args.source),
          ),
        ),
        { status: 200 },
      ),
    }
  }

  if (upstream.status === 304) return { response: upstream }
  if (!upstream.ok) {
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(
            args.panel.id,
            errorKind(upstream.status),
            `${upstream.status} ${upstream.statusText}`,
            sourceLink(args.panel, args.source),
            observedAt(upstream.headers.get('date')),
          ),
        ),
        { status: 200 },
      ),
    }
  }

  try {
    const runs = runsSchema.parse(await upstream.json()).workflow_runs
    const run = runs[0]
    if (!run) {
      return {
        response: new Response(
          JSON.stringify(
            errorEnvelope(
              args.panel.id,
              'no-runs',
              parsedSource.branch
                ? `No workflow runs found for branch "${parsedSource.branch}". Check the source's branch setting.`
                : 'No workflow runs found.',
              sourceLink(args.panel, args.source),
              observedAt(upstream.headers.get('date')),
            ),
          ),
          { status: 200 },
        ),
      }
    }
    const signal: PipelineStatus = {
      type: 'pipeline-status',
      status: normalizeStatus(run.status, run.conclusion),
      rawStatus: run.conclusion ?? run.status,
      name: run.name,
      ...((run.head_branch ?? parsedSource.branch)
        ? { branch: run.head_branch ?? parsedSource.branch }
        : {}),
      ...(timestamp(run.updated_at) ? { sourceUpdatedAt: timestamp(run.updated_at) } : {}),
      ...(timestamp(run.run_started_at) ? { runStartedAt: timestamp(run.run_started_at) } : {}),
      ...(run.id !== undefined ? { sourceRunId: String(run.id) } : {}),
      ...(run.status === 'completed' ? completedRunDuration(run) : {}),
    }
    if (signal.status === 'running' && run.id !== undefined) {
      const activity = await activeGithubActivity({
        source: parsedSource,
        runId: run.id,
        requestHeaders: args.requestHeaders,
        fetcher: args.fetcher,
        githubClient: githubClientFor(args),
      })
      if (activity) signal.activity = activity
    }
    const envelope: Envelope = {
      panelId: args.panel.id,
      state: 'ok',
      observedAt: observedAt(upstream.headers.get('date')),
      link: run.html_url,
      signal,
    }
    return { envelope, response: upstream }
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(
            args.panel.id,
            'upstream-error',
            error,
            sourceLink(args.panel, args.source),
            observedAt(upstream.headers.get('date')),
          ),
        ),
        { status: 200 },
      ),
    }
  }
}

async function activeGithubActivity(args: {
  source: GithubActionsSource
  runId: number
  requestHeaders: Headers
  fetcher: typeof fetch
  githubClient: GithubClient
}): Promise<PipelineStatus['activity']> {
  const call = githubJobsCall(args.source, args.runId)
  try {
    const response = await githubFetch(call, args)
    if (!response.ok) return undefined
    const jobs = jobsSchema.parse(await response.json()).jobs
    const job =
      jobs.find((candidate) => candidate.status === 'in_progress') ??
      jobs.find((candidate) => candidate.status === 'queued')
    if (!job) return undefined
    const step = job.steps?.find((candidate) => candidate.status === 'in_progress')
    return step
      ? { kind: 'step', name: step.name, parent: job.name }
      : { kind: 'job', name: job.name }
  } catch {
    return undefined
  }
}

async function githubFetch(
  call: PermittedCall,
  args: {
    source: GithubActionsSource
    requestHeaders: Headers
    fetcher: typeof fetch
    githubClient: GithubClient
  },
): Promise<Response> {
  return args.githubClient.get({
    source: args.source,
    url: call.url,
    requestHeaders: args.requestHeaders,
    fetcher: args.fetcher,
  })
}

function githubClientFor(args: { githubClient?: GithubClient; credentials?: CredentialResolver }) {
  return args.githubClient ?? createGithubClient(args.credentials ?? environmentCredentials())
}

function githubJobsCall(source: GithubActionsSource, runId: number): PermittedCall {
  const url = new URL(`https://api.github.com/repos/${source.repo}/actions/runs/${runId}/jobs`)
  url.searchParams.set('per_page', '100')
  return { url: url.toString(), headers: new Headers() }
}

function completedRunDuration(run: z.infer<typeof runSchema>): Pick<PipelineStatus, 'durationMs'> {
  const startedAt = timestamp(run.run_started_at)
  const updatedAt = timestamp(run.updated_at)
  if (!startedAt || !updatedAt) return {}
  const durationMs = new Date(updatedAt).valueOf() - new Date(startedAt).valueOf()
  return Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}
}

function timestamp(value: string | null | undefined): string | undefined {
  if (!value || !z.iso.datetime().safeParse(value).success) return undefined
  return Number.isFinite(new Date(value).valueOf()) ? value : undefined
}

function normalizeStatus(status: string, conclusion: string | null): PipelineStatus['status'] {
  if (status !== 'completed') return 'running'
  if (conclusion === 'success') return 'passed'
  if (conclusion === 'failure' || conclusion === 'timed_out') return 'failed'
  if (conclusion === 'cancelled') return 'cancelled'
  return 'unknown'
}

function errorKind(
  status: number,
): Extract<ErrorKind, 'unauthorized' | 'not-found' | 'upstream-error'> {
  return upstreamErrorKind(status)
}

function errorEnvelope(
  panelId: string,
  kind: ErrorKind,
  error: unknown,
  link: string,
  observedAt = new Date().toISOString(),
): Envelope {
  return upstreamErrorEnvelope({ panelId, kind, error, link, upstreamDate: observedAt })
}

function sourceLink(panel: Panel, source: Source): string {
  const parsedPanel = pipelinePanelSchema.parse(panel)
  const parsedSource = githubActionsSourceSchema.parse(source)
  return `https://github.com/${parsedSource.repo}/actions/workflows/${encodeURIComponent(parsedPanel.pipeline)}`
}

function observedAt(value: string | null): string {
  return upstreamObservedAt(value)
}
