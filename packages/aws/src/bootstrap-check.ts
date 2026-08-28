import {
  type BootstrapConfig,
  type BootstrapConsistency,
  type BootstrapKind,
  bootstrapConsistency,
  bootstrapPlan,
} from './bootstrap.js'
import {
  type BootstrapRemediation,
  bootstrapRemediation,
  formatBootstrapRemediationText,
} from './remediation.js'

export type BootstrapResourceDifference = {
  path?: string
  differenceType?: string
  expectedValue?: string
  actualValue?: string
}

export type BootstrapResourceDrift = {
  logicalId: string
  resourceType?: string
  status?: string
  differences: BootstrapResourceDifference[]
}

export type BootstrapResourceDriftResult = {
  ok: boolean
  status: string
  detectionId?: string
  reason?: string
  resources: BootstrapResourceDrift[]
}

export type BootstrapStackCheck = {
  kind: BootstrapKind
  stackName: string
  stackStatus?: string
  contractVersion: string
  templateRevision?: string
  templateSha256: string
  consistency: BootstrapConsistency
  resourceDrift?: BootstrapResourceDriftResult
}

export type BootstrapCheck = {
  ok: boolean
  packageVersion: string
  stacks: BootstrapStackCheck[]
  remediation: BootstrapRemediation
}

export type BootstrapCheckDependencies = {
  execute(command: string, args: string[]): Promise<string>
  sleep?(milliseconds: number): Promise<void>
  now?(): number
}

export function formatBootstrapCheckText(result: BootstrapCheck): string {
  const lines = [`AWS bootstrap consistency (${result.packageVersion})`]
  for (const stack of result.stacks) {
    lines.push(
      `${stack.consistency.ok && (!stack.resourceDrift || stack.resourceDrift.ok) ? 'PASS' : 'FAIL'} ${stack.kind}: ${stack.stackName} (${stack.stackStatus ?? 'unavailable'})`,
      `  template: contract ${stack.contractVersion}, revision ${stack.templateRevision ?? 'none'}, sha256 ${stack.templateSha256}`,
    )
    for (const mismatch of stack.consistency.mismatches) lines.push(`  mismatch: ${mismatch}`)
    if (!stack.resourceDrift) continue
    lines.push(`  resource drift: ${stack.resourceDrift.status}`)
    if (stack.resourceDrift.reason) lines.push(`  drift error: ${stack.resourceDrift.reason}`)
    for (const resource of stack.resourceDrift.resources) {
      lines.push(
        `  drifted resource: ${resource.logicalId} (${resource.resourceType ?? 'unknown'}, ${resource.status ?? 'unknown'})`,
      )
      for (const difference of resource.differences)
        lines.push(
          `    ${difference.path ?? 'unknown property'}: ${difference.differenceType ?? 'changed'}; expected ${difference.expectedValue ?? 'unknown'}, actual ${difference.actualValue ?? 'unknown'}`,
        )
    }
  }
  lines.push('', ...formatBootstrapRemediationText(result.remediation))
  return `${lines.join('\n')}\n`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function parseJson(raw: string, operation: string): Record<string, unknown> {
  try {
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('response is not an object')
    return value as Record<string, unknown>
  } catch (error) {
    throw new Error(`${operation} returned invalid JSON: ${message(error)}`)
  }
}

function stackFrom(response: Record<string, unknown>): Record<string, unknown> | undefined {
  const stacks = response.Stacks
  return Array.isArray(stacks) && stacks[0] && typeof stacks[0] === 'object'
    ? (stacks[0] as Record<string, unknown>)
    : undefined
}

function outputs(stack: Record<string, unknown> | undefined): Record<string, string | undefined> {
  const entries = stack?.Outputs
  if (!Array.isArray(entries)) return {}
  return Object.fromEntries(
    entries
      .filter((entry): entry is { OutputKey: string; OutputValue?: string } =>
        Boolean(entry && typeof entry === 'object' && typeof entry.OutputKey === 'string'),
      )
      .map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]),
  )
}

async function resourceDrift(
  stackName: string,
  region: string,
  dependencies: BootstrapCheckDependencies,
): Promise<BootstrapResourceDriftResult> {
  try {
    const detected = parseJson(
      await dependencies.execute('aws', [
        'cloudformation',
        'detect-stack-drift',
        '--stack-name',
        stackName,
        '--region',
        region,
        '--output',
        'json',
        '--no-cli-pager',
      ]),
      'detect-stack-drift',
    )
    const detectionId = detected.StackDriftDetectionId
    if (typeof detectionId !== 'string')
      throw new Error('detect-stack-drift returned no StackDriftDetectionId')
    const now = dependencies.now ?? Date.now
    const sleep =
      dependencies.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    const deadline = now() + 10 * 60 * 1000
    let status: Record<string, unknown>
    while (true) {
      status = parseJson(
        await dependencies.execute('aws', [
          'cloudformation',
          'describe-stack-drift-detection-status',
          '--stack-drift-detection-id',
          detectionId,
          '--region',
          region,
          '--output',
          'json',
          '--no-cli-pager',
        ]),
        'describe-stack-drift-detection-status',
      )
      if (status.DetectionStatus !== 'DETECTION_IN_PROGRESS') break
      if (now() >= deadline)
        return {
          ok: false,
          status: 'TIMED_OUT',
          detectionId,
          reason: 'CloudFormation drift detection did not complete within 10 minutes',
          resources: [],
        }
      await sleep(5_000)
    }
    if (status.DetectionStatus !== 'DETECTION_COMPLETE')
      return {
        ok: false,
        status: String(status.DetectionStatus ?? 'UNKNOWN'),
        detectionId,
        reason:
          typeof status.DetectionStatusReason === 'string'
            ? status.DetectionStatusReason
            : 'CloudFormation drift detection failed',
        resources: [],
      }
    const stackDriftStatus = String(status.StackDriftStatus ?? 'UNKNOWN')
    if (stackDriftStatus !== 'DRIFTED')
      return {
        ok: stackDriftStatus === 'IN_SYNC',
        status: stackDriftStatus,
        detectionId,
        resources: [],
      }
    const described = parseJson(
      await dependencies.execute('aws', [
        'cloudformation',
        'describe-stack-resource-drifts',
        '--stack-name',
        stackName,
        '--stack-resource-drift-status-filters',
        'MODIFIED',
        'DELETED',
        '--region',
        region,
        '--output',
        'json',
        '--no-cli-pager',
      ]),
      'describe-stack-resource-drifts',
    )
    const resources = Array.isArray(described.StackResourceDrifts)
      ? described.StackResourceDrifts.flatMap((entry): BootstrapResourceDrift[] => {
          if (!entry || typeof entry !== 'object') return []
          const drift = entry as Record<string, unknown>
          if (typeof drift.LogicalResourceId !== 'string') return []
          const differences = Array.isArray(drift.PropertyDifferences)
            ? drift.PropertyDifferences.flatMap((item): BootstrapResourceDifference[] => {
                if (!item || typeof item !== 'object') return []
                const difference = item as Record<string, unknown>
                return [
                  {
                    ...(typeof difference.PropertyPath === 'string'
                      ? { path: difference.PropertyPath }
                      : {}),
                    ...(typeof difference.DifferenceType === 'string'
                      ? { differenceType: difference.DifferenceType }
                      : {}),
                    ...(typeof difference.ExpectedValue === 'string'
                      ? { expectedValue: difference.ExpectedValue }
                      : {}),
                    ...(typeof difference.ActualValue === 'string'
                      ? { actualValue: difference.ActualValue }
                      : {}),
                  },
                ]
              })
            : []
          return [
            {
              logicalId: drift.LogicalResourceId,
              ...(typeof drift.ResourceType === 'string'
                ? { resourceType: drift.ResourceType }
                : {}),
              ...(typeof drift.StackResourceDriftStatus === 'string'
                ? { status: drift.StackResourceDriftStatus }
                : {}),
              differences,
            },
          ]
        })
      : []
    return { ok: false, status: stackDriftStatus, detectionId, resources }
  } catch (error) {
    return { ok: false, status: 'ERROR', reason: message(error), resources: [] }
  }
}

/** Runs the explicitly named live bootstrap diagnostic; it never changes stack resources. */
export async function checkBootstrap(
  config: BootstrapConfig,
  options: { resourceDrift?: boolean },
  dependencies: BootstrapCheckDependencies,
): Promise<BootstrapCheck> {
  const requiredManifestValues: Array<[string, string | undefined]> = [
    ['region', config.region],
    ['core.stackName', config.core?.stackName],
    ['core.artifactBucketName', config.core?.artifactBucketName],
    ['core.applicationStackName', config.core?.applicationStackName],
    ['core.dashboardFunctionName', config.core?.dashboardFunctionName],
    ['githubOidc.stackName', config.githubOidc?.stackName],
    ['githubOidc.providerArn', config.githubOidc?.providerArn],
    ['githubOidc.repository', config.githubOidc?.repository],
    ['githubOidc.ownerId', config.githubOidc?.ownerId],
    ['githubOidc.repositoryId', config.githubOidc?.repositoryId],
    ['githubOidc.environment', config.githubOidc?.environment],
  ]
  const missing = requiredManifestValues.filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error(`Bootstrap manifest is missing: ${missing.join(', ')}`)
  const stackNames: Record<BootstrapKind, string | undefined> = {
    core: config.core?.stackName,
    'github-oidc': config.githubOidc?.stackName,
  }
  const plan = await bootstrapPlan(config)
  const responses = await Promise.all(
    (['core', 'github-oidc'] as BootstrapKind[]).map(async (kind) => {
      const stackName = stackNames[kind] as string
      try {
        const response = parseJson(
          await dependencies.execute('aws', [
            'cloudformation',
            'describe-stacks',
            '--stack-name',
            stackName,
            '--region',
            config.region as string,
            '--output',
            'json',
            '--no-cli-pager',
          ]),
          'describe-stacks',
        )
        return { kind, stackName, response }
      } catch (error) {
        return { kind, stackName, error: message(error) }
      }
    }),
  )
  const coreResponse = responses.find(({ kind }) => kind === 'core')?.response
  const coreOutputValues = outputs(stackFrom(coreResponse ?? {}))
  const stacks = await Promise.all(
    responses.map(async ({ kind, stackName, response, error }): Promise<BootstrapStackCheck> => {
      const template = plan.packageTemplates.find((candidate) => candidate.kind === kind)
      if (!template) throw new Error(`Installed package has no ${kind} bootstrap template`)
      const stack = stackFrom(response ?? {})
      const consistency = error
        ? { ok: false, mismatches: [`unable to describe stack: ${error}`] }
        : bootstrapConsistency(
            kind,
            config,
            response,
            template.contractVersion,
            template.templateRevision,
            coreOutputValues,
          )
      const checked: BootstrapStackCheck = {
        kind,
        stackName,
        ...(typeof stack?.StackStatus === 'string' ? { stackStatus: stack.StackStatus } : {}),
        contractVersion: template.contractVersion,
        templateRevision: template.templateRevision,
        templateSha256: template.sha256,
        consistency,
      }
      if (options.resourceDrift && !error)
        checked.resourceDrift = await resourceDrift(
          stackName,
          config.region as string,
          dependencies,
        )
      return checked
    }),
  )
  const failed = stacks.filter(
    ({ consistency, resourceDrift }) =>
      !consistency.ok || Boolean(resourceDrift && !resourceDrift.ok),
  )
  return {
    ok: stacks.every(
      ({ consistency, resourceDrift: drift }) => consistency.ok && (!drift || drift.ok),
    ),
    packageVersion: plan.packageVersion,
    stacks,
    remediation: bootstrapRemediation(config, {
      summary: failed.length
        ? `Bootstrap validation failed for ${failed.length} stack${failed.length === 1 ? '' : 's'}.`
        : 'Bootstrap stacks are consistent and ready for the deployment check.',
      affectedStacks: (failed.length ? failed : stacks).map(
        ({ kind, stackName, consistency, resourceDrift }) => ({
          kind,
          stackName,
          ...(!consistency.ok
            ? { issue: consistency.mismatches[0] ?? 'consistency mismatch' }
            : resourceDrift && !resourceDrift.ok
              ? { issue: `resource drift: ${resourceDrift.status}` }
              : {}),
        }),
      ),
      nextOperation: failed.length
        ? 'Apply only reviewed administrator-approved bootstrap updates, then capture both stacks again.'
        : 'Run the deployment or release check that consumes these bootstrap outputs.',
      issues: failed.flatMap(({ consistency, resourceDrift }) => [
        ...consistency.mismatches,
        ...(resourceDrift && !resourceDrift.ok ? [`resource drift: ${resourceDrift.status}`] : []),
      ]),
    }),
  }
}
