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

describe('AWS consumer bootstrap contract', () => {
  it('inspects CloudFormation metadata independent of YAML presentation', () => {
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

    expect(bootstrapContractVersion(template)).toBe('2')
    expect(bootstrapTemplateRevision(template)).toBe('2.4')
    expect(parseCloudFormationTemplate(template).Parameters).toHaveProperty('Managed')
  })

  it('has one authoritative mode resolver for manifests, artifacts, and CLI assertions', () => {
    expect(resolveComputeMode()).toBe('lambda')
    expect(resolveComputeMode({ artifact: 'ecs', explicit: 'ecs' })).toBe('ecs')
    expect(resolveComputeMode({ artifact: 'ecs' })).toBe('ecs')
    expect(resolveComputeMode({ persisted: 'ecs', artifact: 'ecs', explicit: 'ecs' })).toBe('ecs')
    expect(() => resolveComputeMode({ persisted: 'ecs', artifact: 'lambda' })).toThrow(
      /regenerate the bootstrap/,
    )
    expect(() => resolveComputeMode({ persisted: 'lambda', explicit: 'ecs' })).toThrow(
      /explicit mode ecs/,
    )
  })
  it('reports installed template provenance and scoped IAM actions without external state', async () => {
    const plan = await bootstrapPlan({ region: 'us-east-1' })
    expect(plan.packageVersion).toBe('0.0.0-dev')
    expect(plan.packageTemplates).toHaveLength(2)
    expect(plan.packageTemplates.find(({ kind }) => kind === 'core')?.sha256).toMatch(
      /^[a-f0-9]{64}$/,
    )
    expect(plan.packageTemplates.find(({ kind }) => kind === 'core')?.resources).toEqual(
      expect.arrayContaining([{ logicalId: 'ArtifactBucket', type: 'AWS::S3::Bucket' }]),
    )
    expect(plan.packageTemplates.find(({ kind }) => kind === 'github-oidc')?.iamActions).toContain(
      'sts:AssumeRoleWithWebIdentity',
    )
    expect(plan.notes.join(' ')).toContain('no AWS or GitHub mutations')
  })

  it('detects live bootstrap inconsistency, including removed optional configuration', async () => {
    const result = bootstrapConsistency(
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
    )
    expect(result.ok).toBe(false)
    expect(result.mismatches).toContain('ArtifactBucketName is wrong; expected expected')
    expect(result.mismatches).toContain('RuntimeSecretArn is arn:old-secret; expected ')
  })

  it('locks down the core artifact bucket and execution role', async () => {
    const template = await bootstrapTemplate('core')
    const document = parseCloudFormationTemplate(template)
    expect(bootstrapContractVersion(template)).toBe('1')
    expect(bootstrapTemplateRevision(template)).toBe('1.3')
    expect(template).toContain('BucketOwnerEnforced')
    expect(template).toContain('BlockPublicAcls: true')
    expect(template).toContain('BlockPublicPolicy: true')
    expect(template).toContain('RestrictPublicBuckets: true')
    expect(template).toContain('DenyInsecureTransport')
    const bucketPolicy = document.Resources?.ArtifactBucketPolicy as
      | { Properties?: { PolicyDocument?: { Statement?: PolicyStatement[] } } }
      | undefined
    expect(
      bucketPolicy?.Properties?.PolicyDocument?.Statement?.[0]?.Condition?.Bool?.[
        'aws:SecureTransport'
      ],
    ).toBe(false)
    expect(template).toMatch(/ArtifactBucket\.Arn}\/lambda\/\*/)
    expect(
      policyStatements(document, 'CloudFormationExecutionRole').find(
        ({ Sid }) => Sid === 'PassRuntimeRoleToLambdaOnly',
      )?.Condition?.StringEquals?.['iam:PassedToService'],
    ).toBe('lambda.amazonaws.com')
    expect(template).toMatch(/DashboardFunctionName}-server/)
    expect(template).not.toContain('RuntimeRoleName')
    expect(template).not.toMatch(/Effect: Allow[\s\S]*?Action: s3:\*/)
    expect(template).not.toContain('Action: iam:*')
    expect(template).toContain('ssm:GetParameter')
    expect(template).toContain('kms:EncryptionContext:PARAMETER_ARN')
  })

  it('requires the exact immutable GitHub repository/environment subject, audience, stack and prefix', async () => {
    const template = await bootstrapTemplate('github-oidc')
    const document = parseCloudFormationTemplate(template)
    expect(bootstrapContractVersion(template)).toBe('2')
    expect(bootstrapTemplateRevision(template)).toBe('2.3')
    expect(template).toContain('Federated: !Ref GitHubOidcProviderArn')
    const deployRole = document.Resources?.GitHubDeployRole as
      | { Properties?: { AssumeRolePolicyDocument?: { Statement?: PolicyStatement[] } } }
      | undefined
    const trustStatement = deployRole?.Properties?.AssumeRolePolicyDocument?.Statement?.[0]
    expect(
      trustStatement?.Condition?.StringEquals?.['token.actions.githubusercontent.com:aud'],
    ).toBe('sts.amazonaws.com')
    expect(template).toMatch(
      /repo:\$\{Owner}@\$\{GitHubOwnerId}\/\$\{Repository}@\$\{GitHubRepositoryId}:environment:\$\{GitHubEnvironment}/,
    )
    expect(template).toContain('/lambda/*')
    expect(template).toMatch(/stack\/\$\{ApplicationStackName}\/\*/)
    expect(template).toContain('PassCoreExecutionRole')
    expect(template).toContain('ReadConsumerGatewayStack')
    expect(template).toContain('InspectBootstrapStacks')
    expect(template).toContain('CoreBootstrapStackName')
    expect(template).toContain('DescribeStackDriftDetectionStatus')
    expect(template).toContain('ConsumerGatewayStackName')
    expect(template).not.toContain('Action: cloudformation:*')
    const diagnosticPolicy = template.match(
      /- Sid: InspectBootstrapStacks[\s\S]*?(?=\n {14}- Sid: ReadBootstrapDriftDetectionStatus)/,
    )?.[0]
    expect(diagnosticPolicy).toContain('cloudformation:DescribeStacks')
    expect(diagnosticPolicy).toContain('cloudformation:DetectStackDrift')
    expect(diagnosticPolicy).toContain('cloudformation:DescribeStackResourceDrifts')
    expect(diagnosticPolicy).toContain('stack/$' + '{CoreBootstrapStackName}/*')
    expect(diagnosticPolicy).toContain('stack/$' + '{AWS::StackName}/*')
    expect(
      policyStatements(document, 'GitHubDeployRole').filter(({ Resource }) => Resource === '*'),
    ).toHaveLength(1)
    expect(template).toContain('InspectBootstrapBucketConfiguration')
    expect(
      policyStatements(document, 'GitHubDeployRole').find(
        ({ Sid }) => Sid === 'InspectBootstrapBucketConfiguration',
      )?.Resource,
    ).toBe('arn:$' + '{AWS::Partition}:s3:::$' + '{ArtifactBucketName}')
    expect(template).toContain('InspectBootstrapRoleConfiguration')
    expect(
      policyStatements(document, 'GitHubDeployRole').find(
        ({ Sid }) => Sid === 'InspectBootstrapRoleConfiguration',
      )?.Resource,
    ).toContain(
      'arn:$' +
        '{AWS::Partition}:iam::$' +
        '{AWS::AccountId}:role/$' +
        '{ApplicationStackName}-github-deploy',
    )
  })

  it('requires inputs and reconciles explicitly defaulted parameters during upgrades', () => {
    expect(() => requiredBootstrapParameters('core', {})).toThrow('ArtifactBucketName')
    expect(() => requiredBootstrapParameters('github-oidc', {})).toThrow('GitHubOwnerId')
    expect(
      requiredBootstrapParameters('github-oidc', {
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
      }),
    ).toContainEqual({ ParameterKey: 'ConsumerGatewayStackName', ParameterValue: 'gateway' })
    const values = requiredBootstrapParameters('core', {
      ArtifactBucketName: 'bucket',
      ApplicationStackName: 'stack',
      DashboardFunctionName: 'function',
      RuntimeSecretArn: '',
      RuntimeRoleName: 'role',
      ArtifactKmsKeyArn: 'arn:key',
    })
    expect(values).toContainEqual({ ParameterKey: 'RuntimeSecretArn', ParameterValue: '' })
    expect(
      mergeBootstrapParameters(values, [
        { ParameterKey: 'RuntimeSecretArn', ParameterValue: 'old' },
      ]),
    ).toContainEqual({ ParameterKey: 'RuntimeSecretArn', ParameterValue: '' })
    expect(
      deployedBootstrapStack(
        {
          Parameters: [{ ParameterKey: 'ArtifactBucketName', ParameterValue: 'bucket' }],
          Outputs: [{ OutputKey: 'BootstrapContractVersion', OutputValue: '1' }],
        },
        '1',
      ).Parameters,
    ).toContainEqual({ ParameterKey: 'ArtifactBucketName', ParameterValue: 'bucket' })
    expect(
      coreBootstrapOutputs(
        deployedBootstrapStack(
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
      ),
    ).toMatchObject({ ArtifactBucketName: 'bucket', CloudFormationExecutionRoleArn: 'arn:role' })
    expect(() => deployedBootstrapStack({ Outputs: [] }, '1')).toThrow('contract mismatch')
  })
})
