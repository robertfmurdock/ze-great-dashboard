import type {
  ErrorKind,
  GithubActionsSource,
  TestCount,
  TestEvidence,
  TestResultsArtifact,
} from '@ze-great-dashboard/shared'
import { retryAfterTime } from '@ze-great-dashboard/shared'
import { z } from 'zod'
import { GithubAuthenticationError, type GithubClient } from '../github-auth.ts'
import { observedAt, publicErrorMessage, upstreamErrorKind } from '../upstream.ts'
import { readTestResultsArtifact, testResultsSummarySchema } from '../workflow-artifact-summary.ts'

export type GithubTestRun = {
  id?: number
  run_attempt?: number
  head_sha?: string
  status: string
  updated_at?: string
}
type ReportedTests = Extract<TestCount, { status: 'reported' }>
export type TestArtifactFailure = {
  kind: 'failed'
  observedAt: string
  errorKind: ErrorKind
  httpStatus?: number
  retryAt?: string
}
export type TestArtifactInspection =
  | { kind: 'reported'; observedAt: string; tests: ReportedTests }
  | { kind: 'pending' | 'absent' | 'expired'; observedAt: string }
  | TestArtifactFailure
const artifactsSchema = z.object({
  artifacts: z.array(
    z.object({ id: z.number().int().positive(), name: z.string().min(1), expired: z.boolean() }),
  ),
})

export function testArtifactHttpFailure(response: Response): TestArtifactFailure {
  const retry = retryAfterTime(response.headers.get('retry-after'), Date.now())
  return {
    kind: 'failed',
    observedAt: observedAt(response.headers.get('date')),
    errorKind: upstreamErrorKind(response.status),
    httpStatus: response.status,
    ...(retry === undefined ? {} : { retryAt: new Date(retry).toISOString() }),
  }
}

/** Provider inspection has explicit outcomes; display and history own their respective policies. */
export async function inspectGithubTestArtifact(
  args: { source: GithubActionsSource; githubClient: GithubClient; fetcher: typeof fetch },
  selected: { run: GithubTestRun; observedAt: string },
  config: TestResultsArtifact,
): Promise<TestArtifactInspection> {
  const { run } = selected
  let at = selected.observedAt
  const failed = (errorKind: ErrorKind): TestArtifactFailure => ({
    kind: 'failed',
    observedAt: at,
    errorKind,
  })
  const get = (url: string) =>
    args.githubClient.get({
      source: args.source,
      fetcher: args.fetcher,
      url,
      requestHeaders: new Headers(),
    })
  const observe = (response: Response) => {
    const value = observedAt(response.headers.get('date'))
    if (Date.parse(value) < Date.parse(at)) at = value
  }
  try {
    if (!run.id) return failed('upstream-error')
    if (run.status !== 'completed') return { kind: 'pending', observedAt: at }
    const url = new URL(
      `https://api.github.com/repos/${args.source.repo}/actions/runs/${run.id}/artifacts`,
    )
    url.searchParams.set('name', config.artifact)
    url.searchParams.set('per_page', '100')
    const artifacts = await get(url.toString())
    if (!artifacts.ok) return testArtifactHttpFailure(artifacts)
    observe(artifacts)
    const matches = artifactsSchema
      .parse(await artifacts.json())
      .artifacts.filter((item) => item.name === config.artifact)
    if (!matches.length) return { kind: 'absent', observedAt: at }
    const [artifact] = matches
    if (matches.length !== 1 || !artifact) return failed('upstream-error')
    if (artifact.expired) return { kind: 'expired', observedAt: at }
    const archive = await get(
      `https://api.github.com/repos/${args.source.repo}/actions/artifacts/${artifact.id}/zip`,
    )
    if (!archive.ok) return testArtifactHttpFailure(archive)
    observe(archive)
    const summary = testResultsSummarySchema.parse(
      JSON.parse(await readTestResultsArtifact(archive, config.entry)),
    )
    if (
      summary.runId !== run.id ||
      summary.runAttempt !== run.run_attempt ||
      summary.headSha !== run.head_sha
    )
      return failed('upstream-error')
    const updatedAt = z.iso.datetime().safeParse(run.updated_at)
    const tests: ReportedTests = {
      type: 'test-count',
      status: 'reported',
      total: summary.total,
      ...(updatedAt.success
        ? { run: { id: String(run.id), attempt: summary.runAttempt, updatedAt: updatedAt.data } }
        : {}),
      ...(summary.passed === undefined ? {} : { passed: summary.passed }),
      ...(summary.failed === undefined ? {} : { failed: summary.failed }),
      ...(summary.skipped === undefined ? {} : { skipped: summary.skipped }),
    }
    return { kind: 'reported', observedAt: at, tests }
  } catch (error) {
    return failed(error instanceof GithubAuthenticationError ? 'unauthorized' : 'upstream-error')
  }
}

export function currentTestEvidence(inspection: TestArtifactInspection): TestEvidence {
  const { observedAt: at } = inspection
  switch (inspection.kind) {
    case 'reported':
      return { state: 'ok', observedAt: at, signal: inspection.tests }
    case 'pending':
      return { state: 'ok', observedAt: at, signal: { type: 'test-count', status: 'pending' } }
    case 'absent':
      return { state: 'ok', observedAt: at, signal: { type: 'test-count', status: 'not-reported' } }
    case 'expired':
      return {
        state: 'error',
        observedAt: at,
        error: { kind: 'upstream-error', message: publicErrorMessage('upstream-error') },
      }
    case 'failed':
      return {
        state: 'error',
        observedAt: at,
        error: { kind: inspection.errorKind, message: publicErrorMessage(inspection.errorKind) },
      }
  }
}
