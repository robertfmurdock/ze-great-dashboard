const MODEL_LINE = /^# yaml-language-server:\s*\$schema=(\S+)\s*$/
const SCHEMA_FILE = 'board-config.schema.json'

export function schemaUrlForAssetPath(assetPath: string): string {
  return `${assetPath.replace(/\/+$/, '')}/${SCHEMA_FILE}`
}

export function readBoardSchemaModeline(source: string, expectedSchemaUrl?: string): string {
  const line = source.split(/\r?\n/)[0]
  if (!line?.includes('yaml-language-server'))
    throw new Error(
      `Board configuration must include a ${SCHEMA_FILE} modeline. Add this as the first line:\n# yaml-language-server: $schema=${expectedSchemaUrl ?? `https://<asset-host>/dashboard/<release-version>/${SCHEMA_FILE}`}`,
    )
  const match = MODEL_LINE.exec(line)
  if (!match?.[1]) {
    throw new Error(
      `Malformed board schema modeline; expected "# yaml-language-server: $schema=<URL>/${SCHEMA_FILE}"`,
    )
  }
  let url: URL
  try {
    url = new URL(match[1])
  } catch {
    throw new Error(`Malformed board schema modeline; schema URL is not a valid URL: ${match[1]}`)
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.pathname.endsWith(`/${SCHEMA_FILE}`)) {
    throw new Error(`Malformed board schema modeline; URL must end in /${SCHEMA_FILE}: ${match[1]}`)
  }
  return match[1]
}

export function boardSchemaModeline(url: string): string {
  return `# yaml-language-server: $schema=${url}`
}

export const boardSchemaFileName = SCHEMA_FILE
