import { execFile } from 'node:child_process'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const run = promisify(execFile)
const repositoryRoot = new URL('../../..', import.meta.url).pathname
const cli = join(repositoryRoot, 'packages/aws/src/cli.ts')
const tsx = join(repositoryRoot, 'node_modules/.bin/tsx')

async function invoke(...arguments_: string[]) {
  return run(tsx, [cli, ...arguments_], { cwd: repositoryRoot })
}

describe('AWS bootstrap CLI output contract', () => {
  it('keeps template JSON parseable and adds structured remediation', async () => {
    const result = await invoke('bootstrap', 'template', '--kind', 'core')
    const output = JSON.parse(result.stdout) as {
      kind: string
      template: string
      remediation: { revalidateCommand: string; safetyNote: string }
    }
    expect(output.kind).toBe('core')
    expect(output.template).toContain('core-v1.yml')
    expect(output.remediation.revalidateCommand).toContain('bootstrap check')
    expect(output.remediation.safetyNote).toContain('never executes')
  }, 30_000)

  it('keeps guide text as the operator-facing default and exposes equivalent JSON explicitly', async () => {
    const directory = await mkdtemp('/tmp/dashboard-cli-format-')
    const config = join(directory, 'manifest.json')
    await writeFile(
      config,
      JSON.stringify({
        region: 'us-east-1',
        core: {
          stackName: 'demo-bootstrap',
          artifactBucketName: 'demo-artifacts',
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
      }),
    )
    const text = await invoke('bootstrap', 'guide', '--config', config)
    expect(text.stdout).toContain('Phase: core')
    expect(text.stdout).toContain('Remediation:')
    expect(text.stdout).toContain('Copy/paste recovery commands')
    expect(text.stdout).toContain(`--config' '${config}`)
    expect(text.stdout).toContain('--stack-name demo-bootstrap')
    expect(text.stdout).toContain('docs/aws-bootstrap-upgrade.md')

    const json = await invoke('bootstrap', 'guide', '--config', config, '--format', 'json')
    const output = JSON.parse(json.stdout) as {
      guide: string
      remediation: {
        failureSummary: string
        recoveryCommands: { command: string }[]
        runbookTarget: string
      }
    }
    expect(output.guide).toContain('Phase: core')
    expect(output.remediation.failureSummary).toContain('ready')
    expect(
      output.remediation.recoveryCommands.some(({ command }) => command.includes(config)),
    ).toBe(true)
    expect(output.remediation.runbookTarget).toBe('docs/aws-bootstrap-upgrade.md')
  }, 30_000)

  it('keeps --format-shell as a clean command-only administrator handoff', async () => {
    const directory = await mkdtemp('/tmp/dashboard-cli-shell-')
    const parameters = join(directory, 'parameters.json')
    await writeFile(parameters, '[]')
    const result = await invoke(
      'bootstrap',
      'change-set',
      '--kind',
      'core',
      '--stack-name',
      'demo-bootstrap',
      '--change-set-name',
      'review',
      '--parameters',
      parameters,
      '--format-shell',
    )
    expect(result.stdout.trim()).toMatch(/^'aws' 'cloudformation' 'create-change-set'/)
    expect(result.stdout).not.toContain('Remediation:')
    expect(result.stdout).not.toContain('{')
  }, 30_000)

  it('updates only desired state through the explicit upgrade command', async () => {
    const directory = await mkdtemp('/tmp/dashboard-cli-upgrade-')
    const config = join(directory, 'manifest.json')
    const original = {
      mode: 'lambda',
      region: 'us-east-1',
      customConsumerField: { retained: true },
      core: {
        stackName: 'demo-bootstrap',
        artifactBucketName: 'demo-artifacts',
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
    await writeFile(config, JSON.stringify(original))
    const result = await invoke('bootstrap', 'upgrade', '--config', config, '--format', 'text')
    const updated = JSON.parse(await (await import('node:fs/promises')).readFile(config, 'utf8'))
    expect(updated).toMatchObject({ ...original, desiredState: { packageVersion: '0.0.0-dev' } })
    expect(updated.customConsumerField).toEqual(original.customConsumerField)
    expect(result.stdout).toContain('Changed: packageVersion')
    expect(result.stdout).toContain('templates.core.templateRevision')
    expect(result.stdout).toContain('Review and commit')
  }, 30_000)
})
