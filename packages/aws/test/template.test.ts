import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { packageEcs, packageLambda, parseCloudFormationTemplate } from '../src/index.ts'

const secretReference = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:dashboard'
const exampleBoard = fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url))
const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url))
async function packageFixture(scope: ResourceScope) {
  const root = await scope.using(
    'AWS release directory',
    () => mkdtemp('/tmp/dashboard-aws-'),
    (path) => rm(path, { recursive: true, force: true }),
  )
  return {
    root,
    options: {
      boardConfigPath: exampleBoard,
      outputDir: join(root, 'release'),
      version: '1.2.3',
      secretReference,
    },
  }
}
function rejects<Input>(action: (input: Input) => Promise<unknown>) {
  return async (input: Input) => {
    try {
      await action(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected exercise to reject')
  }
}
async function privateBoard(scope: ResourceScope) {
  const world = await packageFixture(scope)
  const board = join(world.root, 'board.yaml')
  await writeFile(
    board,
    `# yaml-language-server: $schema=https://public-assets.zegreatrob.com/dashboard/0.18.0/board-config.schema.json\nsources:\n  github:\n    type: github-actions\n    repo: example/project\n    token_env: GITHUB_TOKEN\nboards:\n  team:\n    panels:\n      - id: build\n        type: pipeline-status\n        source: github\n        pipeline: ci.yml\n`,
  )
  return { ...world, options: { ...world.options, boardConfigPath: board } }
}
describe('ECS packaging', () => {
  it(
    'rejects a mutable image tag',
    mint({
      setup: async ({ scope }) => {
        const { options } = await packageFixture(scope)
        return { options: { ...options, imageReference: 'ghcr.io/example/dashboard:1.2.3' } }
      },
      exercise: rejects(({ options }: { options: Parameters<typeof packageEcs>[0] }) =>
        packageEcs(options),
      ),
      verify: (error) => expect((error as Error).message).toContain('immutable registry digest'),
    }),
  )
  it(
    'emits a digest-pinned ECS handoff',
    mint({
      setup: async ({ scope }) => {
        const { options } = await packageFixture(scope)
        return {
          options: {
            ...options,
            imageReference: `ghcr.io/example/dashboard@sha256:${'a'.repeat(64)}`,
          },
        }
      },
      exercise: async ({ options }) => {
        const metadata = await packageEcs(options)
        return {
          metadata,
          template: parseCloudFormationTemplate(
            await readFile(join(options.outputDir, 'template.yml'), 'utf8'),
          ),
        }
      },
      verify: ({ metadata, template }, { options }) => {
        expect(metadata).toMatchObject({ computeMode: 'ecs', image: options.imageReference })
        expect(Object.values(template.Resources ?? {})).toContainEqual(
          expect.objectContaining({ Type: 'AWS::ECS::Service' }),
        )
        expect(template.Parameters).toMatchObject({
          Image: { Default: options.imageReference },
          ComputeMode: { AllowedValues: ['ecs'] },
        })
      },
    }),
  )
})
describe('credentialed board admission', () => {
  it(
    'rejects a credentialed board without a credential reference',
    mint({
      setup: async ({ scope }) => {
        const world = await privateBoard(scope)
        return { options: { ...world.options, secretReference: undefined } }
      },
      exercise: rejects(({ options }: { options: Parameters<typeof packageLambda>[0] }) =>
        packageLambda(options),
      ),
      verify: (error) => expect((error as Error).message).toContain('credentials; SecretReference'),
    }),
  )
  it(
    'packages a credentialed board with its explicit reference',
    mint({
      setup: async ({ scope }) => privateBoard(scope),
      exercise: ({ options }) => packageLambda(options),
      verify: (metadata, { options }) => expect(metadata.dashboardVersion).toBe(options.version),
    }),
    30000,
  )
})
describe('CLI deployment handoff', () => {
  it(
    'resolves consumer and release parameters into administrator commands',
    mint({
      setup: async ({ scope }) => {
        const { root, options } = await packageFixture(scope)
        const parametersPath = join(root, 'consumer-parameters.json')
        const consumerParameters = [
          { ParameterKey: 'Name', ParameterValue: 'consumer-dashboard' },
          { ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'consumer-artifacts' },
          { ParameterKey: 'SecretReference', ParameterValue: secretReference },
        ]
        await writeFile(parametersPath, JSON.stringify(consumerParameters))
        return { options, parametersPath, consumerParameters }
      },
      exercise: async ({ options, parametersPath }) => {
        const summary = execFileSync(
          process.execPath,
          [
            cli,
            'package',
            '--board-config',
            options.boardConfigPath,
            '--parameters',
            parametersPath,
            '--output',
            options.outputDir,
            '--version',
            options.version,
          ],
          { encoding: 'utf8' },
        )
        const release = JSON.parse(
          await readFile(join(options.outputDir, 'release.json'), 'utf8'),
        ) as { artifactKey: string; assetPath: string }
        const resolved = JSON.parse(
          await readFile(join(options.outputDir, 'parameters.json'), 'utf8'),
        ) as { ParameterKey: string; ParameterValue: string }[]
        const handoff = JSON.parse(
          await readFile(join(options.outputDir, 'deployment.json'), 'utf8'),
        ) as {
          template: string
          lambdaZip: string
          parameters: string
          artifact: { bucket: string; key: string }
          commands: { upload: string[]; deploy: string[] }
        }
        return { summary, release, resolved, handoff }
      },
      verify: ({ summary, release, resolved, handoff }, { options, consumerParameters }) => {
        expect(summary).toContain('Complete parameters:')
        expect(summary).toContain("Upload: 'aws' 's3' 'cp'")
        expect(summary).toContain('$AWS_REGION')
        const consumerKeys = consumerParameters.map((p) => p.ParameterKey)
        expect(resolved.filter((p) => consumerKeys.includes(p.ParameterKey))).toEqual(
          consumerParameters,
        )
        const values = Object.fromEntries(resolved.map((p) => [p.ParameterKey, p.ParameterValue]))
        expect(values).toMatchObject({
          LambdaArtifactKey: release.artifactKey,
          AssetPath: release.assetPath,
          BoardConfigPath: './board.yaml',
          MemorySize: '256',
          Timeout: '10',
          LogRetentionInDays: '14',
          ReservedConcurrentExecutions: '0',
        })
        expect(handoff).toMatchObject({
          template: 'template.yml',
          lambdaZip: 'lambda.zip',
          parameters: 'parameters.json',
          artifact: { bucket: values.LambdaArtifactBucket, key: release.artifactKey },
        })
        expect(handoff.commands.upload).toContain(`${options.outputDir}/lambda.zip`)
        expect(handoff.commands.deploy).toContain(`${options.outputDir}/template.yml`)
        expect(handoff.commands.deploy).toContain(`file://${options.outputDir}/parameters.json`)
      },
    }),
    30000,
  )
  for (const scenario of [
    { name: 'malformed', contents: '{}', message: 'must contain a JSON parameter array' },
    {
      name: 'duplicate',
      contents:
        '[{"ParameterKey":"LambdaArtifactBucket","ParameterValue":"a"},{"ParameterKey":"LambdaArtifactBucket","ParameterValue":"b"}]',
      message: 'contains duplicate parameters',
    },
    { name: 'missing', contents: '[]', message: 'missing required consumer values' },
    {
      name: 'unknown',
      contents: '[{"ParameterKey":"Unknown","ParameterValue":"value"}]',
      message: 'unknown parameters',
    },
    {
      name: 'managed',
      contents:
        '[{"ParameterKey":"LambdaArtifactBucket","ParameterValue":"bucket"},{"ParameterKey":"AssetPath","ParameterValue":"old"}]',
      message: 'must not set package-managed parameters',
    },
  ])
    it(
      `rejects ${scenario.name} consumer parameters before writing a release`,
      mint({
        setup: async ({ scope }) => {
          const { root, options } = await packageFixture(scope)
          const parametersPath = join(root, 'parameters.json')
          await writeFile(parametersPath, scenario.contents)
          return { ...scenario, options, parametersPath }
        },
        exercise: async ({ options, parametersPath }) => {
          const result = spawnSync(
            process.execPath,
            [
              cli,
              'package',
              '--board-config',
              options.boardConfigPath,
              '--parameters',
              parametersPath,
              '--output',
              options.outputDir,
            ],
            { encoding: 'utf8' },
          )
          const output = await stat(options.outputDir).catch(
            (error: NodeJS.ErrnoException) => error.code,
          )
          return { result, output }
        },
        verify: ({ result, output }, { message }) => {
          expect(result.status).not.toBe(0)
          expect(result.stderr).toContain(message)
          expect(output).toBe('ENOENT')
        },
      }),
      30000,
    )
})
describe('immutable Lambda artifacts', () => {
  it(
    'binds an arbitrary asset path into release metadata, board schema, and deployment defaults',
    mint({
      setup: async ({ scope }) => {
        const { options } = await packageFixture(scope)
        return {
          options: {
            ...options,
            assetPath: 'https://cdn.jsdelivr.net/npm/@scope/dashboard@1.2.3/client',
          },
        }
      },
      exercise: async ({ options }) => {
        const release = await packageLambda(options)
        const entries = unzipSync(await readFile(join(options.outputDir, 'lambda.zip')))
        const template = await readFile(join(options.outputDir, 'template.yml'), 'utf8')
        return { release, entries, template, document: parseCloudFormationTemplate(template) }
      },
      verify: ({ release, entries, template, document }, { options }) => {
        expect(release.assetPath).toBe(options.assetPath)
        expect(entries['board.yaml']).toBeDefined()
        expect(
          strFromU8(entries['board.yaml'] as Uint8Array).startsWith(
            `# yaml-language-server: $schema=${options.assetPath}/board-config.schema.json`,
          ),
        ).toBe(true)
        expect(document.Parameters).toMatchObject({
          AssetPath: { Default: options.assetPath },
          LambdaArtifactKey: { Default: release.artifactKey },
        })
        expect(Object.keys(entries)).toEqual([
          'SHA256SUMS',
          'board.yaml',
          'index.mjs',
          'release.json',
        ])
        expect(template).toContain('LambdaArtifactBucket')
        expect(template).toContain('BoardConfigPath')
        expect(template).toContain('AssetPath')
        expect(template).not.toContain('DashboardVersion')
        expect(template).not.toContain('AssetBaseUrl')
        expect(template).not.toContain('AWS::Lambda::Url')
        expect(template).not.toContain("Principal: '*'")
        expect(template).not.toContain('AuthType: NONE')
        expect(template).toContain('ServerFunctionArn')
        expect(
          (document.Resources?.ServerRole as { Properties?: { RoleName?: unknown } } | undefined)
            ?.Properties?.RoleName,
        ).toBe('$' + '{Name}-server')
        expect(template).toContain('ze-great-dashboard-no-secret-configured')
        expect(template).toContain('ssm:GetParameter')
        expect(template).toContain('kms:EncryptionContext:PARAMETER_ARN')
        expect(template).not.toMatch(
          /174159267544|robertfmurdock|1338375095|ZeGreatDashboardDeploy/,
        )
        expect(template).not.toContain('boards/example.yaml')
      },
    }),
  )
  it(
    'supports the legacy asset-domain shorthand',
    mint({
      setup: async ({ scope }) => {
        const { options } = await packageFixture(scope)
        return { options: { ...options, assetDomain: 'https://assets.example.test/' } }
      },
      exercise: ({ options }) => packageLambda(options),
      verify: (release, { options }) =>
        expect(release.assetPath).toBe(`${options.assetDomain}dashboard/${options.version}`),
    }),
  )
  for (const scenario of [
    {
      selector: {
        assetPath: 'https://cdn.example.test/client',
        assetDomain: 'https://assets.example.test',
      },
      message: '--asset-path and --asset-domain cannot be used together',
      name: 'conflicting selectors',
    },
    {
      selector: { assetPath: 'not-a-url' },
      message: 'absolute HTTP(S) URL',
      name: 'relative paths',
    },
    {
      selector: { assetPath: 'https://assets.example.test/client?release=1.2.3' },
      message: 'without credentials, query, or fragment',
      name: 'query parameters',
    },
  ])
    it(
      `rejects ${scenario.name}`,
      mint({
        setup: async ({ scope }) => {
          const { options } = await packageFixture(scope)
          return { options: { ...options, ...scenario.selector }, message: scenario.message }
        },
        exercise: rejects(({ options }: { options: Parameters<typeof packageLambda>[0] }) =>
          packageLambda(options),
        ),
        verify: (error, { message }) => expect((error as Error).message).toContain(message),
      }),
    )
})
