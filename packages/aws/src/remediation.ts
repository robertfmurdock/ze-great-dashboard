import type { BootstrapConfig, BootstrapKind } from './bootstrap.js'

export type BootstrapAffectedStack = {
  kind: BootstrapKind
  stackName: string
  issue?: string
}

export type BootstrapRecoveryCommand = { name: string; command: string }

export type BootstrapRemediation = {
  failureSummary: string
  affectedStacks: BootstrapAffectedStack[]
  immediateSteps: string[]
  upgradeSteps: string[]
  desiredStateUpdateCommand?: string
  desiredStateCheckpoint?: string
  recoveryCommands: BootstrapRecoveryCommand[]
  reviewCheckpoints: string[]
  runbookTarget: string
  revalidateCommand: string
  safetyNote: string
}

export type BootstrapRemediationInput = {
  summary?: string
  affectedStacks?: BootstrapAffectedStack[]
  configPath?: string
  nextOperation?: string
  issues?: string[]
  desiredStateUpdateRequired?: boolean
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
  const checkCommand = `npm exec -- ze-great-dashboard-aws bootstrap check --config ${configPath} --format text`
  const desiredStateUpdateCommand = `npm exec -- ze-great-dashboard-aws bootstrap upgrade --config ${configPath}`
  const desiredStateUpdateRequired = input.desiredStateUpdateRequired ?? false
  const jsonCheckCommand = `npm exec -- ze-great-dashboard-aws bootstrap check --config ${configPath} --format json`
  const region = config.region ?? '<region>'
  const recoveryStacks = (
    [
      ['core', config.core?.stackName],
      ['github-oidc', config.githubOidc?.stackName],
    ] as const
  ).filter((entry): entry is ['core' | 'github-oidc', string] => Boolean(entry[1]))
  const captures = new Map(
    recoveryStacks.map(([kind]) => [kind, `.bootstrap-work/${kind}-deployed-stack.json`]),
  )
  const recoveryCommands: BootstrapRecoveryCommand[] = recoveryStacks.map(([kind, stackName]) => ({
    name: `capture-${kind}-stack`,
    command: `mkdir -p .bootstrap-work && aws cloudformation describe-stacks --stack-name ${stackName} --region ${region} --output json --no-cli-pager > ${captures.get(kind)}`,
  }))
  for (const [kind, stackName] of recoveryStacks) {
    const parameters = `.bootstrap-work/${kind}-bootstrap-parameters.json`
    recoveryCommands.push({
      name: `preserve-${kind}-parameters`,
      command: `npm exec -- ze-great-dashboard-aws bootstrap parameters --kind ${kind} --config ${configPath} --deployed-stack-json ${captures.get(kind)}${kind === 'github-oidc' && captures.has('core') ? ` --core-stack-json ${captures.get('core')}` : ''} --output ${parameters}`,
    })
    recoveryCommands.push({
      name: `generate-${kind}-update-change-set`,
      command: `npm exec -- ze-great-dashboard-aws bootstrap change-set --kind ${kind} --config ${configPath} --stack-name ${stackName} --change-set-name repair-${kind} --change-set-type UPDATE --parameters ${parameters}`,
    })
  }
  recoveryCommands.push({ name: 'revalidate-bootstrap', command: checkCommand })
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
      ...(desiredStateUpdateRequired
        ? [`Bootstrap template identity changed; review and run: ${desiredStateUpdateCommand}`]
        : []),
      'If the contract or template revision is stale, generate parameters from this installed package and create a reviewed UPDATE change set for each affected stack.',
      'Review IAM actions, retained resources, parameters, and the change set before an administrator executes it.',
    ],
    recoveryCommands,
    ...(desiredStateUpdateRequired
      ? {
          desiredStateUpdateCommand,
          desiredStateCheckpoint:
            'Review and commit the desired-state manifest mutation before the administrator deployment process consumes it; never copy deployed AWS values into desired state.',
        }
      : {}),
    reviewCheckpoints: [
      'Review the captured stack JSON and preserved parameter files before generating any change set.',
      'Inspect every generated UPDATE change set in CloudFormation; verify IAM actions, retained resources, and parameters before executing it.',
      'Execute change sets only as an administrator, one affected stack at a time, then capture both stacks again.',
    ],
    runbookTarget: 'docs/aws-bootstrap-upgrade.md',
    revalidateCommand: jsonCheckCommand,
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
    ...(remediation.desiredStateUpdateCommand
      ? [
          `Desired-state update (repository mutation; review and commit):\n  $ ${remediation.desiredStateUpdateCommand}`,
          `Desired-state checkpoint: ${remediation.desiredStateCheckpoint}`,
        ]
      : []),
    'Copy/paste recovery commands (review before execute):',
    ...remediation.recoveryCommands.map(({ name, command }) => `  ${name}:\n    $ ${command}`),
    'Review checkpoints:',
    ...remediation.reviewCheckpoints.map((checkpoint, index) => `  ${index + 1}. ${checkpoint}`),
    `Runbook: ${remediation.runbookTarget}`,
    `Revalidate: ${remediation.revalidateCommand}`,
    `Safety: ${remediation.safetyNote}`,
  ]
}
