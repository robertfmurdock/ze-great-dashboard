import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { cloudFormationTemplate, deployLambda, packageLambda } from '../src/index.ts'

describe('AWS deployment contract', () => {
  it('is parameterized and remains public/authless with an auth insertion boundary', async () => {
    const template = await cloudFormationTemplate()
    expect(template).toContain('LambdaArtifactBucket')
    expect(template).toContain('BoardConfigPath')
    expect(template).toContain('DashboardVersion')
    expect(template).toContain(
      'AssetBaseUrl: { Type: String, Default: https://public-assets.zegreatrob.com }',
    )
    expect(template).toContain('AuthType: NONE')
    expect(template).not.toMatch(/174159267544|robertfmurdock|1338375095|ZeGreatDashboardDeploy/)
    expect(template).not.toContain('boards/example.yaml')
  })

  it('packages the published runtime with the consumer board', async () => {
    const outputDir = await mkdtemp('/tmp/dashboard-aws-dogfood-')
    const metadata = await packageLambda({
      boardConfigPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
      outputDir,
      version: '1.2.3',
    })
    expect(metadata.clientAssetUrl).toBe('https://public-assets.zegreatrob.com/dashboard/1.2.3')
    expect(metadata.artifactKey).toMatch(/^lambda\/[a-f0-9]{64}\.zip$/)
    expect(await stat(join(outputDir, 'lambda.zip'))).toBeTruthy()
    expect(await stat(join(outputDir, 'release.json'))).toBeTruthy()
    const deploymentTemplate = await readFile(join(outputDir, 'template.yml'), 'utf8')
    expect(deploymentTemplate).toContain(`Default: "${metadata.artifactKey}"`)
    expect(deploymentTemplate).toContain('Default: "1.2.3"')
    expect(metadata.artifactChecksums['index.mjs']).toMatch(/^[a-f0-9]{64}$/)
    expect(metadata.artifactChecksums['lambda.zip']).toMatch(/^[a-f0-9]{64}$/)

    const secondOutput = await mkdtemp('/tmp/dashboard-aws-repeat-')
    const repeated = await packageLambda({
      boardConfigPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
      outputDir: secondOutput,
      version: '1.2.3',
    })
    const firstZip = await readFile(join(outputDir, 'lambda.zip'))
    const secondZip = await readFile(join(secondOutput, 'lambda.zip'))
    expect(secondZip).toEqual(firstZip)
    expect(repeated.artifactChecksums).toEqual(metadata.artifactChecksums)
    expect(repeated.artifactKey).toBe(metadata.artifactKey)
    const entries = unzipSync(firstZip)
    expect(Object.keys(entries).sort()).toEqual([
      'SHA256SUMS',
      'board.yaml',
      'index.mjs',
      'release.json',
    ])
    expect(strFromU8(entries['board.yaml'] ?? new Uint8Array())).toContain('boards:')
    expect(() => JSON.parse(strFromU8(entries['release.json'] ?? new Uint8Array()))).not.toThrow()

    const changedBoard = join(outputDir, 'changed-board.yaml')
    await writeFile(
      changedBoard,
      (
        await readFile(
          fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
          'utf8',
        )
      ).replace('refresh: 60s', 'refresh: 61s'),
    )
    const changed = await packageLambda({
      boardConfigPath: changedBoard,
      outputDir: await mkdtemp('/tmp/dashboard-aws-changed-board-'),
      version: '1.2.3',
    })
    expect(changed.artifactKey).not.toBe(metadata.artifactKey)
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
