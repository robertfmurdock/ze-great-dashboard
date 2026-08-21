import type { Envelope, ErrorKind, Panel, PipelineStatus, Source } from '@ze-great-dashboard/shared'
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

const runSchema = z.object({
  status: z.string(),
  conclusion: z.string().nullable(),
  name: z.string().min(1),
  html_url: z.url(),
  run_started_at: z.iso.datetime().nullable().optional(),
  updated_at: z.iso.datetime().optional(),
})

const runsSchema = z.object({ workflow_runs: z.array(runSchema) })

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
