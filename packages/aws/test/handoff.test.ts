import { describe, expect, it } from 'vitest'
import {
  type BootstrapConfig,
  bootstrapHandoff,
  githubOidcProvider,
  verifyBootstrap,
} from '../src/index.ts'

const config: BootstrapConfig = {
  region: 'us-east-1',
  core: {
    stackName: 'dashboard-core',
    artifactBucketName: 'dashboard-artifacts-123456789012',
    applicationStackName: 'dashboard',
    dashboardFunctionName: 'dashboard',
  },
  githubOidc: {
    stackName: 'dashboard-github',
    providerArn: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
    repository: 'example/dashboard',
    ownerId: '1234',
    repositoryId: '5678',
    environment: 'production',
  },
}

const coreStack = {
  Stacks: [
    {
      StackName: 'dashboard-core',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/dashboard-core/id',
      Parameters: [
        { ParameterKey: 'ArtifactBucketName', ParameterValue: config.core?.artifactBucketName },
        { ParameterKey: 'ApplicationStackName', ParameterValue: config.core?.applicationStackName },
        {
          ParameterKey: 'DashboardFunctionName',
          ParameterValue: config.core?.dashboardFunctionName,
        },
      ],
      Outputs: [
        { OutputKey: 'BootstrapContractVersion', OutputValue: '1' },
        { OutputKey: 'ArtifactBucketName', OutputValue: config.core?.artifactBucketName },
        { OutputKey: 'ApplicationStackName', OutputValue: config.core?.applicationStackName },
        {
          OutputKey: 'CloudFormationExecutionRoleArn',
          OutputValue: 'arn:aws:iam::123456789012:role/dashboard-execution',
        },
      ],
    },
  ],
}

const oidcStack = {
  Stacks: [
    {
      StackName: 'dashboard-github',
      StackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/dashboard-github/id',
      Parameters: [
        { ParameterKey: 'GitHubOidcProviderArn', ParameterValue: config.githubOidc?.providerArn },
        { ParameterKey: 'GitHubRepository', ParameterValue: config.githubOidc?.repository },
        { ParameterKey: 'GitHubOwnerId', ParameterValue: config.githubOidc?.ownerId },
        { ParameterKey: 'GitHubRepositoryId', ParameterValue: config.githubOidc?.repositoryId },
        { ParameterKey: 'GitHubEnvironment', ParameterValue: config.githubOidc?.environment },
        { ParameterKey: 'ApplicationStackName', ParameterValue: config.core?.applicationStackName },
        { ParameterKey: 'ArtifactBucketName', ParameterValue: config.core?.artifactBucketName },
        {
          ParameterKey: 'CloudFormationExecutionRoleArn',
          ParameterValue: 'arn:aws:iam::123456789012:role/dashboard-execution',
        },
      ],
      Outputs: [
        { OutputKey: 'BootstrapContractVersion', OutputValue: '2' },
        {
          OutputKey: 'GitHubDeployRoleArn',
          OutputValue: 'arn:aws:iam::123456789012:role/dashboard-github-deploy',
        },
      ],
    },
  ],
}

describe('manifest-driven bootstrap handoff', () => {
  it('emits a stable, explicit core plan for a fresh manifest', async () => {
    const handoff = await bootstrapHandoff({ config, configPath: 'dashboard-bootstrap.json' })
    expect(handoff.phase).toBe('core')
    expect(handoff.expectedContracts).toEqual({ core: '1', githubOidc: '2' })
    expect(handoff.expectedOutputs).toEqual([
      'BootstrapContractVersion',
      'ArtifactBucketName',
      'ApplicationStackName',
      'CloudFormationExecutionRoleArn',
    ])
    expect(handoff.commands.map(({ name }) => name)).toEqual([
      'generate-parameters',
      'create-change-set',
      'wait-for-change-set',
      'review-change-set',
      'execute-reviewed-change-set',
      'wait-for-stack',
      'capture-stack',
    ])
    expect(handoff.commands.find(({ name }) => name === 'create-change-set')?.args).toContain(
      'CAPABILITY_NAMED_IAM',
    )
  })

  it('moves to the OIDC adapter from a captured core stack without making a GitHub mutation', async () => {
    const calls: string[] = []
    const handoff = await bootstrapHandoff({
      config,
      configPath: 'dashboard-bootstrap.json',
      coreStack,
      coreStackPath: 'captures/approved-core.json',
      runner: {
        async execute(command, args) {
          calls.push(`${command} ${args.join(' ')}`)
          return JSON.stringify({ use_default: true })
        },
      },
    })
    expect(handoff.phase).toBe('github-oidc')
    expect(handoff.requiredCapturedFiles).toEqual(['captures/approved-core.json'])
    expect(handoff.commands[0]?.args).toContain('captures/approved-core.json')
    expect(handoff.prerequisite?.status).toBe('immutable-subject-required')
    expect(handoff.expectedOutputs).toEqual([
      'BootstrapContractVersion',
      'BootstrapTemplateRevision',
      'GitHubDeployRoleArn',
    ])
    expect(calls).toEqual(['gh api repos/example/dashboard/actions/oidc/customization/sub'])
    expect(handoff.commands.flatMap(({ args }) => args)).not.toContain('execute')
  })

  it('classifies immutable GitHub subjects as ready or unverified without blocking offline planning', async () => {
    await expect(
      githubOidcProvider.prerequisite(config, {
        async execute() {
          return JSON.stringify({
            use_default: false,
            include_claim_keys: [
              'repository_owner',
              'repository_owner_id',
              'repository',
              'repository_id',
              'context',
            ],
          })
        },
      }),
    ).resolves.toMatchObject({ status: 'ready', blocking: false })
    await expect(
      githubOidcProvider.prerequisite(config, {
        async execute() {
          throw new Error('not found')
        },
      }),
    ).resolves.toMatchObject({ status: 'unverified', blocking: false })
  })

  it('requires valid captured contracts and returns only reviewed environment handoff values', async () => {
    const result = await verifyBootstrap({ config, coreStack, githubOidcStack: oidcStack })
    expect(result.environmentVariables).toEqual({
      AWS_DEPLOY_ROLE_ARN: 'arn:aws:iam::123456789012:role/dashboard-github-deploy',
      AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN: 'arn:aws:iam::123456789012:role/dashboard-execution',
    })
    expect(result.immutableSubject).toBe('repo:example@1234/dashboard@5678:environment:production')
    expect(result.githubEnvironmentInstructions).toHaveLength(2)
    expect(result.githubEnvironmentInstructions[0]?.slice(0, 3)).toEqual(['gh', 'variable', 'set'])
    await expect(
      verifyBootstrap({
        config,
        coreStack,
        githubOidcStack: { ...oidcStack, Stacks: [{ ...oidcStack.Stacks[0], Outputs: [] }] },
      }),
    ).rejects.toThrow('Bootstrap contract mismatch')
    await expect(
      verifyBootstrap({
        config,
        coreStack: {
          ...coreStack,
          Stacks: [
            {
              ...coreStack.Stacks[0],
              StackId: 'arn:aws:cloudformation:eu-west-1:123456789012:stack/dashboard-core/id',
            },
          ],
        },
        githubOidcStack: oidcStack,
      }),
    ).rejects.toThrow('Core stack Region mismatch')
  })
})
