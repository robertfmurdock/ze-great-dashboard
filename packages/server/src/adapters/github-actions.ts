import type {
  Envelope,
  ErrorKind,
  Panel,
  PipelineStatus,
  PullRequestHealth,
  Source,
} from '@ze-great-dashboard/shared'
import { z } from 'zod'

const githubSourceSchema = z.object({
  type: z.literal('github-actions'),
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'must be an owner/repository pair'),
  /** The branch whose workflow health the dashboard represents. */
  branch: z.string().min(1).optional(),
  token_env: z.string().min(1).optional(),
})

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
  status: z.string(),
  conclusion: z.string().nullable(),
  name: z.string().min(1),
  html_url: z.url(),
  run_started_at: z.iso.datetime().nullable().optional(),
  updated_at: z.iso.datetime().optional(),
})

const runsSchema = z.object({ workflow_runs: z.array(runSchema) })

const pullRequestsSchema = z.array(
  z.object({
    number: z.number().int().positive(),
    html_url: z.url(),
    head: z.object({ ref: z.string().min(1) }),
    base: z.object({ ref: z.string().min(1) }),
  }),
)

export type PermittedCall = { url: string; headers: Headers }

export function permittedGithubActionsCalls(panel: Panel, source: Source): PermittedCall[] {
  const parsedPanel = pipelinePanelSchema.parse(panel)
  const parsedSource = githubSourceSchema.parse(source)
  const url = new URL(
    `https://api.github.com/repos/${parsedSource.repo}/actions/workflows/${encodeURIComponent(parsedPanel.pipeline)}/runs`,
  )
  if (parsedSource.branch) url.searchParams.set('branch', parsedSource.branch)
  url.searchParams.set('per_page', '1')

  const headers = new Headers({ accept: 'application/vnd.github+json' })
  const token = parsedSource.token_env ? process.env[parsedSource.token_env] : undefined
  if (token) headers.set('authorization', `Bearer ${token}`)
  return [{ url: url.toString(), headers }]
}

export function permittedGithubActionsPullRequestHealthCalls(
  panel: Panel,
  source: Source,
): PermittedCall[] {
  const parsedPanel = pullRequestHealthPanelSchema.parse(panel)
  const parsedSource = githubSourceSchema.parse(source)
  const calls = parsedPanel.update_workflows.map(({ workflow }) =>
    githubRunsCall(parsedSource, workflow),
  )
  calls.push({
    url: pullRequestsCall(parsedSource, parsedPanel.base_branch, 1).url,
    headers: githubHeaders(parsedSource),
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
}): Promise<{ envelope?: Envelope; response: Response }> {
  const panel = pullRequestHealthPanelSchema.parse(args.panel)
  const source = githubSourceSchema.parse(args.source)
  try {
    const workflowResults = await Promise.all(
      panel.update_workflows.map(async ({ workflow }) => ({
        workflow,
        run: await latestRun({
          source,
          workflow,
          requestHeaders: args.requestHeaders,
          fetcher: args.fetcher,
        }),
      })),
    )
    const pullRequests = await openPullRequests({
      source,
      baseBranch: panel.base_branch,
      requestHeaders: args.requestHeaders,
      fetcher: args.fetcher,
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
          errorEnvelope(panel.id, 'upstream-error', error, sourceLinkForRepository(source)),
        ),
        { status: 200 },
      ),
    }
  }
}

async function latestRun(args: {
  source: z.infer<typeof githubSourceSchema>
  workflow: string
  branch?: string
  event?: string
  requestHeaders: Headers
  fetcher: typeof fetch
}) {
  const call = githubRunsCall(args.source, args.workflow, args.branch, args.event)
  forwardValidators(args.requestHeaders, call.headers)
  const response = await args.fetcher(call.url, { headers: call.headers })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  const runs = runsSchema.parse(await response.json()).workflow_runs
  return runs[0]
}

async function openPullRequests(args: {
  source: z.infer<typeof githubSourceSchema>
  baseBranch: string
  requestHeaders: Headers
  fetcher: typeof fetch
}) {
  const result = []
  for (let page = 1; ; page += 1) {
    const call = pullRequestsCall(args.source, args.baseBranch, page)
    forwardValidators(args.requestHeaders, call.headers)
    const response = await args.fetcher(call.url, { headers: call.headers })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    const pageResults = pullRequestsSchema.parse(await response.json())
    result.push(...pageResults)
    if (pageResults.length < 100) return result
  }
}

function pullRequestsCall(
  source: z.infer<typeof githubSourceSchema>,
  baseBranch: string,
  page: number,
): PermittedCall {
  const url = new URL(`https://api.github.com/repos/${source.repo}/pulls`)
  url.searchParams.set('state', 'open')
  url.searchParams.set('base', baseBranch)
  url.searchParams.set('per_page', '100')
  url.searchParams.set('page', String(page))
  return { url: url.toString(), headers: githubHeaders(source) }
}

function githubHeaders(source: z.infer<typeof githubSourceSchema>) {
  const headers = new Headers({ accept: 'application/vnd.github+json' })
  const token = source.token_env ? process.env[source.token_env] : undefined
  if (token) headers.set('authorization', `Bearer ${token}`)
  return headers
}

function githubRunsCall(
  source: z.infer<typeof githubSourceSchema>,
  workflow: string,
  branch?: string,
  event?: string,
): PermittedCall {
  const url = new URL(
    `https://api.github.com/repos/${source.repo}/actions/workflows/${encodeURIComponent(workflow)}/runs`,
  )
  if (branch) url.searchParams.set('branch', branch)
  if (event) url.searchParams.set('event', event)
  url.searchParams.set('per_page', '1')
  return { url: url.toString(), headers: githubHeaders(source) }
}

function forwardValidators(requestHeaders: Headers, target: Headers) {
  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = requestHeaders.get(name)
    if (value) target.set(name, value)
  }
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

function sourceLinkForRepository(source: z.infer<typeof githubSourceSchema>) {
  return `https://github.com/${source.repo}`
}

export async function fetchGithubActionsPipeline(args: {
  panel: Panel
  source: Source
  requestHeaders: Headers
  fetcher: typeof fetch
}): Promise<{ envelope?: Envelope; response: Response }> {
  const parsedSource = githubSourceSchema.parse(args.source)
  const call = permittedGithubActionsCalls(args.panel, args.source)[0]
  if (!call) throw new Error('GitHub Actions adapter declared no permitted call')

  for (const name of ['if-none-match', 'if-modified-since']) {
    const value = args.requestHeaders.get(name)
    if (value) call.headers.set(name, value)
  }

  let upstream: Response
  try {
    upstream = await args.fetcher(call.url, { headers: call.headers })
  } catch (error) {
    return {
      response: new Response(
        JSON.stringify(
          errorEnvelope(args.panel.id, 'unreachable', error, sourceLink(args.panel, args.source)),
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
    const run = runsSchema.parse(await upstream.json()).workflow_runs[0]
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
      branch: parsedSource.branch,
      ...(run.updated_at ? { sourceUpdatedAt: run.updated_at } : {}),
      ...(run.status === 'completed' ? completedRunDuration(run) : {}),
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

function completedRunDuration(run: z.infer<typeof runSchema>): Pick<PipelineStatus, 'durationMs'> {
  if (!run.run_started_at || !run.updated_at) return {}
  const durationMs = new Date(run.updated_at).valueOf() - new Date(run.run_started_at).valueOf()
  return Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}
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
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'not-found'
  return 'upstream-error'
}

function errorEnvelope(
  panelId: string,
  kind: ErrorKind,
  error: unknown,
  link: string,
  observedAt = new Date().toISOString(),
): Envelope {
  return {
    panelId,
    state: 'error',
    observedAt,
    link,
    error: { kind, message: error instanceof Error ? error.message : String(error) },
  }
}

function sourceLink(panel: Panel, source: Source): string {
  const parsedPanel = pipelinePanelSchema.parse(panel)
  const parsedSource = githubSourceSchema.parse(source)
  return `https://github.com/${parsedSource.repo}/actions/workflows/${encodeURIComponent(parsedPanel.pipeline)}`
}

function observedAt(value: string | null): string {
  const parsed = value ? new Date(value) : undefined
  return parsed && !Number.isNaN(parsed.valueOf()) ? parsed.toISOString() : new Date().toISOString()
}
