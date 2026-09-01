#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { parse } from 'yaml'
import { runDoctor } from './doctor.ts'
import {
  type BootstrapConfig,
  bootstrapContractVersion,
  bootstrapGuideReport,
  bootstrapHandoff,
  bootstrapPlan,
  bootstrapPreflight,
  bootstrapRemediation,
  bootstrapTemplate,
  bootstrapTemplatePath,
  type ComputeMode,
  checkBootstrap,
  cloudFormationTemplate,
  computeMode,
  coreBootstrapOutputs,
  deployedBootstrapStack,
  formatBootstrapCheckText,
  formatBootstrapRemediationText,
  mergeBootstrapParameters,
  type PackagedRelease,
  packageEcs,
  packageLambda,
  requireComputeMode,
  requiredBootstrapParameters,
  resolveComputeMode,
  scaffoldBootstrapManifest,
  upgradeBootstrapManifest,
  verifyBootstrap,
} from './index.ts'

const args = process.argv.slice(2)
const runCommand = promisify(execFile)
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
type SuppliedParameterValues = Record<string, string>
type DeploymentHandoff = {
  mode: ComputeMode
  template: 'template.yml'
  lambdaZip?: 'lambda.zip'
  image?: string
  releaseFile: 'release.json'
  artifact: { bucket: string; key: string }
  release: PackagedRelease
  parameters: 'parameters.json'
  commands: { upload: string[]; deploy: string[] }
}

async function existingParameters(
  path: string,
  allowMissing = false,
): Promise<CloudFormationParameterValue[]> {
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
    if (
      allowMissing &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )
      return []
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
    RuntimeSecretArn: option('--runtime-secret-arn', config.core?.runtimeSecretArn ?? ''),
    ArtifactKmsKeyArn: option('--artifact-kms-key-arn', config.core?.artifactKmsKeyArn ?? ''),
    ComputeMode: computeMode(config),
    GitHubOidcProviderArn: option('--github-oidc-provider-arn', config.githubOidc?.providerArn),
    GitHubRepository: option('--github-repository', config.githubOidc?.repository),
    GitHubOwnerId: option('--github-owner-id', config.githubOidc?.ownerId),
    GitHubRepositoryId: option('--github-repository-id', config.githubOidc?.repositoryId),
    GitHubEnvironment: option('--github-environment', config.githubOidc?.environment),
    CoreBootstrapStackName: config.core?.stackName,
    ConsumerGatewayStackName: option(
      '--consumer-gateway-stack',
      config.githubOidc?.consumerGatewayStackName ?? '',
    ),
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

function outputFormat(defaultFormat: 'json' | 'text' = 'json'): 'json' | 'text' | 'shell' {
  if (args.includes('--format-shell')) return 'shell'
  const format = option('--format', defaultFormat)
  if (format !== 'json' && format !== 'text') throw new Error('--format must be json or text')
  return format
}

function printBootstrap(
  value: unknown,
  text: string,
  shell?: string,
  defaultFormat: 'json' | 'text' = 'json',
): void {
  const format = outputFormat(defaultFormat)
  if (format === 'shell') {
    if (!shell) throw new Error('--format-shell is only supported for command handoffs')
    console.log(shell)
  } else if (format === 'text') console.log(text)
  else console.log(JSON.stringify(value))
}

const runner = {
  async execute(command: string, commandArgs: string[]) {
    return (await runCommand(command, commandArgs)).stdout.trim()
  },
}

const preflightRunner = {
  async execute(command: string, commandArgs: string[]) {
    try {
      return await runner.execute(command, commandArgs)
    } catch (error) {
      // Preflight distinguishes an observed 404 from an unavailable CLI/auth/network.
      if (error && typeof error === 'object' && 'stderr' in error) {
        const stderr = error.stderr
        if (typeof stderr === 'string' && /not found|404|nosuchentity/i.test(stderr)) return stderr
      }
      throw error
    }
  },
}

async function templateParameters(mode: ComputeMode = 'lambda'): Promise<TemplateParameterData> {
  const template = await cloudFormationTemplate(mode)
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

function validateConsumerParameters(
  supplied: CloudFormationParameterValue[],
  template: TemplateParameterData,
): SuppliedParameterValues {
  const values = Object.fromEntries(
    supplied.map(({ ParameterKey, ParameterValue }) => [ParameterKey, ParameterValue]),
  )
  const templateKeys = Object.keys(template.definitions)
  const unknown = Object.keys(values).filter((key) => !templateKeys.includes(key))
  if (unknown.length)
    throw new Error(`Parameter file contains unknown parameters: ${unknown.join(', ')}`)
  const overridden = [...template.packageManaged].filter(
    (key) => key !== 'ComputeMode' && Object.hasOwn(values, key),
  )
  if (overridden.length)
    throw new Error(
      `Parameter file must not set package-managed parameters: ${overridden.join(', ')}`,
    )
  const missing = templateKeys.filter(
    (key) =>
      !template.packageManaged.has(key) &&
      !Object.hasOwn(values, key) &&
      !Object.hasOwn(template.definitions[key] ?? {}, 'Default'),
  )
  if (missing.length)
    throw new Error(`Parameter file is missing required consumer values: ${missing.join(', ')}`)
  return values
}

function resolvedReleaseParameters(
  supplied: SuppliedParameterValues,
  template: TemplateParameterData,
  managedValues: Record<string, string>,
): CloudFormationParameterValue[] {
  const templateKeys = Object.keys(template.definitions)
  return templateKeys.map((key) => {
    const value = template.packageManaged.has(key)
      ? managedValues[key]
      : (supplied[key] ?? template.definitions[key]?.Default)
    if (value === undefined) throw new Error(`No value for CloudFormation parameter ${key}`)
    return parameter(key, String(value))
  })
}

function deploymentHandoff(input: {
  outputDir: string
  artifactBucket: string
  artifactKey: string
  release: PackagedRelease
}): DeploymentHandoff {
  const prefix = input.outputDir.replace(/\/+$/, '')
  const path = (name: string) => `${prefix}/${name}`
  const parameterFile = path('parameters.json')
  const mode = input.release.computeMode
  const upload =
    mode === 'lambda'
      ? [
          'aws',
          's3',
          'cp',
          path('lambda.zip'),
          `s3://${input.artifactBucket}/${input.artifactKey}`,
          '--region',
          '$AWS_REGION',
        ]
      : []
  return {
    mode,
    template: 'template.yml',
    ...(mode === 'lambda' ? { lambdaZip: 'lambda.zip' as const } : { image: input.release.image }),
    releaseFile: 'release.json',
    artifact: { bucket: input.artifactBucket, key: input.artifactKey },
    release: input.release,
    parameters: 'parameters.json',
    commands: {
      upload,
      deploy: [
        'aws',
        'cloudformation',
        'deploy',
        '--stack-name',
        '$STACK_NAME',
        '--template-file',
        path('template.yml'),
        '--role-arn',
        '$AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN',
        '--region',
        '$AWS_REGION',
        '--capabilities',
        'CAPABILITY_NAMED_IAM',
        '--parameter-overrides',
        `file://${parameterFile}`,
        '--no-fail-on-empty-changeset',
        '--no-cli-pager',
      ],
    },
  }
}

function copyableCommand(command: string[]): string {
  return command
    .map((argument) =>
      /^\$[A-Z][A-Z0-9_]*$/.test(argument)
        ? argument
        : `'${argument.replaceAll("'", "'\\\"'\\\"'")}'`,
    )
    .join(' ')
}

try {
  const packageVersion = await installedPackageVersion()
  if (args[0] === 'doctor') {
    const parametersPath =
      option('--parameters', 'aws-dashboard-parameters.json') ?? 'aws-dashboard-parameters.json'
    const region =
      option('--region', process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1') ??
      'us-east-1'
    const checks = await runDoctor(
      {
        parametersPath,
        region,
        githubOidcStackPath: option('--github-oidc-stack-json'),
      },
      {
        execute: runner.execute,
        async fetch(url) {
          return fetch(url)
        },
        nodeVersion: process.versions.node,
        packageVersion,
      },
    )
    const remediation = checks[0]?.remediation
    if (outputFormat('text') === 'text') {
      for (const check of checks)
        console.log(
          `${check.warning ? 'WARN' : check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`,
        )
      if (remediation) console.log(formatBootstrapRemediationText(remediation).join('\n'))
    } else console.log(JSON.stringify({ checks, remediation }))
    if (checks.some(({ ok }) => !ok)) process.exitCode = 1
  } else if (args[0] === 'parameters') {
    const output =
      option('--output', 'aws-dashboard-parameters.json') ?? 'aws-dashboard-parameters.json'
    const existing = await existingParameters(output, true)
    const consumerConfigPath = option('--bootstrap-config')
    const consumerConfig = consumerConfigPath
      ? await readBootstrapConfig(consumerConfigPath)
      : undefined
    const existingValues = Object.fromEntries(
      existing.map(({ ParameterKey, ParameterValue }) => [ParameterKey, ParameterValue]),
    )
    const mode = resolveComputeMode({
      persisted: consumerConfig?.mode,
      artifact: existingValues.ComputeMode,
      explicit: option('--mode'),
    })
    const artifactBucket = option(
      '--artifact-bucket',
      existingValues.LambdaArtifactBucket ?? consumerConfig?.core?.artifactBucketName,
    )
    if (mode === 'lambda' && !artifactBucket) throw new Error('--artifact-bucket is required')
    const { definitions, packageManaged } = await templateParameters(mode)
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
          (!packageManaged.has(key) || key === 'ComputeMode') &&
          (includeDefaults ||
            !hasDefault(key) ||
            Object.hasOwn(existingValues, key) ||
            (key === 'Name' && Boolean(functionName))),
      )
      .map((key) => {
        const definition = definitions[key]
        const value =
          key === 'LambdaArtifactBucket'
            ? (artifactBucket ?? '')
            : key === 'ComputeMode'
              ? mode
              : key === 'Name' && functionName
                ? functionName
                : (existingValues[key] ?? definition?.Default)
        if (value === undefined) throw new Error(`No value for CloudFormation parameter ${key}`)
        return parameter(key, String(value))
      })
    await writeFile(output, `${JSON.stringify(parameters, null, 2)}\n`)
    printBootstrap({ output }, `Wrote ${output}. Next: run the generated deployment handoff.`)
  } else if (args[0] === 'bootstrap') {
    const action = args[1]
    if (action === 'init') {
      const output = requiredOption('--output')
      try {
        await readFile(output, 'utf8')
        throw new Error(`Refusing to overwrite existing manifest: ${output}`)
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
          throw error
      }
      const manifest = await scaffoldBootstrapManifest({
        slug: requiredOption('--slug'),
        repository: requiredOption('--repository'),
        environment: requiredOption('--environment'),
        providerArn: requiredOption('--github-oidc-provider-arn'),
        region: option('--region'),
        accountId: option('--account-id'),
        ownerId: option('--github-owner-id'),
        repositoryId: option('--github-repository-id'),
        consumerGatewayStackName: option('--consumer-gateway-stack'),
        mode: (option('--mode', 'lambda') ?? 'lambda') as ComputeMode,
        runner,
      })
      await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' })
      printBootstrap(
        { output, manifest, remediation: (await bootstrapPlan(manifest)).remediation },
        `Wrote ${output}. Next: run bootstrap preflight, then bootstrap handoff.`,
      )
    } else if (action === 'upgrade') {
      const configPath = requiredOption('--config')
      const result = await upgradeBootstrapManifest(configPath)
      printBootstrap(
        result,
        `Updated desired-state metadata in ${configPath}.\nChanged: ${result.metadataChanges.length ? result.metadataChanges.map(({ path, before, after }) => `${path}: ${before ?? 'missing'} -> ${after}`).join(', ') : 'none (already current)'}.\nReview and commit this manifest before deployment.`,
      )
    } else {
      const config = await bootstrapConfig()
      if (action === 'preflight') {
        requiredOption('--config')
        const result = await bootstrapPreflight({ config, runner: preflightRunner })
        printBootstrap(
          result,
          [
            ...result.checks.map(
              (check) => `${check.status.toUpperCase()} ${check.name}: ${check.detail}`,
            ),
            '',
            ...formatBootstrapRemediationText(result.remediation),
          ].join('\n'),
        )
        if (!result.ready) process.exitCode = 1
      } else if (action === 'guide') {
        const configPath = requiredOption('--config')
        const coreStackPath = option('--core-stack-json')
        const githubStackPath = option('--github-oidc-stack-json')
        const report = await bootstrapGuideReport({
          config,
          configPath,
          workDir: option('--work-dir'),
          coreStack: coreStackPath ? JSON.parse(await readFile(coreStackPath, 'utf8')) : undefined,
          coreStackPath,
          githubOidcStack: githubStackPath
            ? JSON.parse(await readFile(githubStackPath, 'utf8'))
            : undefined,
          githubOidcStackPath: githubStackPath,
          runner,
        })
        printBootstrap(
          {
            handoff: report.handoff,
            guide: report.guide,
            remediation: report.handoff.remediation,
          },
          report.guide,
          undefined,
          'text',
        )
      } else if (action === 'handoff') {
        const configPath = requiredOption('--config')
        const coreStackPath = option('--core-stack-json')
        const githubStackPath = option('--github-oidc-stack-json')
        const handoff = await bootstrapHandoff({
          config,
          configPath,
          workDir: option('--work-dir'),
          coreStack: coreStackPath ? JSON.parse(await readFile(coreStackPath, 'utf8')) : undefined,
          coreStackPath,
          githubOidcStack: githubStackPath
            ? JSON.parse(await readFile(githubStackPath, 'utf8'))
            : undefined,
          githubOidcStackPath: githubStackPath,
          runner,
        })
        printBootstrap(
          handoff,
          `${JSON.stringify(handoff, null, 2)}\n${formatBootstrapRemediationText(handoff.remediation).join('\n')}`,
        )
      } else if (action === 'verify') {
        requiredOption('--config')
        const coreStackPath = requiredOption('--core-stack-json')
        const githubStackPath = requiredOption('--github-oidc-stack-json')
        const verified = await verifyBootstrap({
          config,
          coreStack: JSON.parse(await readFile(coreStackPath, 'utf8')),
          githubOidcStack: JSON.parse(await readFile(githubStackPath, 'utf8')),
        })
        printBootstrap(
          verified,
          `Bootstrap verified.\n${formatBootstrapRemediationText(verified.remediation).join('\n')}`,
        )
      } else if (action === 'template') {
        const kind = bootstrapKind()
        const mode = requireComputeMode(config, option('--mode'))
        const template = {
          kind,
          mode,
          template: await bootstrapTemplatePath(kind, mode),
          contractVersion: bootstrapContractVersion(await bootstrapTemplate(kind, mode)),
          remediation: bootstrapRemediation(config, {
            nextOperation: `Review the ${kind} template, then run bootstrap parameters and create a reviewed change set.`,
          }),
        }
        printBootstrap(
          template,
          `Template: ${template.template}\nContract: ${template.contractVersion}\n${formatBootstrapRemediationText(template.remediation).join('\n')}`,
        )
      } else if (action === 'plan') {
        requiredOption('--config')
        const plan = await bootstrapPlan(config)
        if (outputFormat() === 'text') {
          console.log('AWS bootstrap plan (read-only)')
          console.log(`Package version: ${plan.packageVersion}`)
          console.log(
            `Manifest desired state: ${plan.desiredState.manifest ? JSON.stringify(plan.desiredState.manifest) : 'missing'}`,
          )
          console.log(`Installed desired state: ${JSON.stringify(plan.desiredState.installed)}`)
          console.log(
            `Bootstrap template identity matches installed package: ${plan.desiredState.matches ? 'yes' : 'no'}`,
          )
          console.log(
            `Package version provenance matches installed package: ${plan.desiredState.packageVersionMatches ? 'yes' : 'no (informational)'}`,
          )
          if (!plan.desiredState.matches)
            console.log(
              `Run: npm exec -- ze-great-dashboard-aws bootstrap upgrade --config ${requiredOption('--config')}`,
            )
          for (const template of plan.packageTemplates) {
            console.log(`\n${template.kind}: ${template.path}`)
            console.log(`  contract: ${template.contractVersion}`)
            if (template.templateRevision) console.log(`  revision: ${template.templateRevision}`)
            console.log(`  sha256: ${template.sha256}`)
            console.log(
              `  resources: ${template.resources.map(({ logicalId, type }) => `${logicalId} (${type})`).join(', ')}`,
            )
            console.log(`  declared IAM actions: ${template.iamActions.join(', ') || 'none'}`)
          }
          console.log(`\n${plan.notes.join('\n')}`)
          console.log(formatBootstrapRemediationText(plan.remediation).join('\n'))
        } else console.log(JSON.stringify(plan))
      } else if (action === 'check') {
        requiredOption('--config')
        const result = await checkBootstrap(
          config,
          {
            resourceDrift: args.includes('--resource-drift'),
            configPath: requiredOption('--config'),
          },
          {
            execute: runner.execute,
          },
        )
        if (outputFormat() === 'text') process.stdout.write(formatBootstrapCheckText(result))
        else console.log(JSON.stringify(result))
        if (!result.ok) process.exitCode = 1
      } else if (action === 'parameters') {
        const kind = bootstrapKind()
        const mode = requireComputeMode(config, option('--mode'))
        const output =
          option('--output', `aws-dashboard-bootstrap-${kind}.json`) ??
          `aws-dashboard-bootstrap-${kind}.json`
        let coreOutputs: Record<string, string> = {}
        const coreStackPath = option('--core-stack-json')
        if (kind === 'github-oidc' && coreStackPath) {
          coreOutputs = coreBootstrapOutputs(
            deployedBootstrapStack(
              JSON.parse(await readFile(coreStackPath, 'utf8')),
              bootstrapContractVersion(await bootstrapTemplate('core', mode)),
            ),
          )
        }
        const supplied = requiredBootstrapParameters(
          kind,
          bootstrapValues({ ...config, mode }, coreOutputs),
        )
        let parameters = supplied
        const deployedStackPath = option('--deployed-stack-json')
        if (deployedStackPath) {
          const stack = deployedBootstrapStack(
            JSON.parse(await readFile(deployedStackPath, 'utf8')),
            bootstrapContractVersion(await bootstrapTemplate(kind, mode)),
          )
          if (
            kind === 'github-oidc' &&
            !(stack.Parameters ?? []).some(
              ({ ParameterKey }) => ParameterKey === 'ConsumerGatewayStackName',
            )
          )
            console.error(
              option('--consumer-gateway-stack', config.githubOidc?.consumerGatewayStackName)
                ? 'NOTICE: this GitHub OIDC stack predates optional consumer gateway-stack reads; the generated parameters will add the configured gateway stack. Review and execute the GitHub OIDC UPDATE change set.'
                : 'NOTICE: this GitHub OIDC stack predates optional consumer gateway-stack reads. If your workflow verifies a consumer-owned gateway stack, configure githubOidc.consumerGatewayStackName before reviewing the UPDATE change set; otherwise no bootstrap change is needed.',
            )
          parameters = mergeBootstrapParameters(supplied, stack.Parameters ?? [])
        }
        await writeFile(output, `${JSON.stringify(parameters, null, 2)}\n`)
        const remediation = (await bootstrapPlan(config)).remediation
        printBootstrap(
          {
            output,
            kind,
            preservedDeployedValues: Boolean(deployedStackPath),
            remediation,
          },
          `Wrote ${output}. Next: review and execute the generated ${kind} change set.\n${formatBootstrapRemediationText(remediation).join('\n')}`,
        )
      } else if (action === 'change-set') {
        const kind = bootstrapKind()
        const stackName = requiredOption('--stack-name', bootstrapStackName(kind, config))
        const changeSetName = requiredOption('--change-set-name')
        const parametersPath = requiredOption('--parameters')
        const region = option('--region', config.region)
        const plan = await bootstrapPlan(config)
        const template = plan.packageTemplates.find((candidate) => candidate.kind === kind)
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
        const handoff = {
          kind,
          packageVersion: plan.packageVersion,
          contractVersion: template?.contractVersion,
          templateRevision: template?.templateRevision,
          templateSha256: template?.sha256,
          reviewRequired: true,
          awsCommand,
          shellCommand: args.includes('--format-shell') ? shellCommand(awsCommand) : undefined,
          remediation: plan.remediation,
        }
        printBootstrap(
          handoff,
          `Run the reviewed change set command:\n${shellCommand(awsCommand)}`,
          shellCommand(awsCommand),
        )
      } else {
        throw new Error(
          'Usage: ze-great-dashboard-aws bootstrap init|upgrade|preflight|plan|check|guide|handoff|verify --config manifest.json [options], or bootstrap template|parameters|change-set --kind core|github-oidc [options]',
        )
      }
    }
  } else if (args[0] !== 'package')
    throw new Error('Usage: ze-great-dashboard-aws package|parameters|bootstrap|doctor [options]')
  else {
    const boardConfig = option('--board-config')
    // Consumers should omit --version so the package and client release stay paired. The explicit
    // override exists for the provider's release workflow, which packages before publishing.
    const version = option('--version', process.env.DASHBOARD_VERSION ?? packageVersion)
    if (!boardConfig) throw new Error('--board-config is required')
    if (!version)
      throw new Error('Unable to determine the package version; pass --version explicitly')
    if (option('--asset-domain'))
      console.warn('--asset-domain is deprecated; use --asset-path with the complete asset URL')
    const outputDir = option('--output', 'aws-dashboard-release') ?? 'aws-dashboard-release'
    const parametersPath =
      option('--parameters', 'aws-dashboard-parameters.json') ?? 'aws-dashboard-parameters.json'
    const rawParameters = await existingParameters(parametersPath)
    const rawMode = rawParameters.find(
      ({ ParameterKey }) => ParameterKey === 'ComputeMode',
    )?.ParameterValue
    const mode = resolveComputeMode({ artifact: rawMode, explicit: option('--mode') })
    const template = await templateParameters(mode)
    const consumerParameters = validateConsumerParameters(rawParameters, template)
    const secretReference =
      consumerParameters.SecretReference ??
      String(template.definitions.SecretReference?.Default ?? '')
    const metadata =
      mode === 'lambda'
        ? await packageLambda({
            boardConfigPath: boardConfig,
            outputDir,
            version,
            assetPath: option('--asset-path'),
            assetDomain: option('--asset-domain'),
            secretReference,
          })
        : await packageEcs({
            boardConfigPath: boardConfig,
            outputDir,
            version,
            assetPath: option('--asset-path'),
            assetDomain: option('--asset-domain'),
            secretReference,
            imageReference: option('--image'),
          })
    const resolvedParameters = resolvedReleaseParameters(consumerParameters, template, {
      ComputeMode: mode,
      LambdaArtifactKey: metadata.artifactKey,
      Image: metadata.image ?? '',
      AssetPath: metadata.assetPath,
    })
    // Parameter files created before mode persistence remain valid and stay byte-compatible;
    // newly generated files include ComputeMode and make the choice reviewable.
    if (
      mode === 'lambda' &&
      !rawParameters.some(({ ParameterKey }) => ParameterKey === 'ComputeMode')
    )
      resolvedParameters.splice(
        resolvedParameters.findIndex(({ ParameterKey }) => ParameterKey === 'ComputeMode'),
        1,
      )
    await writeFile(
      `${outputDir}/parameters.json`,
      `${JSON.stringify(resolvedParameters, null, 2)}\n`,
    )
    const handoff = deploymentHandoff({
      outputDir,
      artifactBucket:
        resolvedParameters.find(({ ParameterKey }) => ParameterKey === 'LambdaArtifactBucket')
          ?.ParameterValue ?? '',
      artifactKey: metadata.artifactKey,
      release: metadata,
    })
    await writeFile(`${outputDir}/deployment.json`, `${JSON.stringify(handoff, null, 2)}\n`)
    console.log(
      `Packaged ${mode === 'lambda' ? `${outputDir}/lambda.zip` : metadata.image} and ${outputDir}/template.yml`,
    )
    console.log(`Complete parameters: ${outputDir}/parameters.json`)
    console.log(`Deployment handoff: ${outputDir}/deployment.json`)
    console.log(`Upload: ${copyableCommand(handoff.commands.upload)}`)
    console.log(`Deploy: ${copyableCommand(handoff.commands.deploy)}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
