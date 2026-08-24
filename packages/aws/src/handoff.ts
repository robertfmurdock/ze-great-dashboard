import {
  type BootstrapConfig,
  bootstrapContractVersion,
  bootstrapTemplate,
  bootstrapTemplatePath,
  coreBootstrapOutputs,
  type DeployedBootstrapStack,
  deployedBootstrapStack,
  requiredBootstrapParameters,
} from './bootstrap.js'

export type BootstrapPhase = 'core' | 'github-oidc' | 'github-environment' | 'application-gateway'
export type CommandRunner = { execute(command: string, args: string[]): Promise<string> }
export type BootstrapProvider = {
  readonly name: string
  prerequisite(config: BootstrapConfig, runner?: CommandRunner): Promise<ProviderPrerequisite>
}
export type ProviderPrerequisite = {
  status: 'ready' | 'immutable-subject-required' | 'unverified'
  blocking: boolean
  detail: string
}
export type HandoffCommand = { name: string; args: string[]; captureFile?: string }
export type BootstrapHandoff = {
  phase: BootstrapPhase
  expectedContracts: { core: string; githubOidc: string }
  templatePath?: string
  parameterPath?: string
  expectedOutputs: string[]
  requiredCapturedFiles: string[]
  reviewCheckpoints: string[]
  commands: HandoffCommand[]
  prerequisite?: ProviderPrerequisite
}
export type BootstrapVerification = {
  verified: true
  immutableSubject: string
  environmentVariables: {
    AWS_DEPLOY_ROLE_ARN: string
    AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN: string
  }
  reviewedArns: { githubDeployRoleArn: string; cloudFormationExecutionRoleArn: string }
  githubEnvironmentInstructions: string[][]
}

const githubSubjectKeys = [
  'repository_owner',
  'repository_owner_id',
  'repository',
  'repository_id',
  'context',
]

function outputValues(stack: DeployedBootstrapStack): Record<string, string> {
  return Object.fromEntries(
    (stack.Outputs ?? [])
      .filter(
        (entry): entry is { OutputKey: string; OutputValue: string } =>
          typeof entry.OutputKey === 'string' && typeof entry.OutputValue === 'string',
      )
      .map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]),
  )
}

function parameterValues(stack: DeployedBootstrapStack): Record<string, string> {
  return Object.fromEntries(
    (stack.Parameters ?? [])
      .filter(
        (entry) =>
          typeof entry.ParameterKey === 'string' && typeof entry.ParameterValue === 'string',
      )
      .map(({ ParameterKey, ParameterValue }) => [ParameterKey, ParameterValue]),
  )
}

function capturedStackIdentity(input: unknown): { StackName?: string; StackId?: string } {
  const candidate =
    input && typeof input === 'object' && 'Stacks' in input
      ? (input as { Stacks?: unknown[] }).Stacks?.[0]
      : input
  if (!candidate || typeof candidate !== 'object') return {}
  const { StackName, StackId } = candidate as { StackName?: unknown; StackId?: unknown }
  return {
    ...(typeof StackName === 'string' ? { StackName } : {}),
    ...(typeof StackId === 'string' ? { StackId } : {}),
  }
}

function required(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Bootstrap manifest is missing ${name}`)
  return value
}

function region(config: BootstrapConfig): string {
  return required(config.region, 'region')
}

function stackName(config: BootstrapConfig, kind: 'core' | 'github-oidc'): string {
  return required(
    kind === 'core' ? config.core?.stackName : config.githubOidc?.stackName,
    `${kind}.stackName`,
  )
}

function workFile(workDir: string | undefined, name: string): string {
  return workDir ? `${workDir.replace(/\/+$/, '')}/${name}` : name
}

function changeSetCommands(input: {
  kind: 'core' | 'github-oidc'
  configPath: string
  config: BootstrapConfig
  templatePath: string
  parameterPath: string
  coreCapturePath?: string
  workDir?: string
}): HandoffCommand[] {
  const name = `${input.kind}-initial-review`
  const stack = stackName(input.config, input.kind)
  const common = ['--stack-name', stack, '--region', region(input.config)]
  const parameters = [
    'npm',
    'exec',
    '--',
    'ze-great-dashboard-aws',
    'bootstrap',
    'parameters',
    '--kind',
    input.kind,
    '--config',
    input.configPath,
    '--output',
    input.parameterPath,
  ]
  if (input.kind === 'github-oidc')
    parameters.push('--core-stack-json', input.coreCapturePath ?? 'core-deployed-stack.json')
  return [
    { name: 'generate-parameters', args: parameters },
    {
      name: 'create-change-set',
      args: [
        'aws',
        'cloudformation',
        'create-change-set',
        ...common,
        '--change-set-name',
        name,
        '--change-set-type',
        'CREATE',
        '--template-body',
        `file://${input.templatePath}`,
        '--parameters',
        `file://${input.parameterPath}`,
        '--capabilities',
        'CAPABILITY_NAMED_IAM',
        '--no-cli-pager',
      ],
    },
    {
      name: 'wait-for-change-set',
      args: [
        'aws',
        'cloudformation',
        'wait',
        'change-set-create-complete',
        ...common,
        '--change-set-name',
        name,
      ],
    },
    {
      name: 'review-change-set',
      args: [
        'aws',
        'cloudformation',
        'describe-change-set',
        ...common,
        '--change-set-name',
        name,
        '--no-cli-pager',
      ],
    },
    {
      name: 'execute-reviewed-change-set',
      args: ['aws', 'cloudformation', 'execute-change-set', ...common, '--change-set-name', name],
    },
    {
      name: 'wait-for-stack',
      args: ['aws', 'cloudformation', 'wait', 'stack-create-complete', ...common],
    },
    {
      name: 'capture-stack',
      captureFile: workFile(input.workDir, `${input.kind}-deployed-stack.json`),
      args: ['aws', 'cloudformation', 'describe-stacks', ...common, '--no-cli-pager'],
    },
  ]
}

export const githubOidcProvider: BootstrapProvider = {
  name: 'github-oidc',
  async prerequisite(config, runner) {
    const repository = config.githubOidc?.repository
    if (!repository)
      return {
        status: 'unverified',
        blocking: false,
        detail: 'GitHub repository is absent from the manifest.',
      }
    if (!runner)
      return {
        status: 'unverified',
        blocking: false,
        detail: 'GitHub OIDC subject setting was not queried.',
      }
    try {
      const response = JSON.parse(
        await runner.execute('gh', ['api', `repos/${repository}/actions/oidc/customization/sub`]),
      ) as { use_default?: unknown; include_claim_keys?: unknown }
      const keys = response.include_claim_keys
      if (
        response.use_default === false &&
        Array.isArray(keys) &&
        githubSubjectKeys.every((key) => keys.includes(key))
      )
        return {
          status: 'ready',
          blocking: false,
          detail:
            'GitHub emits the immutable owner/repository-ID OIDC subject required by this adapter.',
        }
      return {
        status: 'immutable-subject-required',
        blocking: true,
        detail:
          'Coordinate migration: inventory and temporarily make existing name-based trust policies compatible, enable immutable GitHub OIDC subjects as a separate GitHub-admin action, verify existing deployments, then retire legacy trust.',
      }
    } catch {
      return {
        status: 'unverified',
        blocking: false,
        detail:
          'GitHub OIDC subject setting could not be verified (gh CLI, authentication, permission, or network unavailable).',
      }
    }
  },
}

async function contracts() {
  return {
    core: bootstrapContractVersion(await bootstrapTemplate('core')),
    githubOidc: bootstrapContractVersion(await bootstrapTemplate('github-oidc')),
  }
}

export async function bootstrapHandoff(input: {
  config: BootstrapConfig
  configPath: string
  workDir?: string
  coreStack?: unknown
  coreStackPath?: string
  githubOidcStack?: unknown
  githubOidcStackPath?: string
  provider?: BootstrapProvider
  runner?: CommandRunner
}): Promise<BootstrapHandoff> {
  const expectedContracts = await contracts()
  const coreCapturePath = input.coreStackPath ?? workFile(input.workDir, 'core-deployed-stack.json')
  const core =
    input.coreStack === undefined
      ? undefined
      : deployedBootstrapStack(input.coreStack, expectedContracts.core)
  const oidc =
    input.githubOidcStack === undefined
      ? undefined
      : deployedBootstrapStack(input.githubOidcStack, expectedContracts.githubOidc)
  if (!core) {
    requiredBootstrapParameters('core', {
      ArtifactBucketName: input.config.core?.artifactBucketName,
      ApplicationStackName: input.config.core?.applicationStackName,
      DashboardFunctionName: input.config.core?.dashboardFunctionName,
    })
    const templatePath = await bootstrapTemplatePath('core')
    return {
      phase: 'core',
      expectedContracts,
      templatePath,
      parameterPath: workFile(input.workDir, 'core-bootstrap.json'),
      expectedOutputs: [
        'BootstrapContractVersion',
        'BootstrapTemplateRevision',
        'ArtifactBucketName',
        'ApplicationStackName',
        'CloudFormationExecutionRoleArn',
      ],
      requiredCapturedFiles: [],
      reviewCheckpoints: [
        'Review every IAM action and CAPABILITY_NAMED_IAM acknowledgement.',
        'Do not approve retained bucket or role replacements.',
      ],
      commands: changeSetCommands({
        kind: 'core',
        config: input.config,
        configPath: input.configPath,
        templatePath,
        parameterPath: workFile(input.workDir, 'core-bootstrap.json'),
        workDir: input.workDir,
      }),
    }
  }
  coreBootstrapOutputs(core)
  if (!oidc) {
    requiredBootstrapParameters('github-oidc', {
      GitHubOidcProviderArn: input.config.githubOidc?.providerArn,
      GitHubRepository: input.config.githubOidc?.repository,
      GitHubOwnerId: input.config.githubOidc?.ownerId,
      GitHubRepositoryId: input.config.githubOidc?.repositoryId,
      GitHubEnvironment: input.config.githubOidc?.environment,
      CoreBootstrapStackName: input.config.core?.stackName,
      ConsumerGatewayStackName: input.config.githubOidc?.consumerGatewayStackName,
      ...coreBootstrapOutputs(core),
    })
    const templatePath = await bootstrapTemplatePath('github-oidc')
    return {
      phase: 'github-oidc',
      expectedContracts,
      templatePath,
      parameterPath: workFile(input.workDir, 'github-oidc-bootstrap.json'),
      expectedOutputs: [
        'BootstrapContractVersion',
        'BootstrapTemplateRevision',
        'GitHubDeployRoleArn',
      ],
      requiredCapturedFiles: [coreCapturePath],
      reviewCheckpoints: [
        'Review the exact immutable GitHub OIDC subject, audience, bucket lambda/* prefix, application stack, and execution role.',
        'Do not execute until the GitHub Environment prerequisite is ready.',
      ],
      commands: changeSetCommands({
        kind: 'github-oidc',
        config: input.config,
        configPath: input.configPath,
        templatePath,
        parameterPath: workFile(input.workDir, 'github-oidc-bootstrap.json'),
        coreCapturePath,
        workDir: input.workDir,
      }),
      prerequisite: await (input.provider ?? githubOidcProvider).prerequisite(
        input.config,
        input.runner,
      ),
    }
  }
  const prerequisite = await (input.provider ?? githubOidcProvider).prerequisite(
    input.config,
    input.runner,
  )
  const githubOidcCapturePath =
    input.githubOidcStackPath ?? workFile(input.workDir, 'github-oidc-deployed-stack.json')
  if (prerequisite.status !== 'ready')
    return {
      phase: 'github-environment',
      expectedContracts,
      expectedOutputs: [],
      requiredCapturedFiles: [coreCapturePath, githubOidcCapturePath],
      reviewCheckpoints: [
        'A GitHub administrator must complete and verify the immutable-subject migration before deployments.',
      ],
      commands: [],
      prerequisite,
    }
  return {
    phase: 'application-gateway',
    expectedContracts,
    expectedOutputs: [],
    requiredCapturedFiles: [coreCapturePath, githubOidcCapturePath],
    reviewCheckpoints: [
      'Consumer owns gateway selection, private Lambda permission, authentication, and smoke tests.',
    ],
    commands: [],
    prerequisite,
  }
}

function assertEqual(actual: string | undefined, expected: string | undefined, label: string) {
  if (actual !== expected)
    throw new Error(
      `${label} mismatch (captured: ${actual ?? 'missing'}; manifest: ${expected ?? 'missing'})`,
    )
}

export async function verifyBootstrap(input: {
  config: BootstrapConfig
  coreStack: unknown
  githubOidcStack: unknown
}): Promise<BootstrapVerification> {
  const expected = await contracts()
  const core = deployedBootstrapStack(input.coreStack, expected.core)
  const oidc = deployedBootstrapStack(input.githubOidcStack, expected.githubOidc)
  for (const [kind, capture] of [
    ['Core', capturedStackIdentity(input.coreStack)],
    ['GitHub OIDC', capturedStackIdentity(input.githubOidcStack)],
  ] as const) {
    const expectedName =
      kind === 'Core' ? input.config.core?.stackName : input.config.githubOidc?.stackName
    assertEqual(capture.StackName, expectedName, `${kind} stack name`)
    const capturedRegion = capture.StackId?.match(/^arn:[^:]+:cloudformation:([^:]+):/)?.[1]
    assertEqual(capturedRegion, input.config.region, `${kind} stack Region`)
  }
  const coreOutputs = coreBootstrapOutputs(core)
  const coreParameters = parameterValues(core)
  assertEqual(
    coreParameters.ArtifactBucketName,
    input.config.core?.artifactBucketName,
    'Artifact bucket',
  )
  assertEqual(
    coreParameters.ApplicationStackName,
    input.config.core?.applicationStackName,
    'Application stack',
  )
  assertEqual(
    coreParameters.DashboardFunctionName,
    input.config.core?.dashboardFunctionName,
    'Dashboard function',
  )
  assertEqual(
    coreOutputs.ArtifactBucketName,
    input.config.core?.artifactBucketName,
    'Core output artifact bucket',
  )
  assertEqual(
    coreOutputs.ApplicationStackName,
    input.config.core?.applicationStackName,
    'Core output application stack',
  )
  const oidcParameters = parameterValues(oidc)
  const github = input.config.githubOidc
  const executionRole = required(
    coreOutputs.CloudFormationExecutionRoleArn,
    'core CloudFormationExecutionRoleArn output',
  )
  for (const [key, value] of Object.entries({
    GitHubOidcProviderArn: github?.providerArn,
    GitHubRepository: github?.repository,
    GitHubOwnerId: github?.ownerId,
    GitHubRepositoryId: github?.repositoryId,
    GitHubEnvironment: github?.environment,
    ApplicationStackName: coreOutputs.ApplicationStackName,
    ArtifactBucketName: coreOutputs.ArtifactBucketName,
    CloudFormationExecutionRoleArn: executionRole,
    ConsumerGatewayStackName: github?.consumerGatewayStackName ?? '',
  }))
    assertEqual(
      key === 'ConsumerGatewayStackName' ? (oidcParameters[key] ?? '') : oidcParameters[key],
      value,
      `OIDC ${key}`,
    )
  if (!/^\d+$/.test(github?.ownerId ?? '') || !/^\d+$/.test(github?.repositoryId ?? ''))
    throw new Error('GitHub immutable owner and repository IDs must be numeric')
  const [owner, repository, ...extra] = (github?.repository ?? '').split('/')
  if (!owner || !repository || extra.length)
    throw new Error('GitHub repository must be owner/repository')
  const deployRole = outputValues(oidc).GitHubDeployRoleArn
  if (!deployRole) throw new Error('GitHub OIDC stack JSON is missing outputs: GitHubDeployRoleArn')
  const providerArn = github?.providerArn ?? ''
  const account = providerArn.match(/^arn:[^:]+:iam::(\d+):oidc-provider\//)?.[1]
  const deployAccount = deployRole.match(/^arn:[^:]+:iam::(\d+):role\//)?.[1]
  const executionAccount = executionRole.match(/^arn:[^:]+:iam::(\d+):role\//)?.[1]
  if (!account || account !== deployAccount || account !== executionAccount)
    throw new Error('Provider and reviewed role ARNs must belong to the same AWS account')
  return {
    verified: true,
    immutableSubject: `repo:${owner}@${github?.ownerId}/${repository}@${github?.repositoryId}:environment:${github?.environment}`,
    environmentVariables: {
      AWS_DEPLOY_ROLE_ARN: deployRole,
      AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN: executionRole,
    },
    reviewedArns: {
      githubDeployRoleArn: deployRole,
      cloudFormationExecutionRoleArn: executionRole,
    },
    githubEnvironmentInstructions: [
      [
        'gh',
        'variable',
        'set',
        'AWS_DEPLOY_ROLE_ARN',
        '--repo',
        `${owner}/${repository}`,
        '--env',
        github?.environment ?? '',
        '--body',
        deployRole,
      ],
      [
        'gh',
        'variable',
        'set',
        'AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN',
        '--repo',
        `${owner}/${repository}`,
        '--env',
        github?.environment ?? '',
        '--body',
        executionRole,
      ],
    ],
  }
}
