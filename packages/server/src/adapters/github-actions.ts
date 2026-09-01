import type {
  Envelope,
  ErrorKind,
  GithubActionsSource,
  Panel,
  PipelineStatus,
  Source,
} from '@ze-great-dashboard/shared'
import { githubActionsSourceSchema } from '@ze-great-dashboard/shared'
import { z } from 'zod'
import { type CredentialResolver, environmentCredentials } from '../credentials.ts'
import { createGithubClient, GithubAuthenticationError, type GithubClient } from '../github-auth.ts'
import {
  type AdapterResult,
  safeNetworkCode,
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

export function pullRequestHealthCapabilities(panel: Panel) {
  const parsed = pullRequestHealthPanelSchema.parse(panel)
  return {
    panel: parsed,
    configuredUpdateWorkflow(workflow: string) {
      return parsed.update_workflows.find((candidate) => candidate.workflow === workflow)
    },
    permitsBuildBranch(branch: string) {
      return parsed.update_workflows.some(({ branch_prefixes }) =>
        branch_prefixes.some((prefix) => branch.startsWith(prefix)),
      )
    },
  }
}

export async function fetchGithubActionsPullRequestCandidates(
  args: AdapterArgs,
): Promise<AdapterResult> {
  const capabilities = pullRequestHealthCapabilities(args.panel)
  const panel = capabilities.panel
  const source = githubActionsSourceSchema.parse(args.source)
  return githubObservation(
    args,
    source,
    pullRequestsCall(source, panel.base_branch, 1),
    (value, observedAt) => {
      const page = pullRequestsSchema.parse(value)
      const pullRequests = page.filter((pullRequest) =>
        capabilities.permitsBuildBranch(pullRequest.head.ref),
      )
      return {
        panelId: panel.id,
        state: 'ok',
        observedAt,
        link: sourceLinkForRepository(source),
        signal: {
          type: 'pull-request-candidates',
          pullRequests: pullRequests.map((pullRequest) => ({
            number: pullRequest.number,
            branch: pullRequest.head.ref,
            link: pullRequest.html_url,
          })),
          ...(page.length === 100 ? { truncated: true } : {}),
        },
      } satisfies Envelope
    },
  )
}

export async function fetchGithubActionsUpdateWorkflow(
  args: AdapterArgs & { workflow: string },
): Promise<AdapterResult> {
  const capabilities = pullRequestHealthCapabilities(args.panel)
  const panel = capabilities.panel
  const source = githubActionsSourceSchema.parse(args.source)
  const configured = capabilities.configuredUpdateWorkflow(args.workflow)
  if (!configured) throw new Error('Unconfigured update workflow')
  return githubObservation(
    args,
    source,
    githubRunsCall(source, configured.workflow, undefined, undefined, 100),
    (value, observedAt) => {
      const run = runsSchema.parse(value).workflow_runs.find((candidate) => {
        const branch = candidate.head_branch
        return (
          typeof branch === 'string' &&
          configured.branch_prefixes.some((prefix) => branch.startsWith(prefix))
        )
      })
      return {
        panelId: panel.id,
        state: 'ok',
        observedAt,
        link: sourceLinkForRepository(source),
        signal: {
          type: 'pull-request-workflow',
          workflow: configured.workflow,
          item: healthItem(configured.workflow, run, `Update workflow ${configured.workflow}`),
        },
      } satisfies Envelope
    },
  )
}

export async function fetchGithubActionsPullRequestBuild(
  args: AdapterArgs & { branch: string },
): Promise<AdapterResult> {
  const capabilities = pullRequestHealthCapabilities(args.panel)
  const panel = capabilities.panel
  const source = githubActionsSourceSchema.parse(args.source)
  if (!capabilities.permitsBuildBranch(args.branch))
    throw new Error('Unpermitted pull request branch')
  return githubObservation(
    args,
    source,
    githubRunsCall(source, panel.build_workflow, args.branch, 'pull_request'),
    (value, observedAt) => {
      const run = runsSchema.parse(value).workflow_runs[0]
      return {
        panelId: panel.id,
        state: 'ok',
        observedAt,
        link: sourceLinkForRepository(source),
        signal: {
          type: 'pull-request-build',
          branch: args.branch,
          item: healthItem(args.branch, run, args.branch),
        },
      } satisfies Envelope
    },
  )
}

type AdapterArgs = {
  panel: Panel
  source: Source
  requestHeaders: Headers
  fetcher: typeof fetch
  githubClient?: GithubClient
  credentials?: CredentialResolver
}

async function githubObservation(
  args: AdapterArgs,
  source: GithubActionsSource,
  call: PermittedCall,
  normalize: (value: unknown, observedAt: string) => Envelope,
): Promise<AdapterResult> {
  let upstream: Response
  try {
    upstream = await githubFetch(call, { ...args, source, githubClient: githubClientFor(args) })
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(
            args.panel.id,
            error instanceof GithubAuthenticationError ? 'unauthorized' : 'unreachable',
            error,
            sourceLinkForRepository(source),
          ),
        ),
        { status: 200 },
      ),
      failure: {
        kind: error instanceof GithubAuthenticationError ? 'unauthorized' : 'unreachable',
        ...(safeNetworkCode(error) ? { networkCode: safeNetworkCode(error) } : {}),
      },
    }
  }
  if (upstream.status === 304) return { response: upstream }
  if (!upstream.ok)
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(
            args.panel.id,
            errorKind(upstream.status),
            `${upstream.status} ${upstream.statusText}`,
            sourceLinkForRepository(source),
            observedAt(upstream.headers.get('date')),
          ),
        ),
        { status: 200 },
      ),
      failure: { kind: errorKind(upstream.status), upstreamStatus: upstream.status },
    }
  try {
    return {
      envelope: normalize(await upstream.json(), observedAt(upstream.headers.get('date'))),
      response: upstream,
    }
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(
            args.panel.id,
            'upstream-error',
            error,
            sourceLinkForRepository(source),
            observedAt(upstream.headers.get('date')),
          ),
        ),
        { status: 200 },
      ),
      failure: { kind: 'upstream-error', upstreamStatus: upstream.status },
    }
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
      failure: {
        kind: error instanceof GithubAuthenticationError ? 'unauthorized' : 'unreachable',
        ...(safeNetworkCode(error) ? { networkCode: safeNetworkCode(error) } : {}),
      },
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
      failure: { kind: errorKind(upstream.status), upstreamStatus: upstream.status },
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
        failure: { kind: 'no-runs', upstreamStatus: upstream.status },
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
      failure: { kind: 'upstream-error', upstreamStatus: upstream.status },
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
