import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { packageLambda } from '../src/index.ts'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const referenceDirectory = join(repositoryRoot, 'reference')

const cloudFormationTags = [
  { tag: '!Ref', resolve: (value: string) => ({ Ref: value }) },
  { tag: '!Sub', resolve: (value: string) => ({ Sub: value }) },
  { tag: '!GetAtt', resolve: (value: string) => ({ GetAtt: value }) },
]

describe('persistent consumer reference', () => {
  it('keeps its checked-in consumer inputs compatible with the generated template', async () => {
    const parameters = JSON.parse(
      await readFile(join(referenceDirectory, 'aws-dashboard-parameters.json'), 'utf8'),
    ) as { ParameterKey: string; ParameterValue: string }[]
    expect(parameters).toEqual([
      { ParameterKey: 'Name', ParameterValue: 'ze-great-dashboard-reference' },
      {
        ParameterKey: 'LambdaArtifactBucket',
        ParameterValue: 'ze-great-dashboard-reference-artifacts',
      },
    ])

    const outputDir = await mkdtemp('/tmp/dashboard-reference-package-')
    const release = await packageLambda({
      boardConfigPath: join(referenceDirectory, 'board.yaml'),
      outputDir,
      version: '1.2.3',
      secretReference: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard',
    })
    const template = await readFile(join(outputDir, 'template.yml'), 'utf8')
    expect(template).toContain('Name: { Type: String, Default: dashboard }')
    expect(template).toContain('LambdaArtifactBucket: { Type: String }')
    expect(template).toContain(`Default: "${release.artifactKey}"`)
    expect(template).toContain('Default: "1.2.3"')
  })

  it('keeps the reference composition consumer-owned and forwards both credential paths', async () => {
    const composition = parse(
      await readFile(join(referenceDirectory, 'consumer-composition.yml'), 'utf8'),
      { customTags: cloudFormationTags },
    ) as {
      Resources: Record<
        string,
        { Type: string; Properties: { TemplateURL: unknown; Parameters: Record<string, unknown> } }
      >
      Outputs: Record<string, { Value: unknown }>
    }
    expect(Object.keys(composition.Resources)).toEqual([
      'SecretsApplication',
      'ParameterApplication',
    ])
    const sharedParameters = {
      LambdaArtifactBucket: { Ref: 'LambdaArtifactBucket' },
      LambdaArtifactKey: { Ref: 'LambdaArtifactKey' },
      DashboardVersion: { Ref: 'DashboardVersion' },
      AssetBaseUrl: { Ref: 'AssetBaseUrl' },
      BoardConfigPath: { Ref: 'BoardConfigPath' },
    }
    expect(composition.Resources.SecretsApplication).toEqual({
      Type: 'AWS::CloudFormation::Stack',
      Properties: {
        TemplateURL: { Ref: 'ApplicationTemplateUrl' },
        Parameters: {
          Name: { Ref: 'SecretsName' },
          ...sharedParameters,
          SecretReference: { Ref: 'SecretsReference' },
        },
      },
    })
    expect(composition.Resources.ParameterApplication).toEqual({
      Type: 'AWS::CloudFormation::Stack',
      Properties: {
        TemplateURL: { Ref: 'ApplicationTemplateUrl' },
        Parameters: {
          Name: { Ref: 'ParameterName' },
          ...sharedParameters,
          SecretReference: { Ref: 'ParameterReference' },
        },
      },
    })
    expect(composition.Outputs).toMatchObject({
      AssetPath: {
        Value: {
          Sub: `${String.fromCharCode(36)}{AssetBaseUrl}/dashboard/${String.fromCharCode(36)}{DashboardVersion}`,
        },
      },
      LambdaArtifactKey: { Value: { Ref: 'LambdaArtifactKey' } },
      SecretsFunctionArn: { Value: { GetAtt: 'SecretsApplication.Outputs.ServerFunctionArn' } },
      ParameterFunctionArn: { Value: { GetAtt: 'ParameterApplication.Outputs.ServerFunctionArn' } },
    })
  })

  it('scopes the reference identities and deploys before publication', async () => {
    const infrastructure = await readFile(join(repositoryRoot, 'infra/stack.yml'), 'utf8')
    const bootstrap = await readFile(join(repositoryRoot, 'infra/bootstrap.yml'), 'utf8')
    expect(infrastructure).toContain('BucketName: ze-great-dashboard-reference-artifacts')
    expect(infrastructure).toContain('VersioningConfiguration: { Status: Suspended }')
    expect(infrastructure).toContain('SSEAlgorithm: AES256')
    expect(infrastructure).toContain('ref:refs/heads/main')
    expect(infrastructure).toContain('stack/ze-great-dashboard-reference/*')
    expect(infrastructure).toContain('function:ze-great-dashboard-reference')
    expect(infrastructure).toContain('role/ze-great-dashboard-reference-*')
    expect(infrastructure).toContain('ZeGreatDashboardReferenceSmoke')
    expect(infrastructure).toContain('ReferenceCredentialSmokeSecret')
    expect(infrastructure).toContain('"GITHUB_TOKEN":"smoke-placeholder"')
    expect(infrastructure).toContain('ecs:CreateCluster')
    expect(infrastructure).toContain('ecs:StopTask')
    expect(infrastructure).toContain('Sid: DeleteSmokeCluster')
    const smokeClusterArn = [
      'arn:',
      ['$', '{AWS::Partition}'].join(''),
      ':ecs:',
      ['$', '{AWS::Region}'].join(''),
      ':',
      ['$', '{AWS::AccountId}'].join(''),
      ':cluster/ze-great-dashboard-smoke-*',
    ].join('')
    expect(infrastructure).toContain(
      `Action: ecs:DeleteCluster\n                Resource: !Sub '${smokeClusterArn}'`,
    )
    expect(infrastructure).toContain(`task-definition/ze-great-dashboard-smoke-*:*'`)
    expect(infrastructure).toContain(
      "Sid: DeregisterSmokeTaskDefinition\n                Effect: Allow\n                Action: ecs:DeregisterTaskDefinition\n                Resource: '*'",
    )
    expect(infrastructure).toContain('ReferenceSmokeRoleArn')
    expect(infrastructure).toContain('ReferenceCredentialSmokeSecretArn')
    expect(infrastructure).toContain('ReferenceCredentialSmokeParameterArn')
    expect(infrastructure).toContain('MaintainReferenceCredentialSmokeParameter')
    expect(infrastructure).toContain('ssm:PutParameter')
    expect(bootstrap).toContain('iam:GetRolePolicy')
    expect(infrastructure).toContain(`'\${ReferenceArtifactBucket.Arn}/lambda/*'`)
    expect(bootstrap).toContain('ze-great-dashboard-reference-artifacts')
    expect(bootstrap).toContain('ZeGreatDashboardReferenceCloudFormationExecution')
    expect(bootstrap).toContain('ZeGreatDashboardReferenceDeploy')
    expect(bootstrap).toContain('ZeGreatDashboardReferenceSmoke')
    expect(bootstrap).toContain('ReferenceCredentialSmokeSecret')
    expect(bootstrap).toContain('secretsmanager:CreateSecret')

    const workflow = await readFile(join(repositoryRoot, '.github/workflows/main.yml'), 'utf8')
    const tarball = workflow.indexOf('Build the exact-version npm tarball')
    const assets = workflow.indexOf('Publish candidate client assets from the tarball')
    const reference = workflow.indexOf(
      'Deploy and check the exact tarball as the consumer reference',
    )
    const candidate = workflow.indexOf('Save verified release candidate')
    const publish = workflow.indexOf('Publish the same npm tarball')
    const registry = workflow.indexOf('Confirm the published version is visible')
    const tag = workflow.indexOf('Tag verified release')
    expect(
      [tarball, assets, reference, candidate, publish, registry, tag].every((index) => index >= 0),
    ).toBe(true)
    expect(tarball).toBeLessThan(assets)
    expect(assets).toBeLessThan(reference)
    expect(reference).toBeLessThan(candidate)
    expect(reference).toBeLessThan(publish)
    expect(publish).toBeLessThan(registry)
    expect(registry).toBeLessThan(tag)
    expect(workflow).toContain('bash scripts/deploy-reference-composition.sh')
    expect(workflow).toContain('verified-release-candidate')
    expect(workflow).not.toContain('Deploy application 🚀')
    expect(workflow).toContain('reference_artifact_bucket')
    expect(workflow).toContain('reference_execution_role_arn')
    expect(workflow).toContain('reference_credential_smoke_secret_arn')
    expect(workflow).toContain('reference_credential_smoke_parameter_arn')
    expect(workflow).toContain('credential-smoke-board.yaml')
    expect(workflow).toContain('cp reference/aws-dashboard-parameters.json .reference-consumer/')
    expect(workflow).toContain('ParameterKey":"SecretReference')
    expect(workflow).toContain('aws ssm put-parameter')
    expect(workflow).toContain('--type SecureString')
    expect(infrastructure).toContain('cloudformation:DeleteStack')
    const compositionScript = join(repositoryRoot, 'scripts/deploy-reference-composition.sh')
    execFileSync('bash', ['-n', compositionScript])
    const script = await readFile(compositionScript, 'utf8')
    expect(script).toContain('reference/consumer-composition.yml')
    expect(script).toContain('composition-parameters.json')
    expect(script).toContain(`templates/${String.fromCharCode(36)}{artifact_key%.zip}.yml`)
    expect(script).toContain('length == 10 and all(.[]; (.ParameterValue // "") != "")')
    expect(script).toContain(
      ['--parameter-overrides ', String.fromCharCode(36), '{composition_parameters}'].join(''),
    )
    expect(script).not.toContain(
      [
        '--parameter-overrides "file://',
        String.fromCharCode(36),
        '{REFERENCE_RELEASE_DIR}/composition-parameters.json"',
      ].join(''),
    )
    expect(script).toContain('SecretsFunctionArn')
    expect(script).toContain('ParameterFunctionArn')
    expect(script.match(/aws s3 cp/g)).toHaveLength(2)
    expect(script.match(/aws cloudformation deploy/g)).toHaveLength(1)
    expect(script.match(/invoke_health /g)).toHaveLength(2)
    expect(workflow).toContain('for attempt in {1..12}')
    expect(workflow).toContain('Assume Docker smoke-test credentials')
    expect(workflow).toContain('Run ephemeral ECS Docker smoke test')
    expect(workflow).toContain('for attempt in 1 2 3')
    expect(workflow).toContain('if bash scripts/test-ecs-image.sh; then')
    expect(workflow).toContain('retrying in 10 seconds')
    expect(workflow).toContain('failed after 3 attempts')
    expect(workflow).toContain('build-args:')
    expect(workflow).toContain('RELEASE_VERSION=')
    expect(workflow).toContain('run: bash scripts/check-provider-bootstrap.sh')
    expect(workflow.indexOf('Check provider bootstrap before provisioning')).toBeLessThan(
      workflow.indexOf('Provision AWS infrastructure'),
    )
    expect(workflow).not.toContain('aws ecs create-service')
    expect(workflow).not.toContain('AWS::ElasticLoadBalancingV2')

    const smokeScript = join(repositoryRoot, 'scripts/test-ecs-image.sh')
    execFileSync('bash', ['-n', smokeScript])
    const smoke = await readFile(smokeScript, 'utf8')
    expect(smoke).not.toContain('ASSET_PATH is required')
    expect(smoke).not.toContain('name:"ASSET_PATH"')
    expect(smoke).toContain('local test_status=$?')
    expect(smoke).toContain('cleanup failed')
    expect(smoke).toContain('trap cleanup EXIT')
    expect(smoke).toContain('aws ecs create-cluster')
    expect(smoke).toContain('healthCheck')
    expect(smoke).toContain('/nodejs/bin/node')
    expect(smoke).toContain('/app/docker-healthcheck.mjs')
    expect(smoke).toContain('aws ecs stop-task')
    expect(smoke).toContain('aws ecs deregister-task-definition')
    expect(smoke).toContain('aws ecs delete-cluster')
  })
})
