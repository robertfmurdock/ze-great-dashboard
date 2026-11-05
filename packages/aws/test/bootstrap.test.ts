// biome-ignore-all lint/suspicious/noTemplateCurlyInString: CloudFormation substitution names are literal artifact data.
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it } from 'vitest'
import {
  bootstrapConsistency,
  bootstrapContractVersion,
  bootstrapPlan,
  bootstrapTemplate,
  bootstrapTemplateRevision,
  coreBootstrapOutputs,
  deployedBootstrapStack,
  mergeBootstrapParameters,
  parseCloudFormationTemplate,
  requiredBootstrapParameters,
  resolveComputeMode,
} from '../src/index.ts'

type PolicyStatement = {
  Sid?: string
  Action?: string | string[]
  Condition?: Record<string, Record<string, unknown>>
  Resource?: unknown
}

function policyStatements(
  template: ReturnType<typeof parseCloudFormationTemplate>,
  resource: string,
): PolicyStatement[] {
  const properties = template.Resources?.[resource] as
    | { Properties?: { Policies?: { PolicyDocument?: { Statement?: PolicyStatement[] } }[] } }
    | undefined
  return (
    properties?.Properties?.Policies?.flatMap(
      ({ PolicyDocument }) => PolicyDocument?.Statement ?? [],
    ) ?? []
  )
}

function throws<Input>(action: (input: Input) => unknown) {
  return (input: Input) => {
    try {
      action(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected the exercise to throw')
  }
}
describe('template metadata and parsing', () => {
  const templateFixture = () => {
    const template = `
Metadata:
  PackageManagedParameters:
    - Managed
Parameters:
  Managed:
    Type: String
Resources:
  Example:
    Type: AWS::IAM::Role
    Properties:
      Policies:
        - PolicyDocument:
            Statement:
              - Action:
                  - sts:AssumeRole
                  - sts:TagSession
Outputs:
  BootstrapContractVersion:
    Value: "2"
  BootstrapTemplateRevision:
    Value: "2.4"
`
    return { template }
  }
  it(
    'reads the contract version independent of YAML formatting',
    mint({
      setup: templateFixture,
      exercise: ({ template }) => bootstrapContractVersion(template),
      verify: (version) => expect(version).toBe('2'),
    }),
  )
  it(
    'reads the revision independent of YAML formatting',
    mint({
      setup: templateFixture,
      exercise: ({ template }) => bootstrapTemplateRevision(template),
      verify: (revision) => expect(revision).toBe('2.4'),
    }),
  )
  it(
    'parses declared CloudFormation parameters',
    mint({
      setup: templateFixture,
      exercise: ({ template }) => parseCloudFormationTemplate(template),
      verify: (document) => expect(document.Parameters).toHaveProperty('Managed'),
    }),
  )
})
describe('compute mode resolution', () => {
  for (const scenario of [
    { input: {}, expected: 'lambda' },
    { input: { artifact: 'ecs', explicit: 'ecs' }, expected: 'ecs' },
    { input: { artifact: 'ecs' }, expected: 'ecs' },
    { input: { persisted: 'ecs', artifact: 'ecs', explicit: 'ecs' }, expected: 'ecs' },
  ] as const)
    it(
      `resolves ${JSON.stringify(scenario.input)} to ${scenario.expected}`,
      mint({
        setup: () => scenario,
        exercise: ({ input }) => resolveComputeMode(input),
        verify: (mode, { expected }) => expect(mode).toBe(expected),
      }),
    )
  for (const scenario of [
    { input: { persisted: 'ecs', artifact: 'lambda' }, message: 'regenerate the bootstrap' },
    { input: { persisted: 'lambda', explicit: 'ecs' }, message: 'explicit mode ecs' },
  ] as const)
    it(
      `rejects conflicting mode selectors: ${scenario.message}`,
      mint({
        setup: () => scenario,
        exercise: throws(({ input }) => resolveComputeMode(input)),
        verify: (error, { message }) => {
          expect(error).toBeInstanceOf(Error)
          expect((error as Error).message).toContain(message)
        },
      }),
    )
})
describe('installed template inspection', () => {
  it(
    'reports installed template provenance and scoped IAM actions without external state',
    mint({
      setup: () => ({ region: 'us-east-1' }),
      exercise: (config) => bootstrapPlan(config),
      verify: (plan) => {
        expect(plan.packageVersion).toBe('0.0.0-dev')
        expect(plan.packageTemplates).toHaveLength(2)
        expect(plan.packageTemplates.find(({ kind }) => kind === 'core')?.sha256).toMatch(
          /^[a-f0-9]{64}$/,
        )
        expect(plan.packageTemplates.find(({ kind }) => kind === 'core')?.resources).toEqual(
          expect.arrayContaining([{ logicalId: 'ArtifactBucket', type: 'AWS::S3::Bucket' }]),
        )
        expect(
          plan.packageTemplates.find(({ kind }) => kind === 'github-oidc')?.iamActions,
        ).toContain('sts:AssumeRoleWithWebIdentity')
        expect(plan.notes.join(' ')).toContain('no AWS or GitHub mutations')
      },
    }),
  )
})
describe('deployed parameter consistency', () => {
  it(
    'detects live bootstrap inconsistency, including removed optional configuration',
    mint({
      setup: () => ({
        args: [
          'core',
          {
            region: 'us-east-1',
            core: {
              stackName: 'team-bootstrap',
              artifactBucketName: 'expected',
              applicationStackName: 'team',
              dashboardFunctionName: 'team',
            },
          },
          {
            StackName: 'team-bootstrap',
            StackId: 'arn:aws:cloudformation:us-east-1:123:stack/team-bootstrap/id',
            StackStatus: 'UPDATE_COMPLETE',
            Parameters: [
              { ParameterKey: 'ArtifactBucketName', ParameterValue: 'wrong' },
              { ParameterKey: 'ApplicationStackName', ParameterValue: 'team' },
              { ParameterKey: 'DashboardFunctionName', ParameterValue: 'team' },
              { ParameterKey: 'RuntimeSecretArn', ParameterValue: 'arn:old-secret' },
              { ParameterKey: 'ArtifactKmsKeyArn', ParameterValue: '' },
            ],
            Outputs: [
              { OutputKey: 'BootstrapContractVersion', OutputValue: '1' },
              { OutputKey: 'BootstrapTemplateRevision', OutputValue: '1.3' },
              { OutputKey: 'ArtifactBucketName', OutputValue: 'wrong' },
              { OutputKey: 'ApplicationStackName', OutputValue: 'team' },
              { OutputKey: 'CloudFormationExecutionRoleArn', OutputValue: 'arn:role' },
            ],
          },
          '1',
          '1.3',
        ] satisfies Parameters<typeof bootstrapConsistency>,
      }),
      exercise: ({ args }) => bootstrapConsistency(...args),
      verify: (result) => {
        expect(result.ok).toBe(false)
        expect(result.mismatches).toContain('ArtifactBucketName is wrong; expected expected')
        expect(result.mismatches).toContain('RuntimeSecretArn is arn:old-secret; expected ')
      },
    }),
  )
})
describe('installed core template declarations', () => {
  it(
    'declares a private retained artifact bucket and restricted execution role',
    mint({
      setup: async () => ({ template: await bootstrapTemplate('core') }),
      exercise: ({ template }) => parseCloudFormationTemplate(template),
      verify: (document) => {
        expect(document.Outputs).toMatchObject({
          BootstrapContractVersion: { Value: '1' },
          BootstrapTemplateRevision: { Value: '1.3' },
        })
        expect(document.Resources?.ArtifactBucket).toMatchObject({
          Properties: {
            OwnershipControls: { Rules: [{ ObjectOwnership: 'BucketOwnerEnforced' }] },
            PublicAccessBlockConfiguration: {
              BlockPublicAcls: true,
              BlockPublicPolicy: true,
              RestrictPublicBuckets: true,
            },
          },
        })
        expect(document.Resources?.ArtifactBucketPolicy).toMatchObject({
          Properties: {
            PolicyDocument: {
              Statement: expect.arrayContaining([
                expect.objectContaining({
                  Sid: 'DenyInsecureTransport',
                  Effect: 'Deny',
                  Condition: { Bool: { 'aws:SecureTransport': false } },
                }),
              ]),
            },
          },
        })
        const statements = policyStatements(document, 'CloudFormationExecutionRole')
        expect(statements.find(({ Sid }) => Sid === 'ReadLambdaArtifact')?.Resource).toBe(
          '${ArtifactBucket.Arn}/lambda/*',
        )
        expect(statements.find(({ Sid }) => Sid === 'PassRuntimeRoleToLambdaOnly')).toMatchObject({
          Resource:
            'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${DashboardFunctionName}-server',
          Condition: { StringEquals: { 'iam:PassedToService': 'lambda.amazonaws.com' } },
        })
        expect(statements.flatMap(({ Action }) => Action ?? [])).not.toContain('iam:*')
        expect(statements.flatMap(({ Action }) => Action ?? [])).not.toContain('s3:*')
        expect(document.Parameters).not.toHaveProperty('RuntimeRoleName')
        expect(statements).toContainEqual([
          'HasRuntimeSecret',
          expect.objectContaining({ Action: 'ssm:GetParameter', Resource: 'RuntimeSecretArn' }),
          'AWS::NoValue',
        ])
        expect(statements).toContainEqual([
          'HasRuntimeSecret',
          expect.objectContaining({
            Action: 'kms:Decrypt',
            Condition: {
              StringEquals: {
                'kms:ViaService': 'ssm.${AWS::Region}.amazonaws.com',
                'kms:EncryptionContext:PARAMETER_ARN': 'RuntimeSecretArn',
              },
            },
          }),
          'AWS::NoValue',
        ])
      },
    }),
  )
})
describe('installed GitHub OIDC template declarations', () => {
  it(
    'declares immutable subject admission and scoped deployment and diagnostic permissions',
    mint({
      setup: async () => ({ template: await bootstrapTemplate('github-oidc') }),
      exercise: ({ template }) => parseCloudFormationTemplate(template),
      verify: (document) => {
        expect(document.Outputs).toMatchObject({
          BootstrapContractVersion: { Value: '2' },
          BootstrapTemplateRevision: { Value: '2.3' },
        })
        expect(document.Resources?.GitHubDeployRole).toMatchObject({
          Properties: {
            AssumeRolePolicyDocument: {
              Statement: [
                expect.objectContaining({
                  Principal: { Federated: 'GitHubOidcProviderArn' },
                  Condition: {
                    StringEquals: {
                      'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                      'token.actions.githubusercontent.com:sub': expect.arrayContaining([
                        'repo:${Owner}@${GitHubOwnerId}/${Repository}@${GitHubRepositoryId}:environment:${GitHubEnvironment}',
                      ]),
                    },
                  },
                }),
              ],
            },
          },
        })
        const statements = policyStatements(document, 'GitHubDeployRole')
        expect(statements.find(({ Sid }) => Sid === 'UploadLambdaArtifacts')?.Resource).toBe(
          'arn:${AWS::Partition}:s3:::${ArtifactBucketName}/lambda/*',
        )
        expect(statements.find(({ Sid }) => Sid === 'OperateOneApplicationStack')?.Resource).toBe(
          'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${ApplicationStackName}/*',
        )
        expect(statements.find(({ Sid }) => Sid === 'PassCoreExecutionRole')).toMatchObject({
          Action: 'iam:PassRole',
          Resource: 'CloudFormationExecutionRoleArn',
        })
        expect(statements.find(({ Sid }) => Sid === 'InspectBootstrapStacks')).toMatchObject({
          Action: [
            'cloudformation:DescribeStacks',
            'cloudformation:DetectStackDrift',
            'cloudformation:DescribeStackResourceDrifts',
          ],
          Resource: [
            'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${CoreBootstrapStackName}/*',
            'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${AWS::StackName}/*',
          ],
        })
        expect(
          statements.find(({ Sid }) => Sid === 'ReadBootstrapDriftDetectionStatus'),
        ).toMatchObject({
          Action: 'cloudformation:DescribeStackDriftDetectionStatus',
          Resource: '*',
        })
        expect(statements.filter(({ Resource }) => Resource === '*')).toHaveLength(1)
        expect(
          statements.find(({ Sid }) => Sid === 'InspectBootstrapBucketConfiguration')?.Resource,
        ).toBe('arn:${AWS::Partition}:s3:::${ArtifactBucketName}')
        expect(
          statements.find(({ Sid }) => Sid === 'InspectBootstrapRoleConfiguration')?.Resource,
        ).toContain(
          'arn:${AWS::Partition}:iam::${AWS::AccountId}:role/${ApplicationStackName}-github-deploy',
        )
        expect(statements).toContainEqual([
          'HasConsumerGatewayStack',
          expect.objectContaining({
            Sid: 'ReadConsumerGatewayStack',
            Action: 'cloudformation:DescribeStacks',
            Resource:
              'arn:${AWS::Partition}:cloudformation:${AWS::Region}:${AWS::AccountId}:stack/${ConsumerGatewayStackName}/*',
          }),
          'AWS::NoValue',
        ])
        expect(statements.flatMap(({ Action }) => Action ?? [])).not.toContain('cloudformation:*')
      },
    }),
  )
})
describe('bootstrap parameter and capture contracts', () => {
  for (const scenario of [
    { kind: 'core', missing: 'ArtifactBucketName' },
    { kind: 'github-oidc', missing: 'GitHubOwnerId' },
  ] as const)
    it(
      `requires ${scenario.missing} for ${scenario.kind}`,
      mint({
        setup: () => scenario,
        exercise: throws(({ kind }) => requiredBootstrapParameters(kind, {})),
        verify: (error, { missing }) => expect((error as Error).message).toContain(missing),
      }),
    )
  it(
    'preserves the optional consumer gateway stack parameter',
    mint({
      setup: () => ({
        values: {
          GitHubOidcProviderArn: 'arn:aws:iam::123:oidc-provider/example',
          GitHubRepository: 'owner/repo',
          GitHubOwnerId: '1',
          GitHubRepositoryId: '2',
          GitHubEnvironment: 'production',
          CoreBootstrapStackName: 'app-bootstrap',
          ApplicationStackName: 'app',
          ArtifactBucketName: 'bucket',
          CloudFormationExecutionRoleArn: 'arn:role',
          ConsumerGatewayStackName: 'gateway',
        },
      }),
      exercise: ({ values }) => requiredBootstrapParameters('github-oidc', values),
      verify: (parameters, { values }) =>
        expect(parameters).toContainEqual({
          ParameterKey: 'ConsumerGatewayStackName',
          ParameterValue: values.ConsumerGatewayStackName,
        }),
    }),
  )
  it(
    'preserves an explicitly empty credential parameter',
    mint({
      setup: () => ({
        values: {
          ArtifactBucketName: 'bucket',
          ApplicationStackName: 'stack',
          DashboardFunctionName: 'function',
          RuntimeSecretArn: '',
          ArtifactKmsKeyArn: 'arn:key',
        },
      }),
      exercise: ({ values }) => requiredBootstrapParameters('core', values),
      verify: (parameters, { values }) =>
        expect(parameters).toContainEqual({
          ParameterKey: 'RuntimeSecretArn',
          ParameterValue: values.RuntimeSecretArn,
        }),
    }),
  )
  it(
    'overrides a deployed credential with an explicitly empty desired value',
    mint({
      setup: () => ({
        desired: [{ ParameterKey: 'RuntimeSecretArn', ParameterValue: '' }],
        deployed: [{ ParameterKey: 'RuntimeSecretArn', ParameterValue: 'old' }],
      }),
      exercise: ({ desired, deployed }) => mergeBootstrapParameters(desired, deployed),
      verify: (parameters, { desired }) => expect(parameters).toContainEqual(desired[0]),
    }),
  )
  it(
    'reads parameters from a valid captured stack',
    mint({
      setup: () => ({
        capture: {
          Parameters: [{ ParameterKey: 'ArtifactBucketName', ParameterValue: 'bucket' }],
          Outputs: [{ OutputKey: 'BootstrapContractVersion', OutputValue: '1' }],
        },
      }),
      exercise: ({ capture }) => deployedBootstrapStack(capture, '1'),
      verify: (stack, { capture }) => expect(stack.Parameters).toEqual(capture.Parameters),
    }),
  )
  it(
    'projects the required core outputs from a valid capture',
    mint({
      setup: () => ({
        stack: deployedBootstrapStack(
          {
            Outputs: [
              { OutputKey: 'BootstrapContractVersion', OutputValue: '1' },
              { OutputKey: 'ArtifactBucketName', OutputValue: 'bucket' },
              { OutputKey: 'ApplicationStackName', OutputValue: 'app' },
              { OutputKey: 'CloudFormationExecutionRoleArn', OutputValue: 'arn:role' },
            ],
          },
          '1',
        ),
      }),
      exercise: ({ stack }) => coreBootstrapOutputs(stack),
      verify: (outputs) =>
        expect(outputs).toMatchObject({
          ArtifactBucketName: 'bucket',
          CloudFormationExecutionRoleArn: 'arn:role',
        }),
    }),
  )
  it(
    'rejects a capture without the contract output',
    mint({
      setup: () => ({ capture: { Outputs: [] } }),
      exercise: throws(({ capture }) => deployedBootstrapStack(capture, '1')),
      verify: (error) => expect((error as Error).message).toContain('contract mismatch'),
    }),
  )
})
