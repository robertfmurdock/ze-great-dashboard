import { readFile } from 'node:fs/promises'
import type {
  AzureDevOpsSource,
  Envelope,
  ErrorKind,
  Panel,
  PipelineStatus,
  Source,
} from '@ze-great-dashboard/shared'
import { azureDevOpsSourceSchema } from '@ze-great-dashboard/shared'
import { z } from 'zod'
import type { CredentialResolver } from '../credentials.ts'
import {
  type AdapterResult,
  forwardValidators,
  safeNetworkCode,
  upstreamErrorEnvelope,
  upstreamErrorKind,
  upstreamErrorResponse,
  observedAt as upstreamObservedAt,
} from '../upstream.ts'
import type { PermittedCall } from './github-actions.ts'

const pipelinePanelSchema = z.object({
  id: z.string().min(1),
  type: z.literal('pipeline-status'),
  source: z.string().min(1),
  pipeline: z.number().int().positive(),
})

const buildSchema = z.object({
  id: z.number().int().positive(),
  buildNumber: z.string().min(1),
  status: z.string().nullable().optional(),
  result: z.string().nullable().optional(),
  sourceBranch: z.string().min(1).nullable().optional(),
  startTime: z.string().nullable().optional(),
  finishTime: z.string().nullable().optional(),
  lastChangedDate: z.string().nullable().optional(),
})

const buildsSchema = z.object({ value: z.array(buildSchema) })

const timelineSchema = z.object({
  records: z.array(
    z.object({
      id: z.string().min(1),
      parentId: z.string().min(1).nullable().optional(),
      type: z.string().min(1),
      name: z.string().min(1),
      state: z.string().nullable().optional(),
    }),
  ),
})

/** Builds the one bounded ADO call permitted for a configured pipeline-status panel. */
export function permittedAzureDevOpsCalls(panel: Panel, source: Source): PermittedCall[] {
  const parsedPanel = pipelinePanelSchema.parse(panel)
  const parsedSource = azureDevOpsSourceSchema.parse(source)
  return [buildsCall(parsedPanel.pipeline, parsedSource)]
}

export async function fetchAzureDevOpsPipeline(args: {
  panel: Panel
  source: Source
  requestHeaders: Headers
  fetcher: typeof fetch
  credentials: CredentialResolver
}): Promise<AdapterResult> {
  const panel = pipelinePanelSchema.parse(args.panel)
  const source = azureDevOpsSourceSchema.parse(args.source)
  const authorization = await azureDevOpsAuthorization(source, args.credentials)
  if (!authorization) {
    return {
      response: errorResponse(
        errorEnvelope(
          panel.id,
          'unauthorized',
          'Azure DevOps credentials are not available.',
          sourceLink(panel.pipeline, source),
        ),
      ),
      failure: { kind: 'unauthorized' },
    }
  }

  const call = buildsCall(panel.pipeline, source)
  copyValidators(args.requestHeaders, call.headers)
  call.headers.set('authorization', authorization)

  let upstream: Response
  try {
    upstream = await args.fetcher(call.url, { headers: call.headers })
  } catch (error) {
    return {
      response: errorResponse(
        errorEnvelope(panel.id, 'unreachable', error, sourceLink(panel.pipeline, source)),
      ),
      failure: {
        kind: 'unreachable',
        ...(safeNetworkCode(error) ? { networkCode: safeNetworkCode(error) } : {}),
      },
    }
  }
  if (upstream.status === 304) return { response: upstream }
  if (!upstream.ok) {
    return {
      response: errorResponse(
        errorEnvelope(
          panel.id,
          errorKind(upstream.status),
          `${upstream.status} ${upstream.statusText}`,
          sourceLink(panel.pipeline, source),
          observedAt(upstream.headers.get('date')),
        ),
      ),
      failure: { kind: errorKind(upstream.status), upstreamStatus: upstream.status },
    }
  }

  try {
    const build = buildsSchema.parse(await upstream.json()).value[0]
    if (!build) {
      return {
        response: errorResponse(
          errorEnvelope(
            panel.id,
            'no-runs',
            source.branch
              ? `No builds found for branch "${source.branch}". Check the source's branch setting.`
              : 'No builds found.',
            sourceLink(panel.pipeline, source),
            observedAt(upstream.headers.get('date')),
          ),
        ),
        failure: { kind: 'no-runs', upstreamStatus: upstream.status },
      }
    }
    const signal: PipelineStatus = {
      type: 'pipeline-status',
      status: normalizeStatus(build.status, build.result),
      rawStatus: build.result ?? build.status ?? 'unknown',
      name: build.buildNumber,
      ...((build.sourceBranch ?? source.branch)
        ? { branch: build.sourceBranch ?? source.branch }
        : {}),
      ...(timestamp(build.startTime) ? { runStartedAt: timestamp(build.startTime) } : {}),
      ...(timestamp(build.lastChangedDate)
        ? { sourceUpdatedAt: timestamp(build.lastChangedDate) }
        : {}),
      sourceRunId: String(build.id),
      ...completedBuildDuration(build),
    }
    if (signal.status === 'running') {
      const activity = await activeAzureDevOpsActivity({
        buildId: build.id,
        source,
        fetcher: args.fetcher,
        authorization: call.headers.get('authorization') ?? '',
      })
      if (activity) signal.activity = activity
    }
    return {
      envelope: {
        panelId: panel.id,
        state: 'ok',
        observedAt: observedAt(upstream.headers.get('date')),
        link: buildLink(build.id, source),
        signal,
      },
      response: upstream,
    }
  } catch (error) {
    return {
      response: errorResponse(
        errorEnvelope(
          panel.id,
          'upstream-error',
          error,
          sourceLink(panel.pipeline, source),
          observedAt(upstream.headers.get('date')),
        ),
      ),
      failure: { kind: 'upstream-error', upstreamStatus: upstream.status },
    }
  }
}

const delegatedTokenFileSchema = z.object({
  accessToken: z.string().min(1),
  expiresAt: z.string().min(1),
})

/**
 * Resolves ADO authentication for one request. The delegated file is intentionally read each
 * time: a host-side broker can replace its short-lived token without restarting this process.
 * Every failure is deliberately indistinguishable to the panel; paths and token details are local
 * credential material, not useful dashboard evidence.
 */
async function azureDevOpsAuthorization(
  source: AzureDevOpsSource,
  credentials: CredentialResolver,
): Promise<string | undefined> {
  if (source.token_env) {
    const token = credentials.get(source.token_env)
    return token ? `Basic ${btoa(`:${token}`)}` : undefined
  }
  if (!source.entra_token_file_env) return undefined
  const tokenFile = credentials.get(source.entra_token_file_env)
  if (!tokenFile) return undefined

  try {
    const token = delegatedTokenFileSchema.parse(JSON.parse(await readFile(tokenFile, 'utf8')))
    const expiresAt = Date.parse(token.expiresAt)
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return undefined
    return `Bearer ${token.accessToken}`
  } catch {
    return undefined
  }
}

function buildsCall(definitionId: number, source: AzureDevOpsSource): PermittedCall {
  const url = apiUrl(source, 'build/builds')
  url.searchParams.set('definitions', String(definitionId))
  if (source.branch) url.searchParams.set('branchName', adoBranch(source.branch))
  // Queue time keeps a currently-running newest build ahead of its last completed predecessor.
  url.searchParams.set('queryOrder', 'queueTimeDescending')
  url.searchParams.set('$top', '1')
  return { url: url.toString(), headers: new Headers({ accept: 'application/json' }) }
}

function timelineCall(buildId: number, source: AzureDevOpsSource): PermittedCall {
  return {
    url: apiUrl(source, `build/builds/${buildId}/timeline`).toString(),
    headers: new Headers({ accept: 'application/json' }),
  }
}

function apiUrl(source: AzureDevOpsSource, suffix: string): URL {
  const url = new URL(
    `https://dev.azure.com/${encodeURIComponent(source.organization)}/${encodeURIComponent(source.project)}/_apis/${suffix}`,
  )
  url.searchParams.set('api-version', '7.1')
  return url
}

function adoBranch(branch: string): string {
  return branch.startsWith('refs/') ? branch : `refs/heads/${branch}`
}

async function activeAzureDevOpsActivity(args: {
  buildId: number
  source: AzureDevOpsSource
  fetcher: typeof fetch
  authorization: string
}): Promise<PipelineStatus['activity']> {
  const call = timelineCall(args.buildId, args.source)
  call.headers.set('authorization', args.authorization)
  try {
    const response = await args.fetcher(call.url, { headers: call.headers })
    if (!response.ok) return undefined
    const records = timelineSchema.parse(await response.json()).records
    const active = records.find((record) => record.state === 'inProgress')
    if (!active) return undefined
    const parent = active.parentId
      ? records.find((record) => record.id === active.parentId)
      : undefined
    const kind = active.type.toLowerCase()
    return {
      kind: kind === 'stage' ? 'stage' : kind === 'job' ? 'job' : 'step',
      name: active.name,
      ...(parent ? { parent: parent.name } : {}),
    }
  } catch {
    return undefined
  }
}

function normalizeStatus(
  status: string | null | undefined,
  result: string | null | undefined,
): PipelineStatus['status'] {
  if (
    status === 'notStarted' ||
    status === 'postponed' ||
    status === 'inProgress' ||
    status === 'cancelling'
  )
    return 'running'
  if (status !== 'completed') return 'unknown'
  if (result === 'succeeded') return 'passed'
  if (result === 'failed') return 'failed'
  if (result === 'partiallySucceeded') return 'warning'
  if (result === 'canceled') return 'cancelled'
  return 'unknown'
}

function completedBuildDuration(
  build: z.infer<typeof buildSchema>,
): Pick<PipelineStatus, 'durationMs'> {
  const startedAt = timestamp(build.startTime)
  const finishedAt = timestamp(build.finishTime)
  if (!startedAt || !finishedAt) return {}
  const durationMs = new Date(finishedAt).valueOf() - new Date(startedAt).valueOf()
  return Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}
}

function timestamp(value: string | null | undefined): string | undefined {
  if (!value || !z.iso.datetime().safeParse(value).success) return undefined
  return Number.isFinite(new Date(value).valueOf()) ? value : undefined
}

function copyValidators(requestHeaders: Headers, upstreamHeaders: Headers) {
  forwardValidators(requestHeaders, upstreamHeaders)
}

function buildLink(buildId: number, source: AzureDevOpsSource): string {
  return `https://dev.azure.com/${encodeURIComponent(source.organization)}/${encodeURIComponent(source.project)}/_build/results?buildId=${buildId}`
}

function sourceLink(definitionId: number, source: AzureDevOpsSource): string {
  return `https://dev.azure.com/${encodeURIComponent(source.organization)}/${encodeURIComponent(source.project)}/_build?definitionId=${definitionId}`
}

function errorResponse(envelope: Envelope): Response {
  return upstreamErrorResponse(envelope)
}

function errorEnvelope(
  panelId: string,
  kind: Extract<
    ErrorKind,
    'unreachable' | 'unauthorized' | 'not-found' | 'no-runs' | 'upstream-error'
  >,
  error: unknown,
  link: string,
  date?: string,
): Envelope {
  return upstreamErrorEnvelope({ panelId, kind, error, link, upstreamDate: date })
}

function errorKind(
  status: number,
): Extract<ErrorKind, 'unauthorized' | 'not-found' | 'upstream-error'> {
  return upstreamErrorKind(status)
}

function observedAt(value: string | null): string {
  return upstreamObservedAt(value)
}
