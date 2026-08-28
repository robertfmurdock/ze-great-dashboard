import type { BootstrapConfig, BootstrapKind } from './bootstrap.js'

export type BootstrapAffectedStack = {
  kind: BootstrapKind
  stackName: string
  issue?: string
}

export type BootstrapRemediation = {
  failureSummary: string
  affectedStacks: BootstrapAffectedStack[]
  immediateSteps: string[]
  upgradeSteps: string[]
  revalidateCommand: string
  safetyNote: string
}

export type BootstrapRemediationInput = {
  summary?: string
  affectedStacks?: BootstrapAffectedStack[]
  configPath?: string
  nextOperation?: string
  issues?: string[]
}

const safetyNote =
  'AWS mutations are emitted for explicit administrator review and invocation; this library never executes them.'

export function bootstrapRemediation(
  config: BootstrapConfig,
  input: BootstrapRemediationInput = {},
): BootstrapRemediation {
  const affectedStacks =
    input.affectedStacks ??
    (
      [
        ['core', config.core?.stackName],
        ['github-oidc', config.githubOidc?.stackName],
      ] as const
    )
      .filter((entry): entry is ['core' | 'github-oidc', string] => Boolean(entry[1]))
      .map(([kind, stackName]) => ({ kind, stackName }))
  const configPath = input.configPath ?? 'manifest.json'
  const checkCommand = `ze-great-dashboard-aws bootstrap check --config ${configPath} --format json`
  const issues = input.issues ?? []
  const summary =
    input.summary ??
    (issues.length
      ? `Bootstrap validation found ${issues.length} issue${issues.length === 1 ? '' : 's'}.`
      : 'Bootstrap validation is ready for the next reviewed operation.')
  return {
    failureSummary: summary,
    affectedStacks,
    immediateSteps: [
      ...(issues.length ? ['Review each reported mismatch, access error, or drift finding.'] : []),
      input.nextOperation ?? 'Run the next bootstrap operation from the generated handoff.',
      'Capture the resulting CloudFormation stack output for the next validation step.',
    ],
    upgradeSteps: [
      'If the contract or template revision is stale, generate parameters from this installed package and create a reviewed UPDATE change set for each affected stack.',
      'Review IAM actions, retained resources, parameters, and the change set before an administrator executes it.',
    ],
    revalidateCommand: checkCommand,
    safetyNote,
  }
}

export function formatBootstrapRemediationText(remediation: BootstrapRemediation): string[] {
  return [
    `Remediation: ${remediation.failureSummary}`,
    `Affected stacks: ${remediation.affectedStacks.length ? remediation.affectedStacks.map(({ kind, stackName, issue }) => `${kind}=${stackName}${issue ? ` (${issue})` : ''}`).join(', ') : 'none identified'}`,
    'Immediate steps:',
    ...remediation.immediateSteps.map((step, index) => `  ${index + 1}. ${step}`),
    'Upgrade steps:',
    ...remediation.upgradeSteps.map((step, index) => `  ${index + 1}. ${step}`),
    `Revalidate: ${remediation.revalidateCommand}`,
    `Safety: ${remediation.safetyNote}`,
  ]
}
