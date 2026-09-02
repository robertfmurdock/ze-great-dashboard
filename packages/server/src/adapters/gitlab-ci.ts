import type {
  Envelope,
  ErrorKind,
  GitlabCiSource,
  Panel,
  PipelineStatus,
  Source,
} from '@ze-great-dashboard/shared'
import { gitlabCiSourceSchema } from '@ze-great-dashboard/shared'
import { z } from 'zod'
import type { CredentialResolver } from '../credentials.ts'
import {
  type AdapterResult,
  forwardValidators,
  publicLink,
  safeNetworkCode,
  upstreamErrorEnvelope,
  upstreamErrorKind,
  upstreamErrorResponse,
  observedAt as upstreamObservedAt,
} from '../upstream.ts'
import type { PermittedCall } from './types.ts'

const pipelinePanelSchema = z.object({
  id: z.string().min(1),
  type: z.literal('pipeline-status'),
  source: z.string().min(1),
})

const pipelineSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).nullable().optional(),
  status: z.string(),
  ref: z.string().min(1).nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
  web_url: z.url(),
})

/** Builds the one bounded GitLab API call permitted for a configured pipeline-status panel. */
export function permittedGitlabCiCalls(panel: Panel, source: Source): PermittedCall[] {
  pipelinePanelSchema.parse(panel)
  const parsedSource = gitlabCiSourceSchema.parse(source)
  return [pipelinesCall(parsedSource)]
}

export async function fetchGitlabCiPipeline(args: {
  panel: Panel
  source: Source
  requestHeaders: Headers
  fetcher: typeof fetch
  credentials: CredentialResolver
}): Promise<AdapterResult> {
  const panel = pipelinePanelSchema.parse(args.panel)
  const source = gitlabCiSourceSchema.parse(args.source)
  const token = args.credentials.get(source.token_env)
  if (!token)
    return failure(
      panel.id,
      'unauthorized',
      'GitLab credentials are not available.',
      sourceLink(source),
    )

  const call = pipelinesCall(source)
  forwardValidators(args.requestHeaders, call.headers)
  call.headers.set('private-token', token)

  let upstream: Response
  try {
    upstream = await args.fetcher(call.url, { headers: call.headers })
  } catch (error) {
    return failure(panel.id, 'unreachable', error, sourceLink(source), undefined, {
      kind: 'unreachable',
      ...(safeNetworkCode(error) ? { networkCode: safeNetworkCode(error) } : {}),
    })
  }
  if (upstream.status === 304) return { response: upstream }
  if (!upstream.ok) {
    const kind = upstreamErrorKind(upstream.status)
    return failure(
      panel.id,
      kind,
      `${upstream.status} ${upstream.statusText}`,
      sourceLink(source),
      upstream.headers.get('date'),
      { kind, upstreamStatus: upstream.status },
    )
  }

  try {
    const pipeline = z.array(pipelineSchema).parse(await upstream.json())[0]
    if (!pipeline) {
      const detail = source.branch
        ? `No pipelines found for ref "${source.branch}". Check the source's branch setting.`
        : 'No pipelines found.'
      return failure(
        panel.id,
        'no-runs',
        detail,
        sourceLink(source),
        upstream.headers.get('date'),
        {
          kind: 'no-runs',
          upstreamStatus: upstream.status,
        },
      )
    }
    const signal: PipelineStatus = {
      type: 'pipeline-status',
      status: normalizeStatus(pipeline.status),
      rawStatus: pipeline.status,
      name: pipeline.name ?? `Pipeline #${pipeline.id}`,
      ...((pipeline.ref ?? source.branch) ? { branch: pipeline.ref ?? source.branch } : {}),
      ...(timestamp(pipeline.created_at) ? { runStartedAt: timestamp(pipeline.created_at) } : {}),
      ...(timestamp(pipeline.updated_at)
        ? { sourceUpdatedAt: timestamp(pipeline.updated_at) }
        : {}),
      sourceRunId: String(pipeline.id),
    }
    const envelope: Envelope = {
      panelId: panel.id,
      state: 'ok',
      observedAt: upstreamObservedAt(upstream.headers.get('date')),
      link: publicLink(pipeline.web_url),
      signal,
    }
    return { envelope, response: upstream }
  } catch (error) {
    return failure(
      panel.id,
      'upstream-error',
      error,
      sourceLink(source),
      upstream.headers.get('date'),
      { kind: 'upstream-error', upstreamStatus: upstream.status },
    )
  }
}

function pipelinesCall(source: GitlabCiSource): PermittedCall {
  const url = new URL(source.url)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v4/projects/${encodeURIComponent(source.project)}/pipelines`
  url.searchParams.set('per_page', '1')
  if (source.branch) url.searchParams.set('ref', source.branch)
  return { url: url.toString(), headers: new Headers({ accept: 'application/json' }) }
}

function sourceLink(source: GitlabCiSource): string {
  const url = new URL(source.url)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${source.project
    .split('/')
    .map(encodeURIComponent)
    .join('/')}/-/pipelines`
  return url.toString()
}

function normalizeStatus(status: string): PipelineStatus['status'] {
  if (['created', 'waiting_for_resource', 'preparing', 'pending', 'running'].includes(status))
    return 'running'
  if (status === 'success') return 'passed'
  if (status === 'failed') return 'failed'
  if (status === 'canceled') return 'cancelled'
  if (['manual', 'skipped', 'scheduled'].includes(status)) return 'warning'
  return 'unknown'
}

function timestamp(value: string | null | undefined): string | undefined {
  if (!value || !z.iso.datetime().safeParse(value).success) return undefined
  return Number.isFinite(new Date(value).valueOf()) ? value : undefined
}

function failure(
  panelId: string,
  kind: ErrorKind,
  error: unknown,
  link: string,
  date?: string | null,
  failure?: NonNullable<AdapterResult['failure']>,
): AdapterResult {
  return {
    response: upstreamErrorResponse(
      upstreamErrorEnvelope({ panelId, kind, error, link, upstreamDate: date }),
    ),
    ...(failure ? { failure } : { failure: { kind } }),
  }
}
