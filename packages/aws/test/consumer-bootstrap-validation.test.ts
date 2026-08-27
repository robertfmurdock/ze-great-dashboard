import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryFile = (path: string) => fileURLToPath(new URL(`../../../${path}`, import.meta.url))

describe('consumer bootstrap deployment handoff', () => {
  it('requires CloudFormation to use the captured core execution role in every documented deploy path', async () => {
    const guide = await readFile(repositoryFile('docs/aws-setup.md'), 'utf8')

    expect(guide).toContain('core-deployed-stack.json')
    expect(guide).toContain('CloudFormationExecutionRoleArn')
    expect(guide).toContain('--role-arn "$AWS_CLOUDFORMATION_EXECUTION_ROLE_ARN"')
    expect(guide).toContain('--capabilities CAPABILITY_NAMED_IAM')
    expect(guide).not.toContain('--capabilities CAPABILITY_IAM')
  })

  it('makes consumer bootstrap validation a pre-publication release gate with its restricted bootstrap contract', async () => {
    const [workflow, workflowFiles, manifest, repairScript] = await Promise.all([
      readFile(repositoryFile('.github/workflows/main.yml'), 'utf8'),
      readdir(repositoryFile('.github/workflows')),
      readFile(repositoryFile('reference/consumer-bootstrap-validation.json'), 'utf8'),
      readFile(repositoryFile('scripts/repair-consumer-bootstrap-validation.sh'), 'utf8'),
    ])

    expect(workflowFiles).not.toContain('consumer-bootstrap-validation.yml')
    const validationJobStart = workflow.indexOf('  consumer-bootstrap-validation:')
    const releaseJobStart = workflow.indexOf('  release:')
    expect(validationJobStart).toBeGreaterThanOrEqual(0)
    expect(releaseJobStart).toBeGreaterThan(validationJobStart)
    const validationJob = workflow.slice(validationJobStart, releaseJobStart)

    expect(validationJob).toContain('needs: check')
    expect(validationJob).toContain('environment: consumer-bootstrap-validation')
    expect(validationJob).toContain('Load checked-in validation configuration')
    expect(validationJob).toContain("jq -er '.region' reference/consumer-bootstrap-validation.json")
    expect(validationJob).toContain(
      "jq -er '.core.applicationStackName' reference/consumer-bootstrap-validation.json",
    )
    expect(validationJob).not.toContain('AWS_REGION: us-east-1')
    expect(validationJob).not.toContain('STACK_NAME: ze-great-dashboard-consumer-validation')
    expect(validationJob).toContain('actions: read')
    expect(validationJob).toContain('contents: read')
    expect(validationJob).toContain('id-token: write')
    expect(validationJob).toContain('name: verified-release-candidate')
    expect(validationJob).toContain('"$GITHUB_WORKSPACE/aws-package.tgz"')
    expect(validationJob).toContain('test "$installed_version" = "$CANDIDATE_VERSION"')
    expect(validationJob).toContain('role-to-assume: $' + '{{ env.AWS_DEPLOY_ROLE_ARN }}')
    expect(validationJob).toContain(
      '.consumer-bootstrap-validation/node_modules/.bin/ze-great-dashboard-aws',
    )
    expect(validationJob).toContain('Check live bootstrap consistency')
    expect(validationJob).toContain('bootstrap check')
    expect(validationJob).toContain('check_output=')
    expect(validationJob).toContain('Bootstrap consistency failed')
    expect(validationJob).toContain('apply both affected stack updates')
    expect(validationJob).toContain('Consumer bootstrap requires administrator update')
    expect(validationJob).toContain(
      'infra/README.md#repair-the-consumer-bootstrap-validation-stack',
    )
    expect(repairScript).toContain('Create both CloudFormation change sets?')
    expect(repairScript).toContain('Execute both reviewed CloudFormation updates?')
    expect(repairScript).toContain('aws cloudformation execute-change-set')
    expect(repairScript).toContain('aws cloudformation wait stack-update-complete')
    expect(repairScript).toContain('bootstrap check --config')
    expect(validationJob.indexOf('bootstrap check')).toBeLessThan(
      validationJob.indexOf('--board-config reference/board.yaml'),
    )
    expect(validationJob).toContain('--role-arn "$CLOUDFORMATION_EXECUTION_ROLE_ARN"')
    expect(validationJob).toContain('--board-config reference/board.yaml')
    expect(validationJob).not.toContain('lambda invoke')
    expect(workflow).toContain('needs: [check, consumer-bootstrap-validation]')
    expect(manifest).toContain('ze-great-dashboard-consumer-validation-bootstrap')
    expect(manifest).toContain('ze-great-dashboard-consumer-validation-github-bootstrap')
    expect(manifest).toContain('ze-great-dashboard-consumer-validation-artifacts-174159267544')
    expect(manifest).toContain('consumer-bootstrap-validation')
  })

  it('keeps the CloudShell runbook at the explicit administrator review boundary', async () => {
    const runbook = await readFile(repositoryFile('docs/aws-bootstrap-cloudshell.md'), 'utf8')

    expect(runbook).toContain('bootstrap guide')
    expect(runbook).toContain('bootstrap verify')
    expect(runbook).toContain('core-deployed-stack.json')
    expect(runbook).toContain('CAPABILITY_NAMED_IAM')
    expect(runbook).toContain('not an automation script')
    expect(runbook).toContain('immutable-subject-required')
    expect(runbook).toContain('private Lambda permission')
  })
})
