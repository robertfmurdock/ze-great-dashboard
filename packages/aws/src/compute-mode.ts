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
  const persisted = valid(input.persisted ?? 'lambda', 'persisted mode')
  if (input.artifact !== undefined && valid(input.artifact, 'ComputeMode') !== persisted)
    throw new Error(
      `ComputeMode ${input.artifact} disagrees with persisted mode ${persisted}; regenerate the bootstrap and parameter artifacts to change deployment mode`,
    )
  if (input.explicit !== undefined && valid(input.explicit, 'mode') !== persisted)
    throw new Error(
      `explicit mode ${input.explicit} disagrees with persisted mode ${persisted}; regenerate the bootstrap and parameter artifacts to change deployment mode`,
    )
  return persisted
}

export function computeMode(config: { mode?: string }): ComputeMode {
  return resolveComputeMode({ persisted: config.mode })
}
