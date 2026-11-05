import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it, vi } from 'vitest'
import { type DoctorDependencies, runDoctor } from '../src/doctor.ts'

async function parameterFile(
  scope: ResourceScope,
  values: unknown = [{ ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'artifacts' }],
) {
  const root = await mkdtemp('/tmp/dashboard-doctor-')
  scope.defer('doctor parameter directory', () => rm(root, { recursive: true, force: true }))
  const path = join(root, 'parameters.json')
  await writeFile(path, JSON.stringify(values))
  return path
}

async function stackFile(
  scope: ResourceScope,
  output: { OutputKey: string; OutputValue?: string }[] = [],
) {
  const root = await mkdtemp('/tmp/dashboard-doctor-stack-')
  scope.defer('doctor captured-stack directory', () => rm(root, { recursive: true, force: true }))
  const path = join(root, 'github-oidc.json')
  await writeFile(path, JSON.stringify({ Outputs: output }))
  return path
}

function dependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  return {
    nodeVersion: '22.14.0',
    packageVersion: '1.2.3',
    async execute(command, args) {
      if (command === 'npm') return '11.19.0'
      if (command === 'jq') return 'jq-1.7'
      if (args[0] === '--version') return 'aws-cli/2.27.0'
      if (args[0] === 'sts')
        return JSON.stringify({ Arn: 'arn:aws:iam::123:user/test', Account: '123' })
      if (args[0] === 's3api') return JSON.stringify({ LocationConstraint: null })
      throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
    },
    async fetch() {
      return { ok: true, status: 200 }
    },
    ...overrides,
  }
}

async function hostedClientOptions(scope: ResourceScope) {
  const directory = await scope.using(
    'doctor parameters directory',
    () => mkdtemp('/tmp/dashboard-doctor-retry-'),
    (path) => rm(path, { recursive: true, force: true }),
  )
  const parametersPath = join(directory, 'parameters.json')
  await writeFile(parametersPath, '[]')
  return { parametersPath, region: 'us-east-1' }
}

describe('deployment doctor', () => {
  describe('hosted client network retries', () => {
    for (const attempts of [1, 2, 3])
      it(
        `reports success when the hosted client responds on attempt ${attempts}`,
        mint({
          setup: async ({ scope }) => {
            const options = await hostedClientOptions(scope)
            const response = { ok: true, status: 200 }
            const fetch = vi.fn<DoctorDependencies['fetch']>()
            for (let attempt = 1; attempt < attempts; attempt++)
              fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
            fetch.mockResolvedValue(response)
            const deps = dependencies({ fetch })
            const url = `https://public-assets.zegreatrob.com/dashboard/${deps.packageVersion}/index.html`
            return { options, deps, url, response }
          },
          exercise: ({ options, deps }) => runDoctor(options, deps),
          verify: (checks, { deps, url, response }) => {
            expect(checks.find(({ name }) => name === 'Hosted client')).toMatchObject({
              ok: true,
              detail: `${url} returned HTTP ${response.status}`,
            })
            expect(vi.mocked(deps.fetch).mock.calls).toEqual(
              Array.from({ length: attempts }, () => [url]),
            )
          },
        }),
      )

    it(
      'reports the final network failure after three attempts',
      mint({
        setup: async ({ scope }) => {
          const options = await hostedClientOptions(scope)
          const finalError = new TypeError('connection reset on final attempt')
          const fetch = vi
            .fn<DoctorDependencies['fetch']>()
            .mockRejectedValueOnce(new TypeError('initial network failure'))
            .mockRejectedValueOnce(new TypeError('second network failure'))
            .mockRejectedValue(finalError)
          return {
            options,
            deps: dependencies({ fetch }),
            finalError,
          }
        },
        exercise: ({ options, deps }) => runDoctor(options, deps),
        verify: (checks, { deps, finalError }) => {
          expect(checks.find(({ name }) => name === 'Hosted client')).toMatchObject({
            ok: false,
            detail: finalError.message,
          })
          expect(deps.fetch).toHaveBeenCalledTimes(3)
        },
      }),
    )

    it(
      'does not retry a hosted client HTTP error',
      mint({
        setup: async ({ scope }) => {
          const options = await hostedClientOptions(scope)
          const response = { ok: false, status: 404 }
          const fetch = vi.fn<DoctorDependencies['fetch']>().mockResolvedValue(response)
          const deps = dependencies({ fetch })
          const url = `https://public-assets.zegreatrob.com/dashboard/${deps.packageVersion}/index.html`
          return { options, deps, url, response }
        },
        exercise: ({ options, deps }) => runDoctor(options, deps),
        verify: (checks, { deps, url, response }) => {
          expect(checks.find(({ name }) => name === 'Hosted client')).toMatchObject({
            ok: false,
            detail: `${url} returned HTTP ${response.status}`,
          })
          expect(vi.mocked(deps.fetch).mock.calls).toEqual([[url]])
        },
      }),
    )
  })

  it(
    'reports a completely healthy read-only deployment setup',
    mint({
      setup: async ({ scope }) => {
        const commands: string[][] = []
        const base = dependencies()
        const options = {
          parametersPath: await parameterFile(scope),
          region: 'us-east-1',
        } satisfies Parameters<typeof runDoctor>[0]
        const deps = {
          ...base,
          async execute(command, args) {
            commands.push([command, ...args])
            return base.execute(command, args)
          },
        } satisfies Parameters<typeof runDoctor>[1]
        return { options, deps, commands }
      },
      exercise: ({ options, deps }) => runDoctor(options, deps),
      verify: (checks, { commands }) => {
        expect(checks.every(({ ok }) => ok)).toBe(true)
        expect(
          commands.filter(([command]) => command === 'aws').map(([, action]) => action),
        ).toEqual(['--version', 'sts', 's3api'])
        expect(commands.flat().join(' ')).not.toMatch(
          /\b(cp|sync|deploy|put|update|delete|create)\b/,
        )
      },
    }),
  )

  it(
    'warns when an explicitly captured GitHub OIDC bootstrap predates the package revision',
    mint({
      setup: async ({ scope }) => {
        const options = {
          parametersPath: await parameterFile(scope),
          region: 'us-east-1',
          githubOidcStackPath: await stackFile(scope, [
            { OutputKey: 'BootstrapContractVersion', OutputValue: '2' },
          ]),
        } satisfies Parameters<typeof runDoctor>[0]
        const deps = dependencies() satisfies Parameters<typeof runDoctor>[1]
        return { options, deps }
      },
      exercise: ({ options, deps }) => runDoctor(options, deps),
      verify: (checks) => {
        expect(checks.find(({ name }) => name === 'Bootstrap template')).toMatchObject({
          ok: true,
          warning: true,
        })
        expect(checks.find(({ name }) => name === 'Bootstrap template')?.detail).toContain(
          'rerun the GitHub OIDC bootstrap review',
        )
      },
    }),
  )

  it(
    'aggregates missing tools, expired credentials, and malformed parameters',
    mint({
      setup: async ({ scope }) => {
        const options = {
          parametersPath: await parameterFile(scope, { wrong: true }),
          region: 'us-east-1',
        } satisfies Parameters<typeof runDoctor>[0]
        const deps = dependencies({
          nodeVersion: '20.0.0',
          async execute(command, args) {
            if (command === 'npm' || command === 'jq')
              throw Object.assign(new Error('missing'), { code: 'ENOENT' })
            if (args[0] === '--version') return 'aws-cli/2.27.0'
            if (args[0] === 'sts') throw new Error('ExpiredToken')
            throw new Error('unexpected AWS call')
          },
          async fetch() {
            return { ok: false, status: 503 }
          },
        }) satisfies Parameters<typeof runDoctor>[1]
        return { options, deps }
      },
      exercise: ({ options, deps }) => runDoctor(options, deps),
      verify: (checks) => {
        const failures = checks.filter(({ ok }) => !ok)
        expect(failures.map(({ name }) => name)).toEqual([
          'Node.js',
          'npm',
          'jq',
          'AWS identity',
          'Parameters/template',
          'Artifact bucket',
          'Hosted client',
        ])
      },
    }),
  )

  it(
    'reports a missing AWS CLI without attempting identity or bucket commands',
    mint({
      setup: async ({ scope }) => {
        const commands: string[][] = []
        const options = {
          parametersPath: await parameterFile(scope),
          region: 'us-east-1',
        } satisfies Parameters<typeof runDoctor>[0]
        const deps = dependencies({
          async execute(command, args) {
            commands.push([command, ...args])
            if (command === 'aws') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
            return dependencies().execute(command, args)
          },
        }) satisfies Parameters<typeof runDoctor>[1]
        return { options, deps, commands }
      },
      exercise: ({ options, deps }) => runDoctor(options, deps),
      verify: (checks, { commands }) => {
        expect(checks.find(({ name }) => name === 'AWS CLI')?.detail).toBe('not found on PATH')
        expect(checks.find(({ name }) => name === 'AWS identity')?.detail).toContain('skipped')
        expect(checks.find(({ name }) => name === 'Artifact bucket')?.detail).toContain('skipped')
        expect(commands.filter(([command]) => command === 'aws')).toHaveLength(1)
      },
    }),
  )

  describe('parameter and bucket diagnostics', () => {
    it(
      'reports stale parameters',
      mint({
        setup: async ({ scope }) => {
          const options = {
            parametersPath: await parameterFile(scope, [
              { ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'artifacts' },
              { ParameterKey: 'RemovedParameter', ParameterValue: 'stale' },
            ]),
            region: 'us-east-1',
          } satisfies Parameters<typeof runDoctor>[0]
          const deps = dependencies() satisfies Parameters<typeof runDoctor>[1]
          return { options, deps }
        },
        exercise: ({ options, deps }) => runDoctor(options, deps),
        verify: (stale) => {
          expect(stale.find(({ name }) => name === 'Parameters/template')?.detail).toContain(
            'stale: RemovedParameter',
          )
        },
      }),
    )
    it(
      'reports Region mismatch and an unavailable hosted client',
      mint({
        setup: async ({ scope }) => {
          const options = {
            parametersPath: await parameterFile(scope),
            region: 'us-east-1',
          } satisfies Parameters<typeof runDoctor>[0]
          const deps = dependencies({
            async execute(command, args) {
              if (args[0] === 's3api') return JSON.stringify({ LocationConstraint: 'us-west-2' })
              return dependencies().execute(command, args)
            },
            async fetch() {
              return { ok: false, status: 404 }
            },
          }) satisfies Parameters<typeof runDoctor>[1]
          return { options, deps }
        },
        exercise: ({ options, deps }) => runDoctor(options, deps),
        verify: (mismatch) => {
          expect(mismatch.find(({ name }) => name === 'Artifact bucket')?.detail).toContain(
            'us-west-2',
          )
          expect(mismatch.find(({ name }) => name === 'Hosted client')?.detail).toContain(
            'HTTP 404',
          )
        },
      }),
    )
    it(
      'reports an unavailable artifact bucket',
      mint({
        setup: async ({ scope }) => {
          const options = {
            parametersPath: await parameterFile(scope),
            region: 'us-east-1',
          } satisfies Parameters<typeof runDoctor>[0]
          const deps = dependencies({
            async execute(command, args) {
              if (args[0] === 's3api') throw new Error('NoSuchBucket')
              return dependencies().execute(command, args)
            },
          }) satisfies Parameters<typeof runDoctor>[1]
          return { options, deps }
        },
        exercise: ({ options, deps }) => runDoctor(options, deps),
        verify: (missing) => {
          expect(missing.find(({ name }) => name === 'Artifact bucket')?.detail).toContain(
            'NoSuchBucket',
          )
        },
      }),
    )
  })
})
