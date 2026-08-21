import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

describe('consumer bootstrap deployment handoff', () => {
  it('requires CloudFormation to use the captured core execution role in every documented deploy path', async () => {
    const guide = await readFile(repositoryFile('docs/aws-setup.md'), 'utf8')

    expect(guide).toContain('core-deployed-stack.json')
    expect(guide).toContain('CloudFormationExecutionRoleArn')
    expect(guide).toContain('--role-arn "$CLOUDFORMATION_EXECUTION_ROLE_ARN"')
    expect(guide).toContain('--capabilities CAPABILITY_NAMED_IAM')
    expect(guide).not.toContain('--capabilities CAPABILITY_IAM')
  })

  it('pins the disposable validation workflow to its protected environment and restricted bootstrap contract', async () => {
    const [workflow, manifest] = await Promise.all([
      readFile(repositoryFile('.github/workflows/consumer-bootstrap-validation.yml'), 'utf8'),
      readFile(repositoryFile('reference/consumer-bootstrap-validation.json'), 'utf8'),
    ])

    expect(workflow).toContain('workflow_dispatch:')
    expect(workflow).toContain('aws_package_version:')
    expect(workflow).toContain('environment: consumer-bootstrap-validation')
    expect(workflow).toContain('role-to-assume: $' + '{{ env.AWS_DEPLOY_ROLE_ARN }}')
    expect(workflow).toContain(
      '@continuous-excellence/ze-great-dashboard-aws@$' + '{AWS_PACKAGE_VERSION}',
    )
    expect(workflow).toContain('test "$installed_version" = "$AWS_PACKAGE_VERSION"')
    expect(workflow).toContain(
      '.consumer-bootstrap-validation/node_modules/.bin/ze-great-dashboard-aws',
    )
    expect(workflow).toContain('--role-arn "$CLOUDFORMATION_EXECUTION_ROLE_ARN"')
    expect(workflow).toContain('--board-config reference/board.yaml')
    expect(workflow).not.toContain('lambda invoke')
    expect(manifest).toContain('ze-great-dashboard-consumer-validation-bootstrap')
    expect(manifest).toContain('ze-great-dashboard-consumer-validation-github-bootstrap')
    expect(manifest).toContain('ze-great-dashboard-consumer-validation-artifacts-174159267544')
    expect(manifest).toContain('consumer-bootstrap-validation')
  })

  it('keeps the CloudShell runbook at the explicit administrator review boundary', async () => {
    const runbook = await readFile(repositoryFile('docs/aws-bootstrap-cloudshell.md'), 'utf8')

    expect(runbook).toContain('aws cloudformation create-change-set')
    expect(runbook).toContain('aws cloudformation describe-change-set')
    expect(runbook).toContain('aws cloudformation execute-change-set')
    expect(runbook).toContain('core-deployed-stack.json')
    expect(runbook).toContain('CAPABILITY_NAMED_IAM')
    expect(runbook).toContain('not an automation script')
  })
})
