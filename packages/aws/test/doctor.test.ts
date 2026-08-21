import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type DoctorDependencies, runDoctor } from '../src/doctor.ts'

async function parameterFile(
  values: unknown = [{ ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'artifacts' }],
) {
  const root = await mkdtemp('/tmp/dashboard-doctor-')
  const path = join(root, 'parameters.json')
  await writeFile(path, JSON.stringify(values))
  return path
}

async function stackFile(output: { OutputKey: string; OutputValue?: string }[] = []) {
  const root = await mkdtemp('/tmp/dashboard-doctor-stack-')
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

describe('deployment doctor', () => {
  it('reports a completely healthy read-only deployment setup', async () => {
    const commands: string[][] = []
    const base = dependencies()
    const checks = await runDoctor(
      { parametersPath: await parameterFile(), region: 'us-east-1' },
      {
        ...base,
        async execute(command, args) {
          commands.push([command, ...args])
          return base.execute(command, args)
        },
      },
    )
    expect(checks.every(({ ok }) => ok)).toBe(true)
    expect(commands.filter(([command]) => command === 'aws').map(([, action]) => action)).toEqual([
      '--version',
      'sts',
      's3api',
    ])
    expect(commands.flat().join(' ')).not.toMatch(/\b(cp|sync|deploy|put|update|delete|create)\b/)
  })

  it('warns when an explicitly captured GitHub OIDC bootstrap predates the package revision', async () => {
    const checks = await runDoctor(
      {
        parametersPath: await parameterFile(),
        region: 'us-east-1',
        githubOidcStackPath: await stackFile([
          { OutputKey: 'BootstrapContractVersion', OutputValue: '2' },
        ]),
      },
      dependencies(),
    )
    expect(checks.find(({ name }) => name === 'Bootstrap template')).toMatchObject({
      ok: true,
      warning: true,
    })
    expect(checks.find(({ name }) => name === 'Bootstrap template')?.detail).toContain(
      'rerun the GitHub OIDC bootstrap review',
    )
  })

  it('aggregates missing tools, expired credentials, and malformed parameters', async () => {
    const checks = await runDoctor(
      { parametersPath: await parameterFile({ wrong: true }), region: 'us-east-1' },
      dependencies({
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
      }),
    )
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
  })

  it('reports a missing AWS CLI without attempting identity or bucket commands', async () => {
    const commands: string[][] = []
    const checks = await runDoctor(
      { parametersPath: await parameterFile(), region: 'us-east-1' },
      dependencies({
        async execute(command, args) {
          commands.push([command, ...args])
          if (command === 'aws') throw Object.assign(new Error('missing'), { code: 'ENOENT' })
          return dependencies().execute(command, args)
        },
      }),
    )
    expect(checks.find(({ name }) => name === 'AWS CLI')?.detail).toBe('not found on PATH')
    expect(checks.find(({ name }) => name === 'AWS identity')?.detail).toContain('skipped')
    expect(checks.find(({ name }) => name === 'Artifact bucket')?.detail).toContain('skipped')
    expect(commands.filter(([command]) => command === 'aws')).toHaveLength(1)
  })

  it('reports stale parameters, Region mismatch, missing buckets, and unavailable clients', async () => {
    const stale = await runDoctor(
      {
        parametersPath: await parameterFile([
          { ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'artifacts' },
          { ParameterKey: 'RemovedParameter', ParameterValue: 'stale' },
        ]),
        region: 'us-east-1',
      },
      dependencies(),
    )
    expect(stale.find(({ name }) => name === 'Parameters/template')?.detail).toContain(
      'stale: RemovedParameter',
    )

    const mismatch = await runDoctor(
      { parametersPath: await parameterFile(), region: 'us-east-1' },
      dependencies({
        async execute(command, args) {
          if (args[0] === 's3api') return JSON.stringify({ LocationConstraint: 'us-west-2' })
          return dependencies().execute(command, args)
        },
        async fetch() {
          return { ok: false, status: 404 }
        },
      }),
    )
    expect(mismatch.find(({ name }) => name === 'Artifact bucket')?.detail).toContain('us-west-2')
    expect(mismatch.find(({ name }) => name === 'Hosted client')?.detail).toContain('HTTP 404')

    const missing = await runDoctor(
      { parametersPath: await parameterFile(), region: 'us-east-1' },
      dependencies({
        async execute(command, args) {
          if (args[0] === 's3api') throw new Error('NoSuchBucket')
          return dependencies().execute(command, args)
        },
      }),
    )
    expect(missing.find(({ name }) => name === 'Artifact bucket')?.detail).toContain('NoSuchBucket')
  })
})
