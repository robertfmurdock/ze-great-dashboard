import { describe, expect, it } from 'vitest'
import {
  type BootstrapCheckDependencies,
  type BootstrapConfig,
  checkBootstrap,
  formatBootstrapCheckText,
} from '../src/index.ts'

const config: BootstrapConfig = {
  region: 'us-east-1',
  core: {
    stackName: 'dashboard-bootstrap',
    artifactBucketName: 'dashboard-artifacts',
    applicationStackName: 'dashboard',
    dashboardFunctionName: 'dashboard',
  },
  githubOidc: {
    stackName: 'dashboard-github-bootstrap',
    providerArn: 'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
    repository: 'example/dashboard',
    ownerId: '1',
    repositoryId: '2',
    environment: 'production',
  },
}

const executionRole = 'arn:aws:iam::123456789012:role/dashboard-execution'

function stack(kind: 'core' | 'github-oidc') {
  if (kind === 'core')
    return {
      StackName: config.core?.stackName,
      StackId: `arn:aws:cloudformation:us-east-1:123456789012:stack/${config.core?.stackName}/id`,
      StackStatus: 'UPDATE_COMPLETE',
      Parameters: [
        { ParameterKey: 'ArtifactBucketName', ParameterValue: config.core?.artifactBucketName },
        { ParameterKey: 'ApplicationStackName', ParameterValue: config.core?.applicationStackName },
        {
          ParameterKey: 'DashboardFunctionName',
          ParameterValue: config.core?.dashboardFunctionName,
        },
        { ParameterKey: 'RuntimeSecretArn', ParameterValue: '' },
        { ParameterKey: 'ArtifactKmsKeyArn', ParameterValue: '' },
      ],
      Outputs: [
        { OutputKey: 'BootstrapContractVersion', OutputValue: '1' },
        { OutputKey: 'BootstrapTemplateRevision', OutputValue: '1.3' },
        { OutputKey: 'ArtifactBucketName', OutputValue: config.core?.artifactBucketName },
        { OutputKey: 'ApplicationStackName', OutputValue: config.core?.applicationStackName },
        { OutputKey: 'CloudFormationExecutionRoleArn', OutputValue: executionRole },
      ],
    }
  return {
    StackName: config.githubOidc?.stackName,
    StackId: `arn:aws:cloudformation:us-east-1:123456789012:stack/${config.githubOidc?.stackName}/id`,
    StackStatus: 'UPDATE_COMPLETE',
    Parameters: [
      { ParameterKey: 'GitHubOidcProviderArn', ParameterValue: config.githubOidc?.providerArn },
      { ParameterKey: 'GitHubRepository', ParameterValue: config.githubOidc?.repository },
      { ParameterKey: 'GitHubOwnerId', ParameterValue: config.githubOidc?.ownerId },
      { ParameterKey: 'GitHubRepositoryId', ParameterValue: config.githubOidc?.repositoryId },
      { ParameterKey: 'GitHubEnvironment', ParameterValue: config.githubOidc?.environment },
      { ParameterKey: 'CoreBootstrapStackName', ParameterValue: config.core?.stackName },
      { ParameterKey: 'ApplicationStackName', ParameterValue: config.core?.applicationStackName },
      { ParameterKey: 'ArtifactBucketName', ParameterValue: config.core?.artifactBucketName },
      { ParameterKey: 'CloudFormationExecutionRoleArn', ParameterValue: executionRole },
      { ParameterKey: 'ConsumerGatewayStackName', ParameterValue: '' },
    ],
    Outputs: [
      { OutputKey: 'BootstrapContractVersion', OutputValue: '2' },
      { OutputKey: 'BootstrapTemplateRevision', OutputValue: '2.3' },
      {
        OutputKey: 'GitHubDeployRoleArn',
        OutputValue: 'arn:aws:iam::123456789012:role/dashboard-github-deploy',
      },
    ],
  }
}

function stackName(args: string[]): string {
  return args[args.indexOf('--stack-name') + 1] as string
}

function dependencies(driftStatus: 'IN_SYNC' | 'DRIFTED' = 'IN_SYNC'): BootstrapCheckDependencies {
  return {
    async execute(command, args) {
      expect(command).toBe('aws')
      if (args[1] === 'describe-stacks')
        return JSON.stringify({
          Stacks: [stack(stackName(args) === config.core?.stackName ? 'core' : 'github-oidc')],
        })
      if (args[1] === 'detect-stack-drift')
        return JSON.stringify({ StackDriftDetectionId: `detection-${stackName(args)}` })
      if (args[1] === 'describe-stack-drift-detection-status')
        return JSON.stringify({
          DetectionStatus: 'DETECTION_COMPLETE',
          StackDriftStatus: driftStatus,
        })
      if (args[1] === 'describe-stack-resource-drifts')
        return JSON.stringify({
          StackResourceDrifts: [
            {
              LogicalResourceId: 'GitHubDeployRole',
              ResourceType: 'AWS::IAM::Role',
              StackResourceDriftStatus: 'MODIFIED',
              PropertyDifferences: [
                {
                  PropertyPath: '/Policies/0',
                  DifferenceType: 'NOT_EQUAL',
                  ExpectedValue: 'expected',
                  ActualValue: 'actual',
                },
              ],
            },
          ],
        })
      throw new Error(`unexpected command: ${args.join(' ')}`)
    },
  }
}

describe('canonical bootstrap consistency check', () => {
  it('checks both live stacks without invoking resource drift by default', async () => {
    const calls: string[][] = []
    const base = dependencies()
    const result = await checkBootstrap(
      config,
      {},
      {
        async execute(command, args) {
          calls.push([command, ...args])
          return base.execute(command, args)
        },
      },
    )
    expect(result.ok).toBe(true)
    expect(result.stacks.map(({ kind }) => kind)).toEqual(['core', 'github-oidc'])
    expect(calls.map(([, , operation]) => operation)).toEqual([
      'describe-stacks',
      'describe-stacks',
    ])
    expect(JSON.parse(JSON.stringify(result))).toMatchObject({ ok: true })
    expect(formatBootstrapCheckText(result)).toContain(
      'PASS github-oidc: dashboard-github-bootstrap (UPDATE_COMPLETE)',
    )
    expect(result.remediation.affectedStacks).toHaveLength(2)
    expect(result.remediation.revalidateCommand).toContain('bootstrap check --config manifest.json')
    expect(formatBootstrapCheckText(result)).toContain('Safety: AWS mutations are emitted')
  })

  it('reports drifted resources and fails the optional full drift check', async () => {
    const result = await checkBootstrap(config, { resourceDrift: true }, dependencies('DRIFTED'))
    expect(result.ok).toBe(false)
    expect(result.stacks[0]?.resourceDrift).toMatchObject({ status: 'DRIFTED', ok: false })
    expect(result.stacks[0]?.resourceDrift?.resources[0]).toMatchObject({
      logicalId: 'GitHubDeployRole',
      resourceType: 'AWS::IAM::Role',
    })
    expect(result.stacks[0]?.resourceDrift?.resources[0]?.differences[0]?.path).toBe('/Policies/0')
    expect(result.remediation.affectedStacks).toContainEqual(
      expect.objectContaining({ kind: 'core', issue: 'resource drift: DRIFTED' }),
    )
  })

  it('reports inaccessible stacks as failed consistency rather than throwing away the report', async () => {
    const base = dependencies()
    const result = await checkBootstrap(
      config,
      {},
      {
        async execute(command, args) {
          if (args[1] === 'describe-stacks' && stackName(args) === config.githubOidc?.stackName)
            throw new Error('AccessDenied')
          return base.execute(command, args)
        },
      },
    )
    expect(result.ok).toBe(false)
    expect(result.stacks[1]?.consistency.mismatches).toContain(
      'unable to describe stack: AccessDenied',
    )
  })

  it('times out resource drift after ten minutes', async () => {
    const base = dependencies()
    let now = 0
    const result = await checkBootstrap(
      config,
      { resourceDrift: true },
      {
        ...base,
        now: () => now,
        async sleep(milliseconds) {
          now += milliseconds
        },
        async execute(command, args) {
          if (args[1] === 'describe-stack-drift-detection-status')
            return JSON.stringify({ DetectionStatus: 'DETECTION_IN_PROGRESS' })
          return base.execute(command, args)
        },
      },
    )
    expect(result.ok).toBe(false)
    expect(result.stacks[0]?.resourceDrift).toMatchObject({ status: 'TIMED_OUT' })
  })

  it('reports a CloudFormation drift-detection failure', async () => {
    const base = dependencies()
    const result = await checkBootstrap(
      config,
      { resourceDrift: true },
      {
        ...base,
        async execute(command, args) {
          if (args[1] === 'describe-stack-drift-detection-status')
            return JSON.stringify({
              DetectionStatus: 'DETECTION_FAILED',
              DetectionStatusReason: 'insufficient permissions',
            })
          return base.execute(command, args)
        },
      },
    )
    expect(result.ok).toBe(false)
    expect(result.stacks[0]?.resourceDrift).toMatchObject({
      status: 'DETECTION_FAILED',
      reason: 'insufficient permissions',
    })
  })
})
