import { readFile } from 'node:fs/promises'
import {
  type BoardConfig,
  boardConfigSchema,
  readBoardSchemaModeline,
} from '@ze-great-dashboard/shared'
import { parse as parseYaml, YAMLParseError } from 'yaml'
import {
  boardConfigurationLocation,
  ConfigurationError,
  schemaDiagnostics,
} from './configuration-error.ts'

/** Reads config once at boot, so the config and its derived allowlist can never drift apart. */
export async function loadBoardConfig(
  location: string,
  fetcher: typeof fetch = globalThis.fetch,
  expectedSchemaUrl?: string,
): Promise<BoardConfig> {
  const text = isUrl(location)
    ? await fetchBoardConfig(location, fetcher)
    : await readFile(location, 'utf-8')
  let authoredSchemaUrl: string
  try {
    authoredSchemaUrl = readBoardSchemaModeline(text, expectedSchemaUrl)
  } catch (error) {
    throw new ConfigurationError(error instanceof Error ? error.message : 'Invalid modeline', [
      {
        kind: 'modeline',
        location: 'line 1',
        constraint:
          'Add a first-line yaml-language-server schema modeline ending in /board-config.schema.json.',
      },
    ])
  }
  let parsed: unknown
  try {
    parsed = parseYaml(text)
  } catch (error) {
    const position = error instanceof YAMLParseError ? error.linePos?.[0] : undefined
    const location = position ? `line ${position.line}, column ${position.col}` : 'configuration'
    throw new ConfigurationError(
      `Invalid board configuration YAML at ${location}: correct YAML syntax.`,
      [
        {
          kind: 'yaml',
          location,
          constraint: 'Correct YAML syntax and indentation.',
        },
      ],
    )
  }
  const result = boardConfigSchema.safeParse(parsed)
  if (!result.success) {
    const stale =
      expectedSchemaUrl && authoredSchemaUrl !== expectedSchemaUrl
        ? `\nStale schema modeline: expected ${expectedSchemaUrl}`
        : ''
    throw new ConfigurationError(
      `Invalid board configuration:\n${result.error.message}${stale}`,
      schemaDiagnostics(result.error, (path) => boardConfigurationLocation(parsed, path)),
    )
  }
  return result.data
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

async function fetchBoardConfig(url: string, fetcher: typeof fetch): Promise<string> {
  const response = await fetcher(url)
  if (!response.ok)
    throw new Error(
      `Unable to fetch board configuration from ${url}: ${response.status} ${response.statusText}`,
    )
  return response.text()
}
