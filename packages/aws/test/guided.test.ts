import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it } from 'vitest'
import {
  type BootstrapConfig,
  bootstrapGuide,
  bootstrapPreflight,
  scaffoldBootstrapManifest,
} from '../src/index.ts'

const config: BootstrapConfig = {
  desiredState: {
    packageVersion: '0.0.0-dev',
    templates: {
      core: { contractVersion: '1', templateRevision: '1.3' },
      githubOidc: { contractVersion: '2', templateRevision: '2.3' },
    },
  },
  region: 'us-east-1',
  core: {
    stackName: 'demo-bootstrap',
    artifactBucketName: 'demo-lambda-artifacts-123',
    applicationStackName: 'demo',
    dashboardFunctionName: 'demo',
  },
  githubOidc: {
    stackName: 'demo-github-bootstrap',
    providerArn: 'arn:aws:iam::123:oidc-provider/token.actions.githubusercontent.com',
    repository: 'owner/repo',
    ownerId: '1',
    repositoryId: '2',
    environment: 'production',
  },
}

describe('guided bootstrap', () => {
  describe('offline manifest scaffolding', () => {
    it(
      'scaffolds the expected non-secret manifest from explicit offline values',
      mint({
        setup: () => ({
          input: {
            slug: 'demo',
            repository: 'owner/repo',
            environment: 'production',
            providerArn: config.githubOidc?.providerArn ?? '',
            accountId: '123',
            region: 'us-east-1',
            ownerId: '1',
            repositoryId: '2',
          },
        }),
        exercise: ({ input }) => scaffoldBootstrapManifest(input),
        verify: (result) => {
          expect(result).toEqual(config)
        },
      }),
    )
  })

  describe('administrator guide', () => {
    it(
      'makes the installed package templates visible in the guided handoff',
      mint({
        setup: () => {
          const input = {
            config,
            configPath: 'dashboard-bootstrap.json',
            workDir: '.bootstrap-work',
          } satisfies NonNullable<Parameters<typeof bootstrapGuide>[0]>
          return { input }
        },
        exercise: ({ input }) => bootstrapGuide(input),
        verify: (guide) => {
          expect(guide).toContain('Package version: 0.0.0-dev')
          expect(guide).toContain('Template core: contract 1')
          expect(guide).toContain('sha256 ')
          expect(guide).toContain("'npm' 'exec' '--' 'ze-great-dashboard-aws'")
          expect(guide).toContain("'aws' 'cloudformation' 'describe-stacks'")
          expect(guide).toContain("> '.bootstrap-work/core-deployed-stack.json'")
        },
      }),
    )
  })

  describe('read-only preflight', () => {
    it(
      'uses only read-only discovery commands and leaves unavailable tools unverified',
      mint({
        setup: () => {
          const calls: string[] = []
          const input = {
            config,
            runner: {
              async execute(command, args) {
                calls.push(`${command} ${args.join(' ')}`)
                throw new Error('offline')
              },
            },
          } satisfies NonNullable<Parameters<typeof bootstrapPreflight>[0]>
          return { input, calls }
        },
        exercise: ({ input }) => bootstrapPreflight(input),
        verify: (result, { calls }) => {
          expect(result.ready).toBe(true)
          expect(result.checks.map((check) => check.status)).toContain('unverified')
          expect(result.remediation.revalidateCommand).toContain('bootstrap check')
          expect(calls.every((call) => !/create|update|delete|execute/.test(call))).toBe(true)
        },
      }),
    )

    it(
      'reports verified GitHub identity contradictions',
      mint({
        setup: () => {
          const input = {
            config,
            runner: {
              async execute(command, args) {
                if (command === 'aws' && args[1] === 'get-caller-identity')
                  return JSON.stringify({ Account: '123' })
                if (command === 'aws' && args[1] === 'get') return 'us-east-1'
                if (command === 'aws') return '{}'
                if (args.at(-1) === 'customization/sub')
                  return JSON.stringify({
                    use_default: false,
                    include_claim_keys: [
                      'repository_owner',
                      'repository_owner_id',
                      'repository',
                      'repository_id',
                      'context',
                    ],
                  })
                if (args.at(-1) === 'production') return '{}'
                return JSON.stringify({ id: 99, owner: { id: 1 } })
              },
            },
          } satisfies NonNullable<Parameters<typeof bootstrapPreflight>[0]>
          return { input }
        },
        exercise: ({ input }) => bootstrapPreflight(input),
        verify: (result) => {
          expect(result.ready).toBe(false)
          expect(result.checks.find((check) => check.name === 'github-repository')?.status).toBe(
            'mismatch',
          )
          expect(result.remediation.failureSummary).toContain('issues')
        },
      }),
    )
  })
})
