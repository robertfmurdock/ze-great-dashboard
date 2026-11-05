import { mint } from '@continuous-excellence/testmints-js/vitest'
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
  describe('handoff planning', () => {
    it(
      'emits a stable, explicit core plan for a fresh manifest',
      mint({
        setup: () => {
          const input = { config, configPath: 'dashboard-bootstrap.json' } satisfies Parameters<
            typeof bootstrapHandoff
          >[0]
          return { input }
        },
        exercise: ({ input }) => bootstrapHandoff(input),
        verify: (handoff) => {
          expect(handoff.phase).toBe('core')
          expect(handoff.expectedContracts).toEqual({ core: '1', githubOidc: '2' })
          expect(handoff.expectedOutputs).toEqual([
            'BootstrapContractVersion',
            'BootstrapTemplateRevision',
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
          expect(handoff.remediation.upgradeSteps.join(' ')).toContain('reviewed UPDATE change set')
        },
      }),
    )

    it(
      'keeps generated parameters and captures in the requested disposable work directory',
      mint({
        setup: () => {
          const input = {
            config,
            configPath: 'dashboard-bootstrap.json',
            workDir: '.bootstrap-work',
          } satisfies Parameters<typeof bootstrapHandoff>[0]
          return { input }
        },
        exercise: ({ input }) => bootstrapHandoff(input),
        verify: (handoff, { input }) => {
          const parameterPath = `${input.workDir}/core-bootstrap.json`
          expect(handoff.parameterPath).toBe(parameterPath)
          expect(handoff.commands[0]?.args).toContain(parameterPath)
          expect(handoff.commands.at(-1)?.captureFile).toBe(
            `${input.workDir}/core-deployed-stack.json`,
          )
        },
      }),
    )

    it(
      'moves to the OIDC adapter from a captured core stack without making a GitHub mutation',
      mint({
        setup: () => {
          const calls: string[] = []
          const input = {
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
          } satisfies Parameters<typeof bootstrapHandoff>[0]
          return { input, calls }
        },
        exercise: ({ input }) => bootstrapHandoff(input),
        verify: (handoff, { calls }) => {
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
        },
      }),
    )

    it(
      'lists both captures after bootstrap completes',
      mint({
        setup: () => {
          const input = {
            config,
            configPath: 'dashboard-bootstrap.json',
            workDir: '.bootstrap-work',
            coreStack,
            githubOidcStack: oidcStack,
            provider: {
              name: 'test',
              async prerequisite() {
                return { status: 'ready', blocking: false, detail: 'ready' }
              },
            },
          } satisfies Parameters<typeof bootstrapHandoff>[0]
          return { input }
        },
        exercise: ({ input }) => bootstrapHandoff(input),
        verify: (complete, { input }) => {
          expect(complete.requiredCapturedFiles).toEqual([
            `${input.workDir}/core-deployed-stack.json`,
            `${input.workDir}/github-oidc-deployed-stack.json`,
          ])
        },
      }),
    )
  })

  describe('GitHub identity prerequisites', () => {
    it(
      'accepts a configured immutable GitHub subject',
      mint({
        setup: () => ({
          runner: {
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
          },
        }),
        exercise: ({ runner }) => githubOidcProvider.prerequisite(config, runner),
        verify: (result) => {
          expect(result).toMatchObject({ status: 'ready', blocking: false })
        },
      }),
    )

    it(
      'leaves unavailable GitHub identity discovery unverified',
      mint({
        setup: () => ({
          runner: {
            async execute() {
              throw new Error('not found')
            },
          },
        }),
        exercise: ({ runner }) => githubOidcProvider.prerequisite(config, runner),
        verify: (result) => {
          expect(result).toMatchObject({ status: 'unverified', blocking: false })
        },
      }),
    )
  })

  describe('captured-stack verification', () => {
    function rejects<Input>(action: (input: Input) => Promise<unknown>) {
      return async (input: Input) => {
        try {
          await action(input)
        } catch (error) {
          return error
        }
        throw new Error('Expected exercise to reject.')
      }
    }

    it(
      'requires valid captured contracts and returns only reviewed environment handoff values',
      mint({
        setup: () => {
          const input = { config, coreStack, githubOidcStack: oidcStack } satisfies Parameters<
            typeof verifyBootstrap
          >[0]
          return { input }
        },
        exercise: ({ input }) => verifyBootstrap(input),
        verify: (result) => {
          expect(result.environmentVariables).toEqual({
            AWS_DEPLOY_ROLE_ARN: 'arn:aws:iam::123456789012:role/dashboard-github-deploy',
            AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN:
              'arn:aws:iam::123456789012:role/dashboard-execution',
          })
          expect(result.immutableSubject).toBe(
            'repo:example@1234/dashboard@5678:environment:production',
          )
          expect(result.remediation.revalidateCommand).toContain('bootstrap check')
          expect(result.githubEnvironmentInstructions).toHaveLength(2)
          expect(result.githubEnvironmentInstructions[0]?.slice(0, 3)).toEqual([
            'gh',
            'variable',
            'set',
          ])
        },
      }),
    )

    it(
      'rejects missing captured OIDC contract outputs',
      mint({
        setup: () => ({
          input: {
            config,
            coreStack,
            githubOidcStack: { ...oidcStack, Stacks: [{ ...oidcStack.Stacks[0], Outputs: [] }] },
          },
        }),
        exercise: rejects(({ input }) => verifyBootstrap(input)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
          expect((error as Error).message).toContain('Bootstrap contract mismatch')
        },
      }),
    )

    it(
      'rejects a captured core stack in another Region',
      mint({
        setup: () => ({
          input: {
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
          },
        }),
        exercise: rejects(({ input }) => verifyBootstrap(input)),
        verify: (error) => {
          expect(error).toBeInstanceOf(Error)
          expect((error as Error).message).toContain('Core stack Region mismatch')
        },
      }),
    )
  })
})
