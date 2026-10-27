import type {
  Envelope,
  ErrorKind,
  GithubActionsSource,
  Panel,
  PipelineStatus,
  Source,
  TestCount,
  TestResultsArtifact,
} from '@ze-great-dashboard/shared'
import {
  githubActionsBuildEventSchema,
  githubActionsBuildEventsSchema,
  githubActionsSourceSchema,
  testCountPanelSchema,
} from '@ze-great-dashboard/shared'
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
import { readTestResultsArtifact, testResultsSummarySchema } from '../workflow-artifact-summary.ts'
import type { PermittedCall } from './types.ts'

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
  build_events: githubActionsBuildEventsSchema.optional(),
})

const runSchema = z.object({
  id: z.number().int().positive().optional(),
  run_attempt: z.number().int().positive().optional(),
  head_sha: z.string().min(1).optional(),
  status: z.string(),
  conclusion: z.string().nullable(),
  name: z.string().min(1),
  html_url: z.url(),
  /** The GitHub Actions trigger that started this run. */
  event: z.string().min(1).optional(),
  /** The branch that produced this run; absent for some event types. */
  head_branch: z.string().min(1).nullable().optional(),
  // Timestamp quality should only remove timing advice, never make an otherwise useful run unreadable.
  run_started_at: z.string().nullable().optional(),
  updated_at: z.string().optional(),
  created_at: z.string().optional(),
})

const artifactsSchema = z.object({
  artifacts: z.array(
    z.object({ id: z.number().int().positive(), name: z.string().min(1), expired: z.boolean() }),
  ),
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

export function permittedGithubActionsCalls(
  panel: Panel,
  source: Source,
  _credentials?: CredentialResolver,
): PermittedCall[] {
  const { panel: parsedPanel, source: parsedSource } = z
    .object({ panel: pipelinePanelSchema, source: githubActionsSourceSchema })
    .parse({ panel, source })
  const url = new URL(
    `https://api.github.com/repos/${parsedSource.repo}/actions/workflows/${encodeURIComponent(parsedPanel.pipeline)}/runs`,
  )
  if (parsedSource.branch) url.searchParams.set('branch', parsedSource.branch)
  // The browser collects duration history; the adapter only needs GitHub's first run.
  url.searchParams.set('per_page', '1')

  return [{ url: url.toString(), headers: new Headers() }]
}

/** Validates the complete, bounded configuration for one GitHub Actions test-count panel. */
export function testCountCapabilities(panel: Panel, source: Source) {
  return z
    .object({ panel: testCountPanelSchema, source: githubActionsSourceSchema })
    .parse({ panel, source })
}

/**
 * Reads the one explicitly configured workflow artifact and turns its summary into public evidence.
 * The artifact is deliberately consumed here, never forwarded to the browser: it is provider input,
 * not a client contract.
 */
export async function fetchGithubActionsTestCount(args: {
  panel: Panel
  source: Source
  requestHeaders: Headers
  fetcher: typeof fetch
  githubClient?: GithubClient
  credentials?: CredentialResolver
}): Promise<AdapterResult> {
  const { panel, source } = testCountCapabilities(args.panel, args.source)
  const githubClient = githubClientFor(args)
  const noValidators = new Headers()
  let failureLink = sourceLinkForWorkflow(source, panel.pipeline)
  let failureObservedAt: string | undefined
  try {
    const selected = await selectGithubWorkflowRun({
      ...args,
      source,
      workflow: panel.pipeline,
      requestHeaders: noValidators,
      githubClient,
    })
    if (!selected.response.ok) return testCountFailure(panel.id, source, selected.response)
    const { run } = selected
    if (!run?.id)
      return testCountEnvelope(
        noRunEnvelope(panel.id, source, panel.pipeline, selected.response.headers.get('date')),
      )
    const link = run.html_url
    const runObservedAt = selected.observedAt
    failureLink = link
    failureObservedAt = runObservedAt
    if (run.status !== 'completed')
      return testCountEnvelope({
        panelId: panel.id,
        state: 'ok',
        observedAt: runObservedAt,
        link,
        signal: { type: 'test-count', status: 'pending' } satisfies TestCount,
      })

    const artifactsResponse = await githubFetch(
      githubArtifactsCall(source, run.id, panel.test_results),
      {
        ...args,
        source,
        requestHeaders: noValidators,
        githubClient,
      },
    )
    if (!artifactsResponse.ok) return testCountFailure(panel.id, source, artifactsResponse, link)
    const artifactObservedAt = observedAt(artifactsResponse.headers.get('date'))
    failureObservedAt = oldestObservation(runObservedAt, artifactObservedAt)
    const artifacts = artifactsSchema.parse(await artifactsResponse.json()).artifacts
    const matches = artifacts.filter((artifact) => artifact.name === panel.test_results.artifact)
    if (matches.length === 0)
      return testCountEnvelope({
        panelId: panel.id,
        state: 'ok',
        observedAt: oldestObservation(runObservedAt, artifactObservedAt),
        link,
        signal: { type: 'test-count', status: 'not-reported' } satisfies TestCount,
      })
    if (matches.length !== 1 || matches[0]?.expired)
      return testCountEnvelope(
        errorEnvelope(
          panel.id,
          'upstream-error',
          'The test-results artifact is unavailable.',
          link,
        ),
      )
    const [artifact] = matches
    if (!artifact)
      return testCountEnvelope(
        errorEnvelope(
          panel.id,
          'upstream-error',
          'The test-results artifact is unavailable.',
          link,
        ),
      )
    const archiveResponse = await githubFetch(githubArtifactDownloadCall(source, artifact.id), {
      ...args,
      source,
      requestHeaders: noValidators,
      githubClient,
    })
    if (!archiveResponse.ok) return testCountFailure(panel.id, source, archiveResponse, link)
    const archiveObservedAt = observedAt(archiveResponse.headers.get('date'))
    failureObservedAt = oldestObservation(runObservedAt, artifactObservedAt, archiveObservedAt)
    const summary = testResultsSummarySchema.parse(
      JSON.parse(await readTestResultsArtifact(archiveResponse, panel.test_results.entry)),
    )
    if (
      summary.runId !== run.id ||
      summary.runAttempt !== run.run_attempt ||
      summary.headSha !== run.head_sha
    )
      throw new Error('Test-results manifest does not belong to the selected workflow run.')
    return testCountEnvelope({
      panelId: panel.id,
      state: 'ok',
      observedAt: oldestObservation(runObservedAt, artifactObservedAt, archiveObservedAt),
      link,
      signal: {
        type: 'test-count',
        status: 'reported',
        total: summary.total,
        ...(summary.passed === undefined ? {} : { passed: summary.passed }),
        ...(summary.failed === undefined ? {} : { failed: summary.failed }),
        ...(summary.skipped === undefined ? {} : { skipped: summary.skipped }),
      } satisfies TestCount,
    })
  } catch (error) {
    return testCountEnvelope(
      errorEnvelope(
        panel.id,
        error instanceof GithubAuthenticationError ? 'unauthorized' : 'upstream-error',
        error,
        failureLink,
        failureObservedAt,
      ),
    )
  }
}

export function pullRequestHealthCapabilities(panel: Panel) {
  const { panel: parsed } = z.object({ panel: pullRequestHealthPanelSchema }).parse({ panel })
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
    githubRunsCall(
      source,
      panel.build_workflow,
      args.branch,
      undefined,
      panel.build_events ? 100 : 1,
    ),
    (value, observedAt) => {
      const run = runsSchema.parse(value).workflow_runs.find((candidate) => {
        if (!panel.build_events) return true
        const event = githubActionsBuildEventSchema.safeParse(candidate.event)
        return event.success && panel.build_events.includes(event.data)
      })
      return {
        panelId: panel.id,
        state: 'ok',
        observedAt,
        link: sourceLinkForRepository(source),
        signal: {
          type: 'pull-request-build',
          branch: args.branch,
          item: healthItem(args.branch, run, args.branch, undefined, true),
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
  created?: string,
): PermittedCall {
  const url = new URL(
    `https://api.github.com/repos/${source.repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
  )
  if (branch) url.searchParams.set('branch', branch)
  if (event) url.searchParams.set('event', event)
  if (created) url.searchParams.set('created', `>=${created}`)
  url.searchParams.set('per_page', String(perPage))
  return { url: url.toString(), headers: new Headers() }
}

function healthItem(
  label: string,
  run: z.infer<typeof runSchema> | undefined,
  detail: string,
  link?: string,
  includeEvent = false,
) {
  return {
    label,
    status: run ? normalizeStatus(run.status, run.conclusion) : ('unknown' as const),
    detail: run
      ? `${detail}${includeEvent ? ` · ${run.event ?? 'unknown trigger'}` : ''} · ${run.conclusion ?? run.status}`
      : `${detail} · No run found`,
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
  const parsedPanel = pipelinePanelSchema.parse(args.panel)
  const githubClient = githubClientFor(args)
  let selected: Awaited<ReturnType<typeof selectGithubWorkflowRun>>
  try {
    selected = await selectGithubWorkflowRun({
      ...args,
      source: parsedSource,
      workflow: parsedPanel.pipeline,
      githubClient,
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

  const upstream = selected.response
  if (upstream.status === 304) return { response: upstream }
  if (!upstream.ok) return githubPipelineFailure(args, upstream)

  try {
    const run = selected.run
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

function githubPipelineFailure(
  args: { panel: Panel; source: Source },
  upstream: Response,
): AdapterResult {
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

function recentRunsCreatedAt(now = new Date()) {
  return new Date(now.valueOf() - 30 * 24 * 60 * 60 * 1_000).toISOString()
}

function newestGithubRun(runs: z.infer<typeof runSchema>[]) {
  return runs.reduce<z.infer<typeof runSchema> | undefined>((newest, candidate) => {
    if (!newest) return candidate
    const candidateCreatedAt = Date.parse(candidate.created_at ?? '')
    const newestCreatedAt = Date.parse(newest.created_at ?? '')
    if (candidateCreatedAt > newestCreatedAt) return candidate
    if (candidateCreatedAt < newestCreatedAt) return newest
    // Equal timestamps are uncommon, but a stable id makes unordered API results deterministic.
    return (candidate.id ?? 0) > (newest.id ?? 0) ? candidate : newest
  }, undefined)
}

/**
 * Selects the same newest workflow run for every GitHub Actions panel. The recent query avoids
 * GitHub's stale listing behavior; only an empty bounded page falls back to history.
 */
async function selectGithubWorkflowRun(
  args: AdapterArgs & { source: GithubActionsSource; workflow: string; githubClient: GithubClient },
) {
  let response = await githubFetch(
    githubRunsCall(
      args.source,
      args.workflow,
      args.source.branch,
      undefined,
      100,
      recentRunsCreatedAt(),
    ),
    args,
  )
  if (response.status === 304 || !response.ok)
    return { response, observedAt: observedAt(response.headers.get('date')), run: undefined }
  let runs = runsSchema.parse(await response.json()).workflow_runs
  if (runs.length === 0) {
    response = await githubFetch(
      githubRunsCall(args.source, args.workflow, args.source.branch),
      args,
    )
    if (response.status === 304 || !response.ok)
      return { response, observedAt: observedAt(response.headers.get('date')), run: undefined }
    runs = runsSchema.parse(await response.json()).workflow_runs
  }
  return {
    response,
    observedAt: observedAt(response.headers.get('date')),
    run: newestGithubRun(runs),
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

function githubArtifactsCall(
  source: GithubActionsSource,
  runId: number,
  testResults: TestResultsArtifact,
): PermittedCall {
  const url = new URL(`https://api.github.com/repos/${source.repo}/actions/runs/${runId}/artifacts`)
  url.searchParams.set('name', testResults.artifact)
  url.searchParams.set('per_page', '100')
  return { url: url.toString(), headers: new Headers() }
}

function githubArtifactDownloadCall(
  source: GithubActionsSource,
  artifactId: number,
): PermittedCall {
  return {
    url: `https://api.github.com/repos/${source.repo}/actions/artifacts/${artifactId}/zip`,
    headers: new Headers(),
  }
}

function noRunEnvelope(
  panelId: string,
  source: GithubActionsSource,
  pipeline: string,
  date: string | null,
): Envelope {
  return {
    panelId,
    state: 'error',
    observedAt: observedAt(date),
    link: sourceLinkForWorkflow(source, pipeline),
    error: {
      kind: 'no-runs',
      message: 'No matching workflow runs were found. Check the configured workflow and branch.',
    },
  }
}

function testCountFailure(
  panelId: string,
  source: GithubActionsSource,
  response: Response,
  link = sourceLinkForRepository(source),
): AdapterResult {
  return testCountEnvelope(
    errorEnvelope(
      panelId,
      errorKind(response.status),
      `${response.status} ${response.statusText}`,
      link,
      observedAt(response.headers.get('date')),
    ),
    { kind: errorKind(response.status), upstreamStatus: response.status },
  )
}

function testCountEnvelope(envelope: Envelope, failure?: AdapterResult['failure']): AdapterResult {
  // Fanned-out observations must not expose one upstream validator as though it represented all.
  return { envelope, response: new Response(null), ...(failure ? { failure } : {}) }
}

function oldestObservation(...values: string[]): string {
  return values.reduce((oldest, value) => (Date.parse(value) < Date.parse(oldest) ? value : oldest))
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
  const parsedPanel = z.object({ pipeline: z.string().min(1) }).parse(panel)
  const parsedSource = githubActionsSourceSchema.parse(source)
  return sourceLinkForWorkflow(parsedSource, parsedPanel.pipeline)
}

function sourceLinkForWorkflow(source: GithubActionsSource, pipeline: string): string {
  return `https://github.com/${source.repo}/actions/workflows/${encodeURIComponent(pipeline)}`
}

function observedAt(value: string | null): string {
  return upstreamObservedAt(value)
}
