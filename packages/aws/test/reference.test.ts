// biome-ignore-all lint/suspicious/noTemplateCurlyInString: CloudFormation substitution names are literal artifact data.
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it } from 'vitest'
import { parse, type YAMLSeq } from 'yaml'

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url))
const referenceDirectory = join(repositoryRoot, 'reference')
// Preserve intrinsic expressions as declarations; this does not evaluate CloudFormation.
const cloudFormationTags = [
  ...['Sub', 'Not', 'Equals', 'If'].map((name) => ({
    tag: `!${name}`,
    collection: 'seq' as const,
    resolve: (value: YAMLSeq) => ({ [name]: value.toJSON() }),
  })),
  { tag: '!Ref', resolve: (value: string) => ({ Ref: value }) },
  { tag: '!Sub', resolve: (value: string) => ({ Sub: value }) },
  { tag: '!GetAtt', resolve: (value: string) => ({ GetAtt: value }) },
]
type Statement = { Sid?: string; Action?: unknown; Resource?: unknown }
type ReferenceTemplate = {
  Resources: Record<
    string,
    {
      Type: string
      Properties: {
        TemplateURL?: unknown
        Parameters?: Record<string, unknown>
        Policies?: { PolicyDocument: { Statement: Statement[] } }[]
      }
    }
  >
  Outputs: Record<string, { Value: unknown }>
}
describe('consumer reference packaging', () => {
  it(
    'passes the checked-in board and consumer parameters through the packaging CLI',
    mint({
      setup: async ({ scope }) => {
        const outputDir = await scope.using(
          'reference release',
          () => mkdtemp('/tmp/dashboard-reference-'),
          (path) => rm(path, { recursive: true, force: true }),
        )
        const parametersPath = join(referenceDirectory, 'aws-dashboard-parameters.json')
        const parameters = JSON.parse(await readFile(parametersPath, 'utf8')) as {
          ParameterKey: string
          ParameterValue: string
        }[]
        return {
          outputDir,
          parametersPath,
          parameters,
          boardPath: join(referenceDirectory, 'board.yaml'),
          version: '1.2.3',
        }
      },
      exercise: async ({ outputDir, parametersPath, boardPath, version }) => {
        const summary = execFileSync(
          process.execPath,
          [
            join(repositoryRoot, 'packages/aws/dist/cli.js'),
            'package',
            '--board-config',
            boardPath,
            '--parameters',
            parametersPath,
            '--output',
            outputDir,
            '--version',
            version,
          ],
          { encoding: 'utf8' },
        )
        return {
          summary,
          resolved: JSON.parse(await readFile(join(outputDir, 'parameters.json'), 'utf8')) as {
            ParameterKey: string
            ParameterValue: string
          }[],
          release: JSON.parse(await readFile(join(outputDir, 'release.json'), 'utf8')) as {
            artifactKey: string
            assetPath: string
          },
        }
      },
      verify: ({ summary, resolved, release }, { parameters }) => {
        for (const parameter of parameters) expect(resolved).toContainEqual(parameter)
        expect(resolved).toContainEqual({
          ParameterKey: 'LambdaArtifactKey',
          ParameterValue: release.artifactKey,
        })
        expect(resolved).toContainEqual({
          ParameterKey: 'AssetPath',
          ParameterValue: release.assetPath,
        })
        expect(summary).toContain('Complete parameters:')
      },
    }),
    30000,
  )
})
describe('parsed consumer composition declarations', () => {
  it(
    'forwards both credential paths through consumer-owned nested stacks',
    mint({
      setup: async () => ({
        source: await readFile(join(referenceDirectory, 'consumer-composition.yml'), 'utf8'),
      }),
      exercise: ({ source }) =>
        parse(source, { customTags: cloudFormationTags }) as ReferenceTemplate,
      verify: (composition) => {
        expect(Object.keys(composition.Resources)).toEqual([
          'SecretsApplication',
          'ParameterApplication',
        ])
        const sharedParameters = {
          LambdaArtifactBucket: { Ref: 'LambdaArtifactBucket' },
          LambdaArtifactKey: { Ref: 'LambdaArtifactKey' },
          AssetPath: { Ref: 'AssetPath' },
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
              Ref: 'AssetPath',
            },
          },
          LambdaArtifactKey: { Value: { Ref: 'LambdaArtifactKey' } },
          SecretsFunctionArn: { Value: { GetAtt: 'SecretsApplication.Outputs.ServerFunctionArn' } },
          ParameterFunctionArn: {
            Value: { GetAtt: 'ParameterApplication.Outputs.ServerFunctionArn' },
          },
        })
      },
    }),
  )
})
describe('parsed reference IAM declarations', () => {
  it(
    'scopes smoke task and cluster operations and artifact reads',
    mint({
      setup: async () => ({
        source: await readFile(join(repositoryRoot, 'infra/stack.yml'), 'utf8'),
      }),
      exercise: ({ source }) =>
        parse(source, { customTags: cloudFormationTags }) as ReferenceTemplate,
      verify: (document) => {
        const smoke =
          document.Resources.GitHubReferenceSmokeRole?.Properties.Policies?.[0]?.PolicyDocument
            .Statement
        expect(smoke?.find(({ Sid }) => Sid === 'DeleteSmokeCluster')).toMatchObject({
          Action: 'ecs:DeleteCluster',
          Resource: {
            Sub: 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:cluster/ze-great-dashboard-smoke-*',
          },
        })
        expect(smoke?.find(({ Sid }) => Sid === 'RegisterSmokeTaskDefinition')).toMatchObject({
          Action: 'ecs:RegisterTaskDefinition',
          Resource: {
            Sub: 'arn:${AWS::Partition}:ecs:${AWS::Region}:${AWS::AccountId}:task-definition/ze-great-dashboard-smoke-*:*',
          },
        })
        expect(smoke?.find(({ Sid }) => Sid === 'DeregisterSmokeTaskDefinition')).toMatchObject({
          Action: 'ecs:DeregisterTaskDefinition',
          Resource: '*',
        })
        const execution =
          document.Resources.ReferenceCloudFormationExecutionRole?.Properties.Policies?.[0]
            ?.PolicyDocument.Statement
        expect(
          execution?.find(({ Sid }) => Sid === 'ReadReferenceArtifact')?.Resource,
        ).toContainEqual({ Sub: '${ReferenceArtifactBucket.Arn}/lambda/*' })
      },
    }),
  )
})
