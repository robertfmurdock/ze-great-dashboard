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
    expect(infrastructure).toContain('VersioningConfiguration: { Status: Enabled }')
    expect(infrastructure).toContain('SSEAlgorithm: AES256')
    expect(infrastructure).toContain('ref:refs/heads/main')
    expect(infrastructure).toContain('stack/ze-great-dashboard-reference/*')
    expect(infrastructure).toContain('function:ze-great-dashboard-reference')
    expect(infrastructure).toContain('role/ze-great-dashboard-reference-*')
    expect(infrastructure).toContain(`'\${ReferenceArtifactBucket.Arn}/lambda/*'`)
    expect(bootstrap).toContain('ze-great-dashboard-reference-artifacts')
    expect(bootstrap).toContain('ZeGreatDashboardReferenceCloudFormationExecution')
    expect(bootstrap).toContain('ZeGreatDashboardReferenceDeploy')

    const workflow = await readFile(join(repositoryRoot, '.github/workflows/main.yml'), 'utf8')
    const tarball = workflow.indexOf('Build the exact-version npm tarball')
    const assets = workflow.indexOf('Publish immutable client assets from the tarball')
    const reference = workflow.indexOf('consumer reference')
    const publish = workflow.indexOf('Publish the same npm tarball')
    const registry = workflow.indexOf('Confirm the published version is visible')
    const tag = workflow.indexOf('Tag verified release')
    expect([tarball, assets, reference, publish, registry, tag].every((index) => index >= 0)).toBe(
      true,
    )
    expect(tarball).toBeLessThan(assets)
    expect(assets).toBeLessThan(reference)
    expect(reference).toBeLessThan(publish)
    expect(publish).toBeLessThan(registry)
    expect(registry).toBeLessThan(tag)
    expect(workflow).toContain('aws-dashboard-release/template.yml')
    expect(workflow).toContain('publish-assets')
    expect(workflow).not.toContain('Deploy application 🚀')
    expect(workflow).toContain('reference_artifact_bucket')
    expect(workflow).toContain('reference_execution_role_arn')
    expect(workflow).toContain('reference_status')
    expect(workflow).toContain('ROLLBACK_COMPLETE')
    expect(infrastructure).toContain('cloudformation:DeleteStack')
    expect(workflow).toContain('for attempt in {1..12}')
  })
})
