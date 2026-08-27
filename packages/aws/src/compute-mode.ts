export type ComputeMode = 'lambda' | 'ecs'

export type ComputeModeInputs = {
  /** Mode from the checked-in bootstrap manifest. */
  persisted?: string
  /** Mode from an existing/generated CloudFormation parameter file. */
  artifact?: string
  /** Optional CLI assertion used for inspection and repair. */
  explicit?: string
}

function valid(value: string, label: string): ComputeMode {
  if (value !== 'lambda' && value !== 'ecs')
    throw new Error(`${label} must be lambda or ecs (received ${value})`)
  return value
}

/** Resolves every deployment mode decision and rejects contradictory selectors. */
export function resolveComputeMode(input: ComputeModeInputs = {}): ComputeMode {
  const persisted =
    input.persisted === undefined ? undefined : valid(input.persisted, 'persisted mode')
  const artifact = input.artifact === undefined ? undefined : valid(input.artifact, 'ComputeMode')
  const explicit = input.explicit === undefined ? undefined : valid(input.explicit, 'mode')
  const selected = persisted ?? explicit ?? artifact ?? 'lambda'
  if (artifact !== undefined && artifact !== selected)
    throw new Error(
      `ComputeMode ${artifact} disagrees with persisted mode ${selected}; regenerate the bootstrap and parameter artifacts to change deployment mode`,
    )
  if (explicit !== undefined && explicit !== selected)
    throw new Error(
      `explicit mode ${explicit} disagrees with persisted mode ${selected}; regenerate the bootstrap and parameter artifacts to change deployment mode`,
    )
  return selected
}

export function computeMode(config: { mode?: string }): ComputeMode {
  return resolveComputeMode({ persisted: config.mode })
}
