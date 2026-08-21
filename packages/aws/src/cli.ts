#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { runDoctor } from './doctor.ts'
import {
  type BootstrapConfig,
  bootstrapContractVersion,
  bootstrapHandoff,
  bootstrapTemplate,
  bootstrapTemplatePath,
  cloudFormationTemplate,
  coreBootstrapOutputs,
  deployedBootstrapStack,
  deployLambda,
  mergeBootstrapParameters,
  packageLambda,
  publishClientAssets,
  requiredBootstrapParameters,
  verifyBootstrap,
} from './index.ts'

const args = process.argv.slice(2)
const option = (name: string, fallback?: string) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}

async function installedPackageVersion(): Promise<string> {
  const packageManifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version?: unknown }
  return typeof packageManifest.version === 'string' ? packageManifest.version : ''
}

const requiredOption = (name: string, fallback?: string): string => {
  const value = option(name, fallback)
  if (!value) throw new Error(`${name} is required`)
  return value
}

function parameter(key: string, value: string): { ParameterKey: string; ParameterValue: string } {
  return { ParameterKey: key, ParameterValue: value }
}

type CloudFormationParameter = { Default?: unknown }
type CloudFormationParameterValue = { ParameterKey: string; ParameterValue: string }
type TemplateParameterData = {
  definitions: Record<string, CloudFormationParameter>
  packageManaged: Set<string>
}

async function existingParameters(path: string): Promise<CloudFormationParameterValue[]> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!Array.isArray(parsed)) throw new Error(`${path} must contain a JSON parameter array`)
    const values = parsed.map((value) => {
      if (
        !value ||
        typeof value !== 'object' ||
        typeof value.ParameterKey !== 'string' ||
        typeof value.ParameterValue !== 'string'
      )
        throw new Error(
          `${path} entries must contain string ParameterKey and ParameterValue fields`,
        )
      return value as CloudFormationParameterValue
    })
    const keys = values.map(({ ParameterKey }) => ParameterKey)
    if (new Set(keys).size !== keys.length) throw new Error(`${path} contains duplicate parameters`)
    return values
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
}

function bootstrapKind(): 'core' | 'github-oidc' {
  const kind = option('--kind')
  if (kind === 'core' || kind === 'github-oidc') return kind
  throw new Error('--kind must be core or github-oidc')
}

async function readBootstrapConfig(path: string): Promise<BootstrapConfig> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('--config must contain a JSON object')
  return parsed as BootstrapConfig
}

async function bootstrapConfig(): Promise<BootstrapConfig> {
  const path = option('--config')
  return path ? readBootstrapConfig(path) : {}
}

function bootstrapValues(
  config: BootstrapConfig,
  coreOutputs: Record<string, string> = {},
): Record<string, string | undefined> {
  return {
    ArtifactBucketName: option(
      '--artifact-bucket',
      coreOutputs.ArtifactBucketName ?? config.core?.artifactBucketName,
    ),
    ApplicationStackName: option(
      '--application-stack',
      coreOutputs.ApplicationStackName ?? config.core?.applicationStackName,
    ),
    DashboardFunctionName: option('--function-name', config.core?.dashboardFunctionName),
    RuntimeSecretArn: option('--runtime-secret-arn', config.core?.runtimeSecretArn),
    ArtifactKmsKeyArn: option('--artifact-kms-key-arn', config.core?.artifactKmsKeyArn),
    GitHubOidcProviderArn: option('--github-oidc-provider-arn', config.githubOidc?.providerArn),
    GitHubRepository: option('--github-repository', config.githubOidc?.repository),
    GitHubOwnerId: option('--github-owner-id', config.githubOidc?.ownerId),
    GitHubRepositoryId: option('--github-repository-id', config.githubOidc?.repositoryId),
    GitHubEnvironment: option('--github-environment', config.githubOidc?.environment),
    CloudFormationExecutionRoleArn: option(
      '--execution-role-arn',
      coreOutputs.CloudFormationExecutionRoleArn,
    ),
  }
}

function bootstrapStackName(
  kind: 'core' | 'github-oidc',
  config: BootstrapConfig,
): string | undefined {
  return kind === 'core' ? config.core?.stackName : config.githubOidc?.stackName
}

function shellCommand(command: string[]): string {
  return command.map((argument) => `'${argument.replaceAll("'", "'\\\"'\\\"'")}'`).join(' ')
}

async function templateParameters(): Promise<TemplateParameterData> {
  const template = await cloudFormationTemplate()
  const block = template.match(/^Parameters:\n[\s\S]*?(?=^[A-Za-z][A-Za-z0-9]*:\s*$)/m)?.[0]
  if (!block) throw new Error('Unable to read Parameters from the CloudFormation template')
  const parsed = parse(block) as { Parameters?: Record<string, CloudFormationParameter> }
  if (!parsed.Parameters) throw new Error('CloudFormation template has no Parameters')
  const metadataBlock = template.match(/^Metadata:\n[\s\S]*?(?=^Parameters:\s*$)/m)?.[0]
  const metadata = metadataBlock
    ? ((parse(metadataBlock) as { Metadata?: { PackageManagedParameters?: unknown } }).Metadata ??
      {})
    : {}
  if (
    metadata.PackageManagedParameters !== undefined &&
    (!Array.isArray(metadata.PackageManagedParameters) ||
      !metadata.PackageManagedParameters.every((key) => typeof key === 'string'))
  )
    throw new Error('CloudFormation template has invalid PackageManagedParameters metadata')
  const packageManaged = new Set<string>(metadata.PackageManagedParameters ?? [])
  const unknownManaged = [...packageManaged].filter(
    (key) => !Object.hasOwn(parsed.Parameters ?? {}, key),
  )
  if (unknownManaged.length)
    throw new Error(
      `CloudFormation template has unknown package-managed parameters: ${unknownManaged.join(', ')}`,
    )
  return { definitions: parsed.Parameters, packageManaged }
}

try {
  const packageVersion = await installedPackageVersion()
  const bundledAssets = fileURLToPath(new URL('../client', import.meta.url))
  if (args[0] === 'deploy') {
    const artifactDir = requiredOption('--artifact-dir')
    const version = requiredOption('--version', packageVersion)
    await deployLambda({
      artifactDir,
      assetsDir: option('--assets-dir', bundledAssets) ?? bundledAssets,
      assetsBucket: requiredOption('--assets-bucket'),
      assetsBaseUrl: requiredOption('--assets-base-url'),
      functionName: requiredOption('--function-name'),
      version,
      dryRun: args.includes('--dry-run'),
    })
    console.log(JSON.stringify({ deployed: true, version }))
  } else if (args[0] === 'publish-assets') {
    const version = requiredOption('--version', packageVersion)
    const assetPath = await publishClientAssets({
      assetsDir: option('--assets-dir', bundledAssets) ?? bundledAssets,
      assetsBucket: requiredOption('--assets-bucket'),
      assetsBaseUrl: requiredOption('--assets-base-url'),
      version,
    })
    console.log(JSON.stringify({ published: true, version, assetPath }))
  } else if (args[0] === 'doctor') {
    const parametersPath =
      option('--parameters', 'aws-dashboard-parameters.json') ?? 'aws-dashboard-parameters.json'
    const region =
      option('--region', process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1') ??
      'us-east-1'
    const checks = await runDoctor(
      { parametersPath, region },
      {
        async execute(command, commandArgs) {
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          return (await promisify(execFile)(command, commandArgs)).stdout.trim()
        },
        async fetch(url) {
          return fetch(url)
        },
        nodeVersion: process.versions.node,
        packageVersion,
      },
    )
    for (const check of checks)
      console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`)
    if (checks.some(({ ok }) => !ok)) process.exitCode = 1
  } else if (args[0] === 'parameters') {
    const output =
      option('--output', 'aws-dashboard-parameters.json') ?? 'aws-dashboard-parameters.json'
    const existing = await existingParameters(output)
    const consumerConfigPath = option('--bootstrap-config')
    const consumerConfig = consumerConfigPath
      ? await readBootstrapConfig(consumerConfigPath)
      : undefined
    const existingValues = Object.fromEntries(
      existing.map(({ ParameterKey, ParameterValue }) => [ParameterKey, ParameterValue]),
    )
    const artifactBucket = option(
      '--artifact-bucket',
      existingValues.LambdaArtifactBucket ?? consumerConfig?.core?.artifactBucketName,
    )
    if (!artifactBucket) throw new Error('--artifact-bucket is required')
    const { definitions, packageManaged } = await templateParameters()
    const templateKeys = Object.keys(definitions)
    const hasDefault = (key: string) => Object.hasOwn(definitions[key] ?? {}, 'Default')
    const hasValue = (key: string) =>
      key === 'LambdaArtifactBucket' || Object.hasOwn(existingValues, key)
    const missingRequired = templateKeys.filter(
      (key) => !hasDefault(key) && !packageManaged.has(key) && !hasValue(key),
    )
    const staleExisting = Object.keys(existingValues).filter(
      (key) => !Object.hasOwn(definitions, key),
    )
    if (missingRequired.length || staleExisting.length) {
      throw new Error(
        `Parameter values are out of sync with the CloudFormation template (missing: ${missingRequired.join(', ') || 'none'}; stale: ${staleExisting.join(', ') || 'none'})`,
      )
    }
    const includeDefaults = args.includes('--include-defaults')
    const functionName = option('--function-name', consumerConfig?.core?.dashboardFunctionName)
    const parameters = templateKeys
      .filter(
        (key) =>
          !packageManaged.has(key) &&
          (includeDefaults ||
            !hasDefault(key) ||
            Object.hasOwn(existingValues, key) ||
            (key === 'Name' && Boolean(functionName))),
      )
      .map((key) => {
        const definition = definitions[key]
        const value =
          key === 'LambdaArtifactBucket'
            ? artifactBucket
            : key === 'Name' && functionName
              ? functionName
              : (existingValues[key] ?? definition?.Default)
        if (value === undefined) throw new Error(`No value for CloudFormation parameter ${key}`)
        return parameter(key, String(value))
      })
    await writeFile(output, `${JSON.stringify(parameters, null, 2)}\n`)
    console.log(JSON.stringify({ output }))
  } else if (args[0] === 'bootstrap') {
    const action = args[1]
    const config = await bootstrapConfig()
    if (action === 'handoff') {
      const configPath = requiredOption('--config')
      const coreStackPath = option('--core-stack-json')
      const githubStackPath = option('--github-oidc-stack-json')
      const runner = {
        async execute(command: string, commandArgs: string[]) {
          const { execFile } = await import('node:child_process')
          const { promisify } = await import('node:util')
          return (await promisify(execFile)(command, commandArgs)).stdout.trim()
        },
      }
      console.log(
        JSON.stringify(
          await bootstrapHandoff({
            config,
            configPath,
            coreStack: coreStackPath
              ? JSON.parse(await readFile(coreStackPath, 'utf8'))
              : undefined,
            coreStackPath,
            githubOidcStack: githubStackPath
              ? JSON.parse(await readFile(githubStackPath, 'utf8'))
              : undefined,
            runner,
          }),
        ),
      )
    } else if (action === 'verify') {
      requiredOption('--config')
      const coreStackPath = requiredOption('--core-stack-json')
      const githubStackPath = requiredOption('--github-oidc-stack-json')
      console.log(
        JSON.stringify(
          await verifyBootstrap({
            config,
            coreStack: JSON.parse(await readFile(coreStackPath, 'utf8')),
            githubOidcStack: JSON.parse(await readFile(githubStackPath, 'utf8')),
          }),
        ),
      )
    } else if (action === 'template') {
      const kind = bootstrapKind()
      console.log(
        JSON.stringify({
          kind,
          template: await bootstrapTemplatePath(kind),
          contractVersion: bootstrapContractVersion(await bootstrapTemplate(kind)),
        }),
      )
    } else if (action === 'parameters') {
      const kind = bootstrapKind()
      const output =
        option('--output', `aws-dashboard-bootstrap-${kind}.json`) ??
        `aws-dashboard-bootstrap-${kind}.json`
      let coreOutputs: Record<string, string> = {}
      const coreStackPath = option('--core-stack-json')
      if (kind === 'github-oidc' && coreStackPath) {
        coreOutputs = coreBootstrapOutputs(
          deployedBootstrapStack(
            JSON.parse(await readFile(coreStackPath, 'utf8')),
            bootstrapContractVersion(await bootstrapTemplate('core')),
          ),
        )
      }
      const supplied = requiredBootstrapParameters(kind, bootstrapValues(config, coreOutputs))
      let parameters = supplied
      const deployedStackPath = option('--deployed-stack-json')
      if (deployedStackPath) {
        const stack = deployedBootstrapStack(
          JSON.parse(await readFile(deployedStackPath, 'utf8')),
          bootstrapContractVersion(await bootstrapTemplate(kind)),
        )
        parameters = mergeBootstrapParameters(supplied, stack.Parameters ?? [])
      }
      await writeFile(output, `${JSON.stringify(parameters, null, 2)}\n`)
      console.log(
        JSON.stringify({ output, kind, preservedDeployedValues: Boolean(deployedStackPath) }),
      )
    } else if (action === 'status') {
      const kind = bootstrapKind()
      const stackName = requiredOption('--stack-name', bootstrapStackName(kind, config))
      const region = option('--region', config.region)
      const awsCommand = [
        'aws',
        'cloudformation',
        'describe-stacks',
        '--stack-name',
        stackName,
        ...(region ? ['--region', region] : []),
        '--no-cli-pager',
      ]
      console.log(
        JSON.stringify({
          kind,
          contractVersion: bootstrapContractVersion(await bootstrapTemplate(kind)),
          awsCommand,
          shellCommand: args.includes('--format-shell') ? shellCommand(awsCommand) : undefined,
        }),
      )
    } else if (action === 'change-set') {
      const kind = bootstrapKind()
      const stackName = requiredOption('--stack-name', bootstrapStackName(kind, config))
      const changeSetName = requiredOption('--change-set-name')
      const parametersPath = requiredOption('--parameters')
      const region = option('--region', config.region)
      await existingParameters(parametersPath)
      // Emit command arguments only. Administrators invoke and review AWS operations explicitly.
      const awsCommand = [
        'aws',
        'cloudformation',
        'create-change-set',
        '--stack-name',
        stackName,
        '--change-set-name',
        changeSetName,
        '--change-set-type',
        option('--change-set-type', 'UPDATE') ?? 'UPDATE',
        '--template-body',
        `file://${await bootstrapTemplatePath(kind)}`,
        '--parameters',
        `file://${parametersPath}`,
        '--capabilities',
        'CAPABILITY_NAMED_IAM',
        ...(region ? ['--region', region] : []),
        '--no-cli-pager',
      ]
      console.log(
        JSON.stringify({
          kind,
          reviewRequired: true,
          awsCommand,
          shellCommand: args.includes('--format-shell') ? shellCommand(awsCommand) : undefined,
        }),
      )
    } else {
      throw new Error(
        'Usage: ze-great-dashboard-aws bootstrap handoff|verify --config manifest.json [options], or bootstrap template|parameters|status|change-set --kind core|github-oidc [options]',
      )
    }
  } else if (args[0] !== 'package')
    throw new Error(
      'Usage: ze-great-dashboard-aws package|parameters|bootstrap|publish-assets|deploy|doctor [options]',
    )
  else {
    const boardConfig = option('--board-config')
    // Consumers should omit --version so the package and client release stay paired. The explicit
    // override exists for the provider's release workflow, which packages before publishing.
    const version = option('--version', process.env.DASHBOARD_VERSION ?? packageVersion)
    if (!boardConfig) throw new Error('--board-config is required')
    if (!version)
      throw new Error('Unable to determine the package version; pass --version explicitly')
    const metadata = await packageLambda({
      boardConfigPath: boardConfig,
      outputDir: option('--output', 'aws-release') ?? 'aws-release',
      version,
      assetDomain: option('--asset-domain'),
    })
    console.log(JSON.stringify(metadata))
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
