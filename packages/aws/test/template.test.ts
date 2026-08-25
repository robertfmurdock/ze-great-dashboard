import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { cloudFormationTemplate, packageLambda } from '../src/index.ts'

const secretReference = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard'

describe('AWS deployment contract', () => {
  it('is parameterized and leaves public gateway exposure to the consumer', async () => {
    const template = await cloudFormationTemplate()
    expect(template).toContain('LambdaArtifactBucket')
    expect(template).toContain('BoardConfigPath')
    expect(template).toContain('DashboardVersion')
    expect(template).toContain(
      'AssetBaseUrl: { Type: String, Default: https://public-assets.zegreatrob.com }',
    )
    expect(template).not.toContain('AWS::Lambda::Url')
    expect(template).not.toContain("Principal: '*'")
    expect(template).not.toContain('AuthType: NONE')
    expect(template).toContain('ServerFunctionArn')
    expect(template).toContain(`RoleName: !Sub '\${Name}-server'`)
    expect(template).toContain('ze-great-dashboard-no-secret-configured')
    expect(template).not.toMatch(/174159267544|robertfmurdock|1338375095|ZeGreatDashboardDeploy/)
    expect(template).not.toContain('boards/example.yaml')
  })

  it('packages the published runtime with the consumer board', async () => {
    const outputDir = await mkdtemp('/tmp/dashboard-aws-dogfood-')
    const metadata = await packageLambda({
      boardConfigPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
      outputDir,
      version: '1.2.3',
      secretReference,
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
      secretReference,
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
      secretReference,
    })
    expect(changed.artifactKey).not.toBe(metadata.artifactKey)
  }, 15_000)

  it('rejects a credentialed board until a SecretReference ARN is supplied', async () => {
    const board = join(await mkdtemp('/tmp/dashboard-aws-private-board-'), 'board.yaml')
    await writeFile(
      board,
      `sources:\n  github:\n    type: github-actions\n    token_env: GITHUB_TOKEN\nboards:\n  team:\n    panels:\n      - id: build\n        type: pipeline-status\n        source: github\n`,
    )
    await expect(
      packageLambda({
        boardConfigPath: board,
        outputDir: await mkdtemp('/tmp/dashboard-aws-private-'),
        version: '1.2.3',
      }),
    ).rejects.toThrow(/token_env; SecretReference/)
    await expect(
      packageLambda({
        boardConfigPath: board,
        outputDir: await mkdtemp('/tmp/dashboard-aws-private-'),
        version: '1.2.3',
        secretReference,
      }),
    ).resolves.toMatchObject({ dashboardVersion: '1.2.3' })
  })

  it('resolves consumer and release parameters into an explicit deployment handoff', async () => {
    const root = await mkdtemp('/tmp/dashboard-aws-handoff-')
    const parametersPath = join(root, 'consumer-parameters.json')
    const outputDir = join(root, 'release')
    await writeFile(
      parametersPath,
      `${JSON.stringify(
        [
          { ParameterKey: 'Name', ParameterValue: 'consumer-dashboard' },
          { ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'consumer-artifacts' },
          { ParameterKey: 'SecretReference', ParameterValue: secretReference },
        ],
        null,
        2,
      )}\n`,
    )
    const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
    const summary = execFileSync(
      process.execPath,
      [
        cli,
        'package',
        '--board-config',
        fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
        '--parameters',
        parametersPath,
        '--output',
        outputDir,
        '--version',
        '1.2.3',
      ],
      { encoding: 'utf8' },
    )
    expect(summary).toContain('Complete parameters:')
    expect(summary).toContain("Upload: 'aws' 's3' 'cp'")
    expect(summary).toContain('$AWS_REGION')
    const release = JSON.parse(await readFile(join(outputDir, 'release.json'), 'utf8')) as {
      artifactKey: string
    }
    const resolved = JSON.parse(await readFile(join(outputDir, 'parameters.json'), 'utf8')) as {
      ParameterKey: string
      ParameterValue: string
    }[]
    expect(resolved).toEqual([
      { ParameterKey: 'Name', ParameterValue: 'consumer-dashboard' },
      { ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'consumer-artifacts' },
      { ParameterKey: 'LambdaArtifactKey', ParameterValue: release.artifactKey },
      { ParameterKey: 'DashboardVersion', ParameterValue: '1.2.3' },
      { ParameterKey: 'AssetBaseUrl', ParameterValue: 'https://public-assets.zegreatrob.com' },
      { ParameterKey: 'BoardConfigPath', ParameterValue: './board.yaml' },
      { ParameterKey: 'MemorySize', ParameterValue: '256' },
      { ParameterKey: 'Timeout', ParameterValue: '10' },
      { ParameterKey: 'LogRetentionInDays', ParameterValue: '14' },
      { ParameterKey: 'ReservedConcurrentExecutions', ParameterValue: '0' },
      { ParameterKey: 'SecretReference', ParameterValue: secretReference },
    ])
    const handoff = JSON.parse(await readFile(join(outputDir, 'deployment.json'), 'utf8')) as {
      template: string
      lambdaZip: string
      parameters: string
      artifact: { bucket: string; key: string }
      commands: { upload: string[]; deploy: string[] }
    }
    expect(handoff).toMatchObject({
      template: 'template.yml',
      lambdaZip: 'lambda.zip',
      parameters: 'parameters.json',
      artifact: { bucket: 'consumer-artifacts', key: release.artifactKey },
    })
    expect(handoff.commands.upload).toContain(`${outputDir}/lambda.zip`)
    expect(handoff.commands.deploy).toContain(`${outputDir}/template.yml`)
    expect(handoff.commands.deploy).toContain(`file://${outputDir}/parameters.json`)
  })

  it('rejects invalid consumer parameter inputs before creating a deployable handoff', async () => {
    const root = await mkdtemp('/tmp/dashboard-aws-invalid-parameters-')
    const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
    const board = fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url))
    const failure = async (name: string, contents: string) => {
      const parametersPath = join(root, `${name}.json`)
      await writeFile(parametersPath, contents)
      try {
        execFileSync(
          process.execPath,
          [
            cli,
            'package',
            '--board-config',
            board,
            '--parameters',
            parametersPath,
            '--output',
            join(root, name),
          ],
          { stdio: 'pipe' },
        )
      } catch (error) {
        return String(
          error && typeof error === 'object' && 'stderr' in error ? error.stderr : error,
        )
      }
      throw new Error('package unexpectedly succeeded')
    }
    await expect(failure('malformed', '{}')).resolves.toContain(
      'must contain a JSON parameter array',
    )
    await expect(
      failure(
        'duplicate',
        '[{"ParameterKey":"LambdaArtifactBucket","ParameterValue":"a"},{"ParameterKey":"LambdaArtifactBucket","ParameterValue":"b"}]',
      ),
    ).resolves.toContain('contains duplicate parameters')
    await expect(failure('missing', '[]')).resolves.toContain('missing required consumer values')
    await expect(
      failure('unknown', '[{"ParameterKey":"Unknown","ParameterValue":"value"}]'),
    ).resolves.toContain('unknown parameters')
    await expect(
      failure(
        'managed',
        '[{"ParameterKey":"LambdaArtifactBucket","ParameterValue":"bucket"},{"ParameterKey":"DashboardVersion","ParameterValue":"old"}]',
      ),
    ).resolves.toContain('must not set package-managed parameters')
    await expect(stat(join(root, 'managed'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
