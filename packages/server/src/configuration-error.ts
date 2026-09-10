import type { ZodError } from 'zod'

export type ConfigurationDiagnostic = {
  kind: 'yaml' | 'modeline' | 'schema' | 'board-selection' | 'panel-admission'
  location: string
  constraint: string
}

export class ConfigurationError extends Error {
  constructor(
    message: string,
    readonly diagnostics: ConfigurationDiagnostic[],
  ) {
    super(message)
  }
}

/** Paths come from schemas, not submitted object keys. Callers replace record keys first. */
export function configurationLocation(path: readonly PropertyKey[]): string {
  return (
    path.reduce<string>(
      (location, part) =>
        typeof part === 'number'
          ? `${location}[${part}]`
          : `${location}${location ? '.' : ''}${String(part)}`,
      '',
    ) || 'configuration'
  )
}

/** The board schema's only authored path segments are the keys of its two root records. */
export function boardConfigurationLocation(config: unknown, path: readonly PropertyKey[]): string {
  const [record, key, ...rest] = path
  if ((record === 'boards' || record === 'sources') && key !== undefined) {
    const entries = config && typeof config === 'object' ? Reflect.get(config, record) : undefined
    const index =
      entries && typeof entries === 'object' ? Object.keys(entries).indexOf(String(key)) : -1
    return configurationLocation([record, index, ...rest])
  }
  return configurationLocation(path)
}

/** Values, record keys, literal alternatives and raw exceptions never become diagnostics. */
export function schemaDiagnostics(
  error: ZodError,
  locate: (path: readonly PropertyKey[]) => string,
  kind: ConfigurationDiagnostic['kind'] = 'schema',
): ConfigurationDiagnostic[] {
  return error.issues.map((issue) => ({
    kind,
    location: locate(issue.path),
    constraint: correctiveConstraint(issue),
  }))
}

function correctiveConstraint(issue: ZodError['issues'][number]): string {
  switch (issue.code) {
    case 'invalid_type':
      return `Provide a value of type ${issue.expected}.`
    case 'too_big':
      return `Use ${issue.inclusive ? 'at most' : 'fewer than'} ${issue.maximum} ${issue.origin === 'array' ? 'entries' : issue.origin === 'string' ? 'characters' : 'as the value'}.`
    case 'too_small':
      return `Use ${issue.inclusive ? 'at least' : 'more than'} ${issue.minimum} ${issue.origin === 'array' ? 'entries' : issue.origin === 'string' ? 'characters' : 'as the value'}.`
    // Format messages are fixed by our schemas (or Zod); unlike custom issues they contain no authored values.
    case 'invalid_format':
      return issue.message
    case 'invalid_value':
      return 'Use one of the values allowed by the board schema.'
    case 'custom':
      return typeof issue.params?.constraint === 'string'
        ? issue.params.constraint
        : 'Correct this field according to the board schema.'
    default:
      return 'Provide a value matching the board schema for this field.'
  }
}
