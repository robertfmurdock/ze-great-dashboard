import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export type BootstrapKind = 'core' | 'github-oidc'
export type CloudFormationParameterValue = {
  ParameterKey: string
  ParameterValue: string
  UsePreviousValue?: boolean
}

export type DeployedBootstrapStack = {
  Parameters?: CloudFormationParameterValue[]
  Outputs?: { OutputKey: string; OutputValue?: string }[]
}

export type BootstrapConfig = {
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
    environment?: string
  }
}

const templates: Record<BootstrapKind, string> = {
  core: '../bootstrap/core-v1.yml',
  'github-oidc': '../bootstrap/github-oidc-v1.yml',
}

export async function bootstrapTemplatePath(kind: BootstrapKind): Promise<string> {
  if (!Object.hasOwn(templates, kind)) throw new Error(`Unknown bootstrap template: ${kind}`)
  return fileURLToPath(new URL(templates[kind], import.meta.url))
}

export async function bootstrapTemplate(kind: BootstrapKind): Promise<string> {
  return readFile(await bootstrapTemplatePath(kind), 'utf8')
}

export function bootstrapContractVersion(template: string): string {
  const version = template.match(/BootstrapContractVersion:\s*\{\s*Value:\s*'([^']+)'\s*}/)?.[1]
  if (!version) throw new Error('Bootstrap template has no BootstrapContractVersion output')
  return version
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
          'GitHubEnvironment',
          'ApplicationStackName',
          'ArtifactBucketName',
          'CloudFormationExecutionRoleArn',
        ]
  const missing = keys.filter((key) => !values[key])
  if (missing.length) throw new Error(`Missing required bootstrap values: ${missing.join(', ')}`)
  const optional = kind === 'core' ? ['RuntimeSecretArn', 'ArtifactKmsKeyArn'] : []
  return [...keys, ...optional]
    .filter((key) => values[key] !== undefined)
    .map((ParameterKey) => ({ ParameterKey, ParameterValue: values[ParameterKey] ?? '' }))
}
