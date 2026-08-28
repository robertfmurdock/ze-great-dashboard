import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { type ComputeMode, computeMode, resolveComputeMode } from './compute-mode.js'
import { sha256 } from './release.ts'
import { type BootstrapRemediation, bootstrapRemediation } from './remediation.js'

export { type ComputeMode, computeMode, resolveComputeMode } from './compute-mode.js'

export type BootstrapKind = 'core' | 'github-oidc'
export type CloudFormationParameterValue = {
  ParameterKey: string
  ParameterValue: string
  UsePreviousValue?: boolean
}

export type DeployedBootstrapStack = {
  StackName?: string
  StackId?: string
  StackStatus?: string
  Parameters?: CloudFormationParameterValue[]
  Outputs?: { OutputKey: string; OutputValue?: string }[]
}

export type BootstrapConfig = {
  desiredState?: BootstrapDesiredState
  /** Omitted in older manifests; Lambda is the compatibility default. */
  mode?: ComputeMode
  region?: string
  core?: {
    stackName?: string
    artifactBucketName?: string
    applicationStackName?: string
    dashboardFunctionName?: string
    runtimeSecretArn?: string
    artifactKmsKeyArn?: string
  }
  githubOidc?: {
    stackName?: string
    providerArn?: string
    repository?: string
    ownerId?: string
    repositoryId?: string
    environment?: string
    consumerGatewayStackName?: string
  }
}

export type BootstrapDesiredState = {
  packageVersion: string
  templates: {
    core: { contractVersion: string; templateRevision: string }
    githubOidc: { contractVersion: string; templateRevision: string }
  }
}

export type BootstrapTemplateInspection = {
  kind: BootstrapKind
  path: string
  contractVersion: string
  templateRevision?: string
  sha256: string
  resources: { logicalId: string; type: string }[]
  iamActions: string[]
}

export type BootstrapPlan = {
  packageVersion: string
  packageTemplates: BootstrapTemplateInspection[]
  configuration: BootstrapConfig
  desiredState: BootstrapDesiredStateComparison
  notes: string[]
  remediation: BootstrapRemediation
}

export type BootstrapDesiredStateComparison = {
  manifest?: BootstrapDesiredState
  installed: BootstrapDesiredState
  matches: boolean
  packageVersionMatches: boolean
  ok: boolean
  mismatches: string[]
}

export type BootstrapConsistency = { ok: boolean; mismatches: string[] }

const templates: Record<BootstrapKind, Record<ComputeMode, string>> = {
  core: {
    lambda: '../bootstrap/core-v1.yml',
    ecs: '../bootstrap/core-ecs-v1.yml',
  },
  'github-oidc': {
    lambda: '../bootstrap/github-oidc-v2.yml',
    ecs: '../bootstrap/github-oidc-ecs-v1.yml',
  },
}

export function requireComputeMode(
  persisted: Pick<BootstrapConfig, 'mode'>,
  explicit?: string,
): ComputeMode {
  return resolveComputeMode({ persisted: persisted.mode, explicit })
}

export async function bootstrapTemplatePath(
  kind: BootstrapKind,
  mode: ComputeMode = 'lambda',
): Promise<string> {
  if (!Object.hasOwn(templates, kind)) throw new Error(`Unknown bootstrap template: ${kind}`)
  return fileURLToPath(new URL(templates[kind][mode], import.meta.url))
}

export async function bootstrapTemplate(
  kind: BootstrapKind,
  mode: ComputeMode = 'lambda',
): Promise<string> {
  return readFile(await bootstrapTemplatePath(kind, mode), 'utf8')
}

/** Resolves the package-owned identity intended for a manifest at the selected compute mode. */
export async function installedBootstrapDesiredState(
  config: Pick<BootstrapConfig, 'mode'> = {},
): Promise<BootstrapDesiredState> {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  return desiredStateFromTemplates(
    packageVersion(packageManifest),
    await installedTemplateInspections(computeMode(config)),
  )
}

function packageVersion(packageManifest: { version?: unknown }): string {
  return typeof packageManifest.version === 'string' ? packageManifest.version : 'unknown'
}

function desiredStateFromTemplates(
  version: string,
  packageTemplates: BootstrapTemplateInspection[],
): BootstrapDesiredState {
  const template = (kind: BootstrapKind) => packageTemplates.find((entry) => entry.kind === kind)
  const core = template('core')
  const githubOidc = template('github-oidc')
  if (!core || !githubOidc) throw new Error('Installed package is missing a bootstrap template')
  if (!core.templateRevision || !githubOidc.templateRevision)
    throw new Error('Installed bootstrap template has no template revision')
  return {
    packageVersion: version,
    templates: {
      core: { contractVersion: core.contractVersion, templateRevision: core.templateRevision },
      githubOidc: {
        contractVersion: githubOidc.contractVersion,
        templateRevision: githubOidc.templateRevision,
      },
    },
  }
}

async function installedTemplateInspections(
  mode: ComputeMode,
): Promise<BootstrapTemplateInspection[]> {
  return Promise.all(
    (['core', 'github-oidc'] as BootstrapKind[]).map(async (kind) => {
      const [path, template] = await Promise.all([
        bootstrapTemplatePath(kind, mode),
        bootstrapTemplate(kind, mode),
      ])
      return inspectTemplate(kind, path, template)
    }),
  )
}

export function bootstrapContractVersion(template: string): string {
  const version = template.match(/BootstrapContractVersion:\s*\{\s*Value:\s*'([^']+)'\s*}/)?.[1]
  if (!version) throw new Error('Bootstrap template has no BootstrapContractVersion output')
  return version
}

export function bootstrapTemplateRevision(template: string): string {
  const revision = template.match(/BootstrapTemplateRevision:\s*\{\s*Value:\s*'([^']+)'\s*}/)?.[1]
  if (!revision) throw new Error('Bootstrap template has no BootstrapTemplateRevision output')
  return revision
}

function templateRevisionIfPresent(template: string): string | undefined {
  return template.match(/BootstrapTemplateRevision:\s*\{\s*Value:\s*'([^']+)'\s*}/)?.[1]
}

function inspectTemplate(
  kind: BootstrapKind,
  path: string,
  template: string,
): BootstrapTemplateInspection {
  const resourcesBlock =
    template.match(/^Resources:\n([\s\S]*?)(?=^[A-Za-z][A-Za-z0-9]*:\s*$)/m)?.[1] ?? ''
  const resources = [
    ...resourcesBlock.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]+):\n {4}Type: ([^\n]+)$/gm),
  ].map((match) => ({ logicalId: match[1] as string, type: match[2] as string }))
  const iamActions = [...template.matchAll(/^\s+Action: (?:\[([^\]]+)\]|([^\n]+))$/gm)]
    .flatMap(([, list, scalar]) => (list ?? scalar ?? '').split(',').map((action) => action.trim()))
    .filter(Boolean)
  return {
    kind,
    path,
    contractVersion: bootstrapContractVersion(template),
    templateRevision: templateRevisionIfPresent(template),
    sha256: sha256(template),
    resources,
    iamActions: [...new Set(iamActions)],
  }
}

/** Returns installed templates and a reviewable, non-secret plan without external calls. */
export async function bootstrapPlan(config: BootstrapConfig): Promise<BootstrapPlan> {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  const packageTemplates = await installedTemplateInspections(computeMode(config))
  const installedDesiredState = desiredStateFromTemplates(
    packageVersion(packageManifest),
    packageTemplates,
  )
  const desiredStateMatches =
    Boolean(config.desiredState) &&
    (['core', 'githubOidc'] as const).every((kind) => {
      const manifestTemplate = config.desiredState?.templates[kind]
      const installedTemplate = installedDesiredState.templates[kind]
      return (
        manifestTemplate?.contractVersion === installedTemplate.contractVersion &&
        manifestTemplate?.templateRevision === installedTemplate.templateRevision
      )
    })
  const packageVersionMatches =
    config.desiredState?.packageVersion === installedDesiredState.packageVersion
  return {
    packageVersion: installedDesiredState.packageVersion,
    packageTemplates,
    configuration: config,
    desiredState: {
      ...(config.desiredState ? { manifest: config.desiredState } : {}),
      installed: installedDesiredState,
      matches: desiredStateMatches,
      packageVersionMatches,
      ok: desiredStateMatches,
      mismatches: desiredStateMatches
        ? []
        : ['manifest bootstrap template identity differs from installed package'],
    },
    notes: [
      'Templates are owned by the installed npm package; package.json and package-lock.json pin the source version.',
      'Generated CloudFormation parameter files and describe-stacks captures are deployment artifacts, not source configuration.',
      'This plan performs no AWS or GitHub mutations.',
    ],
    remediation: bootstrapRemediation(config, {
      desiredStateUpdateRequired: !desiredStateMatches,
      nextOperation:
        'Review the installed templates, then run bootstrap preflight before creating a change set.',
    }),
  }
}

function capturedStack(input: unknown): {
  StackName?: string
  StackId?: string
  StackStatus?: string
  Parameters?: CloudFormationParameterValue[]
  Outputs?: { OutputKey: string; OutputValue?: string }[]
} {
  const stack =
    input && typeof input === 'object' && 'Stacks' in input
      ? (input as { Stacks?: unknown[] }).Stacks?.[0]
      : input
  return stack && typeof stack === 'object' ? (stack as ReturnType<typeof capturedStack>) : {}
}

function outputValues(stack: ReturnType<typeof capturedStack>): Record<string, string | undefined> {
  return Object.fromEntries(
    (stack.Outputs ?? []).map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]),
  )
}

/** Compares describe-stacks data with manifest and installed-template values without network access. */
export function bootstrapConsistency(
  kind: BootstrapKind,
  config: BootstrapConfig,
  stackInput: unknown,
  expectedContract: string,
  expectedRevision?: string,
  coreOutputs: Record<string, string | undefined> = {},
): BootstrapConsistency {
  const stack = capturedStack(stackInput)
  const mismatches: string[] = []
  const expectedStackName = kind === 'core' ? config.core?.stackName : config.githubOidc?.stackName
  if (stack.StackName !== expectedStackName)
    mismatches.push(
      `stack name is ${stack.StackName ?? 'missing'}; expected ${expectedStackName ?? 'missing'}`,
    )
  const observedRegion = stack.StackId?.match(/^arn:[^:]+:cloudformation:([^:]+):/)?.[1]
  if (observedRegion !== config.region)
    mismatches.push(
      `Region is ${observedRegion ?? 'missing'}; expected ${config.region ?? 'missing'}`,
    )
  if (!['CREATE_COMPLETE', 'UPDATE_COMPLETE'].includes(stack.StackStatus ?? ''))
    mismatches.push(
      `stack status is ${stack.StackStatus ?? 'missing'}; expected a successful stable status`,
    )
  const outputs = outputValues(stack)
  if (outputs.BootstrapContractVersion !== expectedContract)
    mismatches.push(
      `contract is ${outputs.BootstrapContractVersion ?? 'missing'}; expected ${expectedContract}`,
    )
  if (expectedRevision && outputs.BootstrapTemplateRevision !== expectedRevision)
    mismatches.push(
      `template revision is ${outputs.BootstrapTemplateRevision ?? 'missing'}; expected ${expectedRevision}`,
    )
  const requiredOutputs =
    kind === 'core'
      ? ['ArtifactBucketName', 'ApplicationStackName', 'CloudFormationExecutionRoleArn']
      : ['GitHubDeployRoleArn']
  for (const key of requiredOutputs) if (!outputs[key]) mismatches.push(`${key} output is missing`)
  if (kind === 'core') {
    if (outputs.ArtifactBucketName !== config.core?.artifactBucketName)
      mismatches.push(
        `ArtifactBucketName output is ${outputs.ArtifactBucketName ?? 'missing'}; expected ${config.core?.artifactBucketName ?? 'missing'}`,
      )
    if (outputs.ApplicationStackName !== config.core?.applicationStackName)
      mismatches.push(
        `ApplicationStackName output is ${outputs.ApplicationStackName ?? 'missing'}; expected ${config.core?.applicationStackName ?? 'missing'}`,
      )
  }
  const parameters = Object.fromEntries(
    (stack.Parameters ?? []).map(({ ParameterKey, ParameterValue }) => [
      ParameterKey,
      ParameterValue,
    ]),
  )
  const expectedParameters =
    kind === 'core'
      ? {
          ArtifactBucketName: config.core?.artifactBucketName,
          ApplicationStackName: config.core?.applicationStackName,
          DashboardFunctionName: config.core?.dashboardFunctionName,
          ComputeMode: config.mode,
          RuntimeSecretArn: config.core?.runtimeSecretArn ?? '',
          ArtifactKmsKeyArn: config.core?.artifactKmsKeyArn ?? '',
        }
      : {
          GitHubOidcProviderArn: config.githubOidc?.providerArn,
          GitHubRepository: config.githubOidc?.repository,
          GitHubOwnerId: config.githubOidc?.ownerId,
          GitHubRepositoryId: config.githubOidc?.repositoryId,
          GitHubEnvironment: config.githubOidc?.environment,
          CoreBootstrapStackName: config.core?.stackName,
          ApplicationStackName: config.core?.applicationStackName,
          ArtifactBucketName: config.core?.artifactBucketName,
          ComputeMode: config.mode,
          CloudFormationExecutionRoleArn: coreOutputs.CloudFormationExecutionRoleArn,
          ConsumerGatewayStackName: config.githubOidc?.consumerGatewayStackName ?? '',
        }
  for (const [key, expected] of Object.entries(expectedParameters))
    if (expected !== undefined && parameters[key] !== expected)
      mismatches.push(`${key} is ${parameters[key] ?? 'missing'}; expected ${expected}`)
  return { ok: mismatches.length === 0, mismatches }
}

/** Merges a new parameter set with deployed values without silently dropping configuration. */
export function mergeBootstrapParameters(
  requested: CloudFormationParameterValue[],
  deployed: CloudFormationParameterValue[],
): CloudFormationParameterValue[] {
  const supplied = new Map(requested.map((entry) => [entry.ParameterKey, entry.ParameterValue]))
  const duplicates = requested.map((entry) => entry.ParameterKey)
  if (new Set(duplicates).size !== duplicates.length)
    throw new Error('Bootstrap parameter file contains duplicate parameters')
  return deployed
    .map(({ ParameterKey, ParameterValue }) => ({
      ParameterKey,
      ParameterValue: supplied.get(ParameterKey) ?? ParameterValue,
    }))
    .concat(
      requested.filter(
        ({ ParameterKey }) => !deployed.some((entry) => entry.ParameterKey === ParameterKey),
      ),
    )
}

/** Validates a caller-captured `describe-stacks` result before an upgrade merges it locally. */
export function deployedBootstrapStack(
  input: unknown,
  expectedContractVersion: string,
): DeployedBootstrapStack {
  const stack =
    input && typeof input === 'object' && 'Stacks' in input
      ? (input as { Stacks?: unknown[] }).Stacks?.[0]
      : input
  if (!stack || typeof stack !== 'object') throw new Error('Deployed stack JSON contains no stack')
  const deployed = stack as DeployedBootstrapStack
  const contract = deployed.Outputs?.find(
    (output) => output.OutputKey === 'BootstrapContractVersion',
  )?.OutputValue
  if (contract !== expectedContractVersion)
    throw new Error(
      `Bootstrap contract mismatch (deployed: ${contract ?? 'missing'}; expected: ${expectedContractVersion}); follow the documented migration procedure`,
    )
  if (deployed.Parameters && !Array.isArray(deployed.Parameters))
    throw new Error('Deployed stack JSON has invalid Parameters')
  return deployed
}

/** Extracts the adapter contract from a caller-captured core `describe-stacks` result. */
export function coreBootstrapOutputs(stack: DeployedBootstrapStack): Record<string, string> {
  const values = Object.fromEntries(
    (stack.Outputs ?? [])
      .filter((output): output is { OutputKey: string; OutputValue: string } =>
        Boolean(output.OutputValue),
      )
      .map((output) => [output.OutputKey, output.OutputValue]),
  )
  const required = ['ArtifactBucketName', 'ApplicationStackName', 'CloudFormationExecutionRoleArn']
  const missing = required.filter((key) => !values[key])
  if (missing.length) throw new Error(`Core stack JSON is missing outputs: ${missing.join(', ')}`)
  return values
}

export function requiredBootstrapParameters(
  kind: BootstrapKind,
  values: Record<string, string | undefined>,
): CloudFormationParameterValue[] {
  const keys =
    kind === 'core'
      ? ['ArtifactBucketName', 'ApplicationStackName', 'DashboardFunctionName']
      : [
          'GitHubOidcProviderArn',
          'GitHubRepository',
          'GitHubOwnerId',
          'GitHubRepositoryId',
          'GitHubEnvironment',
          'CoreBootstrapStackName',
          'ApplicationStackName',
          'ArtifactBucketName',
          'CloudFormationExecutionRoleArn',
        ]
  const missing = keys.filter((key) => !values[key])
  if (missing.length) throw new Error(`Missing required bootstrap values: ${missing.join(', ')}`)
  const optional =
    kind === 'core'
      ? ['RuntimeSecretArn', 'ArtifactKmsKeyArn', 'ComputeMode']
      : ['ConsumerGatewayStackName', 'ComputeMode']
  return [...keys, ...optional]
    .filter((key) => values[key] !== undefined)
    .map((ParameterKey) => ({ ParameterKey, ParameterValue: values[ParameterKey] ?? '' }))
}
