import { type BootstrapConfig, bootstrapPlan } from './bootstrap.js'
import {
  type BootstrapProvider,
  bootstrapHandoff,
  type CommandRunner,
  githubOidcProvider,
  verifyBootstrap,
} from './handoff.js'

export type BootstrapCheckStatus = 'ready' | 'missing' | 'mismatch' | 'unverified'
export type BootstrapPreflightCheck = {
  name: string
  status: BootstrapCheckStatus
  detail: string
}
export type BootstrapPreflight = { ready: boolean; checks: BootstrapPreflightCheck[] }

export type BootstrapInitInput = {
  slug: string
  repository: string
  environment: string
  providerArn: string
  region?: string
  accountId?: string
  ownerId?: string
  repositoryId?: string
  consumerGatewayStackName?: string
  runner?: CommandRunner
}

function value(input: unknown, label: string): string {
  if (typeof input !== 'string' || !input.trim()) throw new Error(`${label} is required`)
  return input.trim()
}

function repositoryParts(repository: string): [string, string] {
  const [owner, name, extra] = repository.split('/')
  if (!owner || !name || extra) throw new Error('repository must be owner/repository')
  return [owner, name]
}

function accountFromArn(arn: string): string | undefined {
  return arn.match(/^arn:[^:]+:iam::(\d+):oidc-provider\//)?.[1]
}

async function optional(runner: CommandRunner | undefined, command: string, args: string[]) {
  if (!runner) return undefined
  try {
    return await runner.execute(command, args)
  } catch {
    return undefined
  }
}

async function discovered(input: BootstrapInitInput) {
  const identity = await optional(input.runner, 'aws', [
    'sts',
    'get-caller-identity',
    '--output',
    'json',
  ])
  const aws = (parseOrUnavailable(identity) as { Account?: unknown } | undefined) ?? {}
  const accountId = typeof aws.Account === 'string' ? aws.Account : undefined
  const region = await optional(input.runner, 'aws', ['configure', 'get', 'region'])
  const repo = await optional(input.runner, 'gh', ['api', `repos/${input.repository}`])
  const github =
    (parseOrUnavailable(repo) as { id?: unknown; owner?: { id?: unknown } } | undefined) ?? {}
  return {
    accountId,
    region: region?.trim() || undefined,
    ownerId:
      typeof github.owner?.id === 'number' || typeof github.owner?.id === 'string'
        ? String(github.owner.id)
        : undefined,
    repositoryId:
      typeof github.id === 'number' || typeof github.id === 'string'
        ? String(github.id)
        : undefined,
  }
}

/** Creates the non-secret manifest data; callers control where (and whether) it is written. */
export async function scaffoldBootstrapManifest(
  input: BootstrapInitInput,
): Promise<BootstrapConfig> {
  const slug = value(input.slug, 'slug')
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slug))
    throw new Error('slug must use lowercase letters, digits, and hyphens')
  const repository = value(input.repository, 'repository')
  repositoryParts(repository)
  const environment = value(input.environment, 'environment')
  const providerArn = value(input.providerArn, 'github OIDC provider ARN')
  if (!accountFromArn(providerArn)) throw new Error('github OIDC provider ARN is invalid')
  const found = await discovered(input)
  const accountId = input.accountId ?? found.accountId
  const region = input.region ?? found.region
  const ownerId = input.ownerId ?? found.ownerId
  const repositoryId = input.repositoryId ?? found.repositoryId
  if (!accountId) throw new Error('--account-id is required when AWS identity is unavailable')
  if (!region) throw new Error('--region is required when AWS Region is unavailable')
  if (!ownerId) throw new Error('--github-owner-id is required when GitHub is unavailable')
  if (!repositoryId)
    throw new Error('--github-repository-id is required when GitHub is unavailable')
  return {
    region,
    core: {
      stackName: `${slug}-bootstrap`,
      artifactBucketName: `${slug}-lambda-artifacts-${accountId}`,
      applicationStackName: slug,
      dashboardFunctionName: slug,
    },
    githubOidc: {
      stackName: `${slug}-github-bootstrap`,
      providerArn,
      repository,
      ownerId,
      repositoryId,
      environment,
      ...(input.consumerGatewayStackName
        ? { consumerGatewayStackName: input.consumerGatewayStackName }
        : {}),
    },
  }
}

function incomplete(config: BootstrapConfig): string[] {
  const fields: Array<[string, unknown]> = [
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
  return fields.filter(([, v]) => typeof v !== 'string' || !v).map(([name]) => name)
}

function parseOrUnavailable(raw: string | undefined): unknown | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw)
  } catch {
    return undefined
  }
}
function absent(raw: string | undefined): boolean {
  return /not found|nosuchentity|404/i.test(raw ?? '')
}

/** Runs only named read-only discovery checks. Network/auth failures remain usable offline. */
export async function bootstrapPreflight(input: {
  config: BootstrapConfig
  runner?: CommandRunner
  provider?: BootstrapProvider
}): Promise<BootstrapPreflight> {
  const checks: BootstrapPreflightCheck[] = []
  const missing = incomplete(input.config)
  checks.push(
    missing.length
      ? { name: 'manifest', status: 'missing', detail: `Missing: ${missing.join(', ')}` }
      : { name: 'manifest', status: 'ready', detail: 'Manifest has all bootstrap fields.' },
  )
  if (missing.length) return { ready: false, checks }
  const runner = input.runner
  const identityRaw = await optional(runner, 'aws', [
    'sts',
    'get-caller-identity',
    '--output',
    'json',
  ])
  const identity = parseOrUnavailable(identityRaw) as { Account?: unknown } | undefined
  const providerAccount = accountFromArn(input.config.githubOidc?.providerArn ?? '')
  if (!identity || typeof identity.Account !== 'string')
    checks.push({
      name: 'aws-identity',
      status: 'unverified',
      detail: 'AWS identity could not be read.',
    })
  else
    checks.push(
      identity.Account === providerAccount
        ? {
            name: 'aws-identity',
            status: 'ready',
            detail: `AWS account ${identity.Account} matches the provider ARN.`,
          }
        : {
            name: 'aws-identity',
            status: 'mismatch',
            detail: `AWS account ${identity.Account} does not match provider account ${providerAccount}.`,
          },
    )
  const regionRaw = await optional(runner, 'aws', ['configure', 'get', 'region'])
  if (!regionRaw?.trim())
    checks.push({
      name: 'aws-region',
      status: 'unverified',
      detail: 'AWS Region could not be read.',
    })
  else
    checks.push(
      regionRaw.trim() === input.config.region
        ? { name: 'aws-region', status: 'ready', detail: `AWS Region is ${input.config.region}.` }
        : {
            name: 'aws-region',
            status: 'mismatch',
            detail: `AWS Region ${regionRaw.trim()} does not match manifest ${input.config.region}.`,
          },
    )
  const providerRaw = await optional(runner, 'aws', [
    'iam',
    'get-open-id-connect-provider',
    '--open-id-connect-provider-arn',
    input.config.githubOidc?.providerArn ?? '',
  ])
  checks.push(
    !providerRaw
      ? {
          name: 'oidc-provider',
          status: 'unverified',
          detail: 'OIDC provider could not be queried.',
        }
      : absent(providerRaw)
        ? { name: 'oidc-provider', status: 'missing', detail: 'OIDC provider does not exist.' }
        : { name: 'oidc-provider', status: 'ready', detail: 'OIDC provider exists.' },
  )
  const repository = input.config.githubOidc?.repository ?? ''
  const repoRaw = await optional(runner, 'gh', ['api', `repos/${repository}`])
  const repo = parseOrUnavailable(repoRaw) as { id?: unknown; owner?: { id?: unknown } } | undefined
  if (!repoRaw)
    checks.push({
      name: 'github-repository',
      status: 'unverified',
      detail: 'GitHub repository could not be queried.',
    })
  else if (absent(repoRaw))
    checks.push({
      name: 'github-repository',
      status: 'missing',
      detail: 'GitHub repository does not exist or is unavailable.',
    })
  else if (
    String(repo?.id) !== input.config.githubOidc?.repositoryId ||
    String(repo?.owner?.id) !== input.config.githubOidc?.ownerId
  )
    checks.push({
      name: 'github-repository',
      status: 'mismatch',
      detail: 'GitHub numeric repository identity does not match the manifest.',
    })
  else
    checks.push({
      name: 'github-repository',
      status: 'ready',
      detail: 'GitHub repository identity matches the manifest.',
    })
  const environmentRaw = await optional(runner, 'gh', [
    'api',
    `repos/${repository}/environments/${input.config.githubOidc?.environment}`,
  ])
  checks.push(
    !environmentRaw
      ? {
          name: 'github-environment',
          status: 'unverified',
          detail: 'GitHub Environment could not be queried.',
        }
      : absent(environmentRaw)
        ? {
            name: 'github-environment',
            status: 'missing',
            detail: 'GitHub Environment does not exist.',
          }
        : {
            name: 'github-environment',
            status: 'ready',
            detail: 'GitHub Environment exists; its policy is administrator-owned context.',
          },
  )
  const subject = await (input.provider ?? githubOidcProvider).prerequisite(input.config, runner)
  checks.push({
    name: 'immutable-subject',
    status: subject.status === 'immutable-subject-required' ? 'mismatch' : subject.status,
    detail: subject.detail,
  })
  return {
    ready: !checks.some(({ status }) => status === 'missing' || status === 'mismatch'),
    checks,
  }
}

function quote(args: string[]): string {
  return args.map((arg) => `'${arg.replaceAll("'", "'\\\"'\\\"'")}'`).join(' ')
}

export async function bootstrapGuide(
  input: Parameters<typeof bootstrapHandoff>[0],
): Promise<string> {
  const handoff = await bootstrapHandoff(input)
  const plan = await bootstrapPlan(input.config)
  const lines = [
    `Phase: ${handoff.phase}`,
    `Package version: ${plan.packageVersion}`,
    ...plan.packageTemplates.map(
      (template) =>
        `Template ${template.kind}: contract ${template.contractVersion}${template.templateRevision ? `, revision ${template.templateRevision}` : ''}, sha256 ${template.sha256}`,
    ),
    `Required captures: ${handoff.requiredCapturedFiles.join(', ') || 'none'}`,
  ]
  if (handoff.expectedOutputs.length)
    lines.push(`Expected outputs: ${handoff.expectedOutputs.join(', ')}`)
  if (handoff.prerequisite)
    lines.push(`Prerequisite: ${handoff.prerequisite.status} — ${handoff.prerequisite.detail}`)
  lines.push('', 'Commands (copy and run each AWS command yourself):')
  for (const command of handoff.commands) {
    if (command.name === 'review-change-set')
      lines.push('PAUSE: review the change set before approval.')
    if (command.name === 'execute-reviewed-change-set')
      lines.push('PAUSE: execute only after explicit approval.')
    lines.push(
      command.captureFile
        ? `${quote(command.args)} > ${quote([command.captureFile])}`
        : quote(command.args),
    )
  }
  if (handoff.reviewCheckpoints.length)
    lines.push('', 'Review pauses:', ...handoff.reviewCheckpoints.map((item) => `- ${item}`))
  if (input.coreStack !== undefined && input.githubOidcStack !== undefined) {
    const verified = await verifyBootstrap({
      config: input.config,
      coreStack: input.coreStack,
      githubOidcStack: input.githubOidcStack,
    })
    lines.push(
      '',
      'Optional GitHub administrator action (after the successful verification above):',
    )
    for (const command of verified.githubEnvironmentInstructions) lines.push(quote(command))
  }
  return `${lines.join('\n')}\n`
}
