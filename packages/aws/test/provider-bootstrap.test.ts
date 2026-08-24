import { execFileSync } from 'node:child_process'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = new URL('../../../', import.meta.url)
const scriptPath = new URL('scripts/check-provider-bootstrap.sh', repositoryRoot)

async function runCheck(policy: unknown): Promise<{ status: number; output: string }> {
  const directory = await mkdtemp('/tmp/dashboard-provider-bootstrap-check-')
  const awsPath = join(directory, 'aws')
  await writeFile(awsPath, `#!/bin/sh\nprintf '%s' '${JSON.stringify(policy)}'\n`)
  await chmod(awsPath, 0o755)
  try {
    execFileSync('bash', ['-n', scriptPath.pathname])
    try {
      const output = execFileSync('bash', [scriptPath.pathname], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ''}`,
          AWS_REGION: 'us-east-1',
          CLOUDFORMATION_ROLE_ARN:
            'arn:aws:iam::123456789012:role/ze-great-dashboard-cloudformation',
          BOOTSTRAP_STACK_NAME: 'ze-great-dashboard-bootstrap',
          BOOTSTRAP_ASSETS_BUCKET_NAME: 'ze-great-dashboard-assets',
          BOOTSTRAP_FUNCTION_NAME: 'ze-great-dashboard',
          BOOTSTRAP_SERVER_ROLE_NAME: 'ze-great-dashboard-server',
          BOOTSTRAP_DEPLOY_ROLE_NAME: 'ZeGreatDashboardDeploy',
          GITHUB_REPOSITORY: 'robertfmurdock/ze-great-dashboard',
          GITHUB_OWNER_ID: '6215634',
          GITHUB_REPOSITORY_ID: '1338375095',
          GITHUB_SHA: 'abc123',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      return { status: 0, output }
    } catch (error) {
      const failure = error as { status?: number; stdout?: Buffer; stderr?: Buffer }
      return {
        status: failure.status ?? 1,
        output: `${failure.stdout?.toString() ?? ''}${failure.stderr?.toString() ?? ''}`,
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

describe('provider bootstrap preflight', () => {
  it('passes when the execution role can create the Docker smoke-test role', async () => {
    const result = await runCheck({
      PolicyDocument: {
        Statement: [
          {
            Action: ['iam:CreateRole', 'iam:PutRolePolicy'],
            Resource: ['arn:aws:iam::123456789012:role/ZeGreatDashboardReferenceSmoke'],
          },
        ],
      },
    })
    expect(result.status).toBe(0)
    expect(result.output).toContain('Provider bootstrap check passed')
  })

  it('fails closed with administrator remediation when the smoke role is absent', async () => {
    const result = await runCheck({
      PolicyDocument: {
        Statement: [{ Action: 'iam:CreateRole', Resource: 'arn:aws:iam::123:role/other-role' }],
      },
    })
    expect(result.status).not.toBe(0)
    expect(result.output).toContain('Provider bootstrap is out of date')
    expect(result.output).toContain('redeploy infra/bootstrap.yml')
    expect(result.output).toContain(
      'https://github.com/robertfmurdock/ze-great-dashboard/blob/abc123/infra/README.md#one-time-bootstrap',
    )
    expect(result.output).toContain('--stack-name ze-great-dashboard-bootstrap')
    expect(result.output).toContain('GitHubRepository=robertfmurdock/ze-great-dashboard')
  })

  it('reports an inaccessible provider bootstrap policy', async () => {
    const directory = await mkdtemp('/tmp/dashboard-provider-bootstrap-denied-')
    const awsPath = join(directory, 'aws')
    await writeFile(awsPath, '#!/bin/sh\necho AccessDenied >&2\nexit 1\n')
    await chmod(awsPath, 0o755)
    try {
      const output = execFileSync('bash', [scriptPath.pathname], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH ?? ''}`,
          AWS_REGION: 'us-east-1',
          CLOUDFORMATION_ROLE_ARN:
            'arn:aws:iam::123456789012:role/ze-great-dashboard-cloudformation',
          BOOTSTRAP_STACK_NAME: 'ze-great-dashboard-bootstrap',
          BOOTSTRAP_ASSETS_BUCKET_NAME: 'ze-great-dashboard-assets',
          BOOTSTRAP_FUNCTION_NAME: 'ze-great-dashboard',
          BOOTSTRAP_SERVER_ROLE_NAME: 'ze-great-dashboard-server',
          BOOTSTRAP_DEPLOY_ROLE_NAME: 'ZeGreatDashboardDeploy',
          GITHUB_REPOSITORY: 'robertfmurdock/ze-great-dashboard',
          GITHUB_OWNER_ID: '6215634',
          GITHUB_REPOSITORY_ID: '1338375095',
          GITHUB_SHA: 'abc123',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      expect(output).toBe('')
    } catch (error) {
      const failure = error as { stderr?: Buffer }
      expect(failure.stderr?.toString()).toContain('could not inspect')
      expect(failure.stderr?.toString()).toContain('redeploy infra/bootstrap.yml')
      expect(failure.stderr?.toString()).toContain('--template-file infra/bootstrap.yml')
    }
  })
})
