import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { cloudFormationTemplate, deployLambda, packageLambda } from '../src/index.ts'

describe('AWS deployment contract', () => {
  it('is parameterized and remains public/authless with an auth insertion boundary', async () => {
    const template = await cloudFormationTemplate()
    expect(template).toContain('LambdaArtifactBucket')
    expect(template).toContain('BoardConfigPath')
    expect(template).toContain('DashboardVersion')
    expect(template).toContain('AuthType: NONE')
    expect(template).not.toMatch(/174159267544|robertfmurdock|1338375095|ZeGreatDashboardDeploy/)
    expect(template).not.toContain('boards/example.yaml')
  })

  it('packages the published runtime and client with the consumer board', async () => {
    const outputDir = await mkdtemp('/tmp/dashboard-aws-dogfood-')
    const metadata = await packageLambda({
      boardConfigPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
      outputDir,
      version: '1.2.3',
    })
    expect(metadata.clientAssetUrl).toContain('/dashboard/1.2.3')
    expect(await stat(join(outputDir, 'lambda.zip'))).toBeTruthy()
    expect(await stat(join(outputDir, 'lambda', 'board.yaml'))).toBeTruthy()
    expect(await stat(join(outputDir, 'assets', 'index.html'))).toBeTruthy()
    expect(await stat(join(outputDir, 'lambda', 'index.mjs'))).toBeTruthy()
  })

  it('validates a deployment without contacting AWS', async () => {
    const root = await mkdtemp('/tmp/dashboard-aws-dry-run-')
    await mkdir(join(root, 'assets'), { recursive: true })
    await writeFile(join(root, 'assets', 'index.html'), '<!doctype html>')
    await writeFile(join(root, 'lambda.zip'), 'zip placeholder')
    await expect(
      deployLambda({
        artifactDir: root,
        assetsDir: join(root, 'assets'),
        assetsBucket: 'unused',
        assetsBaseUrl: 'https://unused.example',
        functionName: 'unused',
        version: '1.2.3',
        dryRun: true,
      }),
    ).resolves.toBeUndefined()
  })
})
