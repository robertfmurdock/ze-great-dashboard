import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packageLambda } from '../src/index.ts'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const referenceDirectory = join(repositoryRoot, 'reference')

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
    expect(workflow).toContain('aws-dashboard-release/template.yml')
    expect(workflow).toContain('aws-dashboard-release/parameters.json')
    expect(workflow).toContain('.commands.upload[4]')
    expect(workflow).toContain('deployed_asset_path')
    expect(workflow).toContain('deployed_artifact_key')
    expect(workflow).toContain(
      `--query "Stacks[0].Outputs[?OutputKey=='AssetPath'].OutputValue" --output text`,
    )
    expect(workflow).toContain(
      `--query "Stacks[0].Parameters[?ParameterKey=='LambdaArtifactKey'].ParameterValue" --output text`,
    )
    expect(workflow).toContain('verified-release-candidate')
    expect(workflow).not.toContain('Deploy application 🚀')
    expect(workflow).toContain('reference_artifact_bucket')
    expect(workflow).toContain('reference_execution_role_arn')
    expect(workflow).toContain('reference_credential_smoke_secret_arn')
    expect(workflow).toContain('credential-smoke-board.yaml')
    expect(workflow).toContain('cp reference/aws-dashboard-parameters.json .reference-consumer/')
    expect(workflow).toContain('ParameterKey":"SecretReference')
    expect(workflow).toContain('reference_status')
    expect(workflow).toContain('ROLLBACK_COMPLETE')
    expect(infrastructure).toContain('cloudformation:DeleteStack')
    expect(workflow).toContain('for attempt in {1..12}')
    expect(workflow).toContain('ServerFunctionArn')
    expect(workflow).toContain('aws lambda invoke')
    expect(workflow).toContain('Assume Docker smoke-test credentials')
    expect(workflow).toContain('Run ephemeral ECS Docker smoke test')
    expect(workflow).toContain('run: bash scripts/test-ecs-image.sh')
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
    expect(smoke).toContain('aws ecs stop-task')
    expect(smoke).toContain('aws ecs deregister-task-definition')
    expect(smoke).toContain('aws ecs delete-cluster')
  })
})
