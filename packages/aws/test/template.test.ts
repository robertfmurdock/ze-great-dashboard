import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { cloudFormationTemplate, packageEcs, packageLambda } from '../src/index.ts'

const secretReference = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard'

describe('AWS deployment contract', () => {
  it('is parameterized and leaves public gateway exposure to the consumer', async () => {
    const template = await cloudFormationTemplate()
    expect(template).toContain('LambdaArtifactBucket')
    expect(template).toContain('BoardConfigPath')
    expect(template).toContain('AssetPath')
    expect(template).not.toContain('DashboardVersion')
    expect(template).not.toContain('AssetBaseUrl')
    expect(template).not.toContain('AWS::Lambda::Url')
    expect(template).not.toContain("Principal: '*'")
    expect(template).not.toContain('AuthType: NONE')
    expect(template).toContain('ServerFunctionArn')
    expect(template).toContain(`RoleName: !Sub '\${Name}-server'`)
    expect(template).toContain('ze-great-dashboard-no-secret-configured')
    expect(template).toContain('ssm:GetParameter')
    expect(template).toContain('kms:EncryptionContext:PARAMETER_ARN')
    expect(template).not.toMatch(/174159267544|robertfmurdock|1338375095|ZeGreatDashboardDeploy/)
    expect(template).not.toContain('boards/example.yaml')
  })

  it('requires a digest-pinned image and emits an ECS-only template handoff', async () => {
    const outputDir = await mkdtemp('/tmp/dashboard-aws-ecs-')
    await expect(
      packageEcs({
        boardConfigPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
        outputDir,
        version: '1.2.3',
        imageReference: 'ghcr.io/example/dashboard:1.2.3',
        secretReference,
      }),
    ).rejects.toThrow(/immutable registry digest/)
    const metadata = await packageEcs({
      boardConfigPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
      outputDir,
      version: '1.2.3',
      imageReference: `ghcr.io/example/dashboard@sha256:${'a'.repeat(64)}`,
      secretReference,
    })
    expect(metadata).toMatchObject({
      computeMode: 'ecs',
      image: `ghcr.io/example/dashboard@sha256:${'a'.repeat(64)}`,
    })
    const template = await readFile(join(outputDir, 'template.yml'), 'utf8')
    expect(template).toContain('AWS::ECS::Service')
    expect(template).toContain(`Default: "${metadata.image}"`)
    expect(template).toContain('AllowedValues: [ ecs ]')
  })

  it('rejects a credentialed board until a SecretReference ARN is supplied', async () => {
    const board = join(await mkdtemp('/tmp/dashboard-aws-private-board-'), 'board.yaml')
    await writeFile(
      board,
      `# yaml-language-server: $schema=https://public-assets.zegreatrob.com/dashboard/0.18.0/board-config.schema.json\nsources:\n  github:\n    type: github-actions\n    token_env: GITHUB_TOKEN\nboards:\n  team:\n    panels:\n      - id: build\n        type: pipeline-status\n        source: github\n`,
    )
    await expect(
      packageLambda({
        boardConfigPath: board,
        outputDir: await mkdtemp('/tmp/dashboard-aws-private-'),
        version: '1.2.3',
      }),
    ).rejects.toThrow(/credentials; SecretReference/)
    await expect(
      packageLambda({
        boardConfigPath: board,
        outputDir: await mkdtemp('/tmp/dashboard-aws-private-'),
        version: '1.2.3',
        secretReference,
      }),
    ).resolves.toMatchObject({ dashboardVersion: '1.2.3' })
  }, 30_000)

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
      {
        ParameterKey: 'AssetPath',
        ParameterValue: 'https://public-assets.zegreatrob.com/dashboard/1.2.3',
      },
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
  }, 30_000)

  it('binds an arbitrary immutable asset path into release metadata, schema, and deployment', async () => {
    const root = await mkdtemp('/tmp/dashboard-aws-asset-path-')
    const outputDir = join(root, 'release')
    const assetPath = 'https://cdn.jsdelivr.net/npm/@scope/dashboard@1.2.3/client'
    const release = await packageLambda({
      boardConfigPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
      outputDir,
      version: '1.2.3',
      assetPath,
      secretReference,
    })
    expect(release.assetPath).toBe(assetPath)
    const packagedBoard = unzipSync(await readFile(join(outputDir, 'lambda.zip')))['board.yaml']
    expect(packagedBoard).toBeDefined()
    expect(
      strFromU8(packagedBoard as Uint8Array).startsWith(
        `# yaml-language-server: $schema=${assetPath}/board-config.schema.json`,
      ),
    ).toBe(true)
    expect(await readFile(join(outputDir, 'template.yml'), 'utf8')).toContain(
      `Default: "${assetPath}"`,
    )
  })

  it('retains the legacy asset-domain shorthand but rejects conflicting selectors', async () => {
    const boardConfigPath = fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url))
    await expect(
      packageLambda({
        boardConfigPath,
        outputDir: await mkdtemp('/tmp/dashboard-aws-asset-domain-'),
        version: '1.2.3',
        assetDomain: 'https://assets.example.test/',
        secretReference,
      }),
    ).resolves.toMatchObject({ assetPath: 'https://assets.example.test/dashboard/1.2.3' })
    await expect(
      packageLambda({
        boardConfigPath,
        outputDir: await mkdtemp('/tmp/dashboard-aws-asset-conflict-'),
        version: '1.2.3',
        assetPath: 'https://cdn.example.test/client',
        assetDomain: 'https://assets.example.test',
        secretReference,
      }),
    ).rejects.toThrow('--asset-path and --asset-domain cannot be used together')
  })

  it('rejects malformed or non-path asset selectors before writing a release', async () => {
    const boardConfigPath = fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url))
    await expect(
      packageLambda({
        boardConfigPath,
        outputDir: await mkdtemp('/tmp/dashboard-aws-invalid-asset-path-'),
        version: '1.2.3',
        assetPath: 'not-a-url',
        secretReference,
      }),
    ).rejects.toThrow('absolute HTTP(S) URL')
    await expect(
      packageLambda({
        boardConfigPath,
        outputDir: await mkdtemp('/tmp/dashboard-aws-invalid-asset-path-'),
        version: '1.2.3',
        assetPath: 'https://assets.example.test/client?release=1.2.3',
        secretReference,
      }),
    ).rejects.toThrow('without credentials, query, or fragment')
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
        '[{"ParameterKey":"LambdaArtifactBucket","ParameterValue":"bucket"},{"ParameterKey":"AssetPath","ParameterValue":"old"}]',
      ),
    ).resolves.toContain('must not set package-managed parameters')
    await expect(stat(join(root, 'managed'))).rejects.toMatchObject({ code: 'ENOENT' })
  }, 30_000)
})
