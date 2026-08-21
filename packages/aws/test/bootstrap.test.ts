import { describe, expect, it } from 'vitest'
import {
  bootstrapContractVersion,
  bootstrapTemplate,
  coreBootstrapOutputs,
  deployedBootstrapStack,
  mergeBootstrapParameters,
  requiredBootstrapParameters,
} from '../src/index.ts'

describe('AWS consumer bootstrap contract', () => {
  it('locks down the core artifact bucket and execution role', async () => {
    const template = await bootstrapTemplate('core')
    expect(bootstrapContractVersion(template)).toBe('1')
    expect(template).toContain('BucketOwnerEnforced')
    expect(template).toContain('BlockPublicAcls: true')
    expect(template).toContain('BlockPublicPolicy: true')
    expect(template).toContain('RestrictPublicBuckets: true')
    expect(template).toContain('DenyInsecureTransport')
    expect(template).toContain("'aws:SecureTransport': false")
    expect(template).toMatch(/ArtifactBucket\.Arn}\/lambda\/\*/)
    expect(template).toContain("'iam:PassedToService': lambda.amazonaws.com")
    expect(template).toMatch(/DashboardFunctionName}-server/)
    expect(template).not.toContain('RuntimeRoleName')
    expect(template).not.toMatch(/Effect: Allow[\s\S]*?Action: s3:\*/)
    expect(template).not.toContain('Action: iam:*')
  })

  it('requires the exact immutable GitHub repository/environment subject, audience, stack and prefix', async () => {
    const template = await bootstrapTemplate('github-oidc')
    expect(bootstrapContractVersion(template)).toBe('2')
    expect(template).toContain('Federated: !Ref GitHubOidcProviderArn')
    expect(template).toContain("'token.actions.githubusercontent.com:aud': sts.amazonaws.com")
    expect(template).toMatch(
      /repo:\$\{Owner}@\$\{GitHubOwnerId}\/\$\{Repository}@\$\{GitHubRepositoryId}:environment:\$\{GitHubEnvironment}/,
    )
    expect(template).toContain('/lambda/*')
    expect(template).toMatch(/stack\/\$\{ApplicationStackName}\/\*/)
    expect(template).toContain('PassCoreExecutionRole')
    expect(template).not.toContain('Action: cloudformation:*')
  })

  it('requires inputs and preserves deployed parameters for upgrades', () => {
    expect(() => requiredBootstrapParameters('core', {})).toThrow('ArtifactBucketName')
    expect(() => requiredBootstrapParameters('github-oidc', {})).toThrow('GitHubOwnerId')
    const values = requiredBootstrapParameters('core', {
      ArtifactBucketName: 'bucket',
      ApplicationStackName: 'stack',
      DashboardFunctionName: 'function',
      RuntimeRoleName: 'role',
      ArtifactKmsKeyArn: 'arn:key',
    })
    expect(
      mergeBootstrapParameters(values, [
        { ParameterKey: 'RuntimeSecretArn', ParameterValue: 'old' },
      ]),
    ).toContainEqual({ ParameterKey: 'RuntimeSecretArn', ParameterValue: 'old' })
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
