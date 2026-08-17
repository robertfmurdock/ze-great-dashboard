import { readFile } from 'node:fs/promises'
import { type BoardConfig, boardConfigSchema } from '@ze-great-dashboard/shared'
import { parse as parseYaml } from 'yaml'

/** Reads config once at boot, so the config and its derived allowlist can never drift apart. */
export async function loadBoardConfig(
  location: string,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<BoardConfig> {
  const text = isUrl(location)
    ? await fetchBoardConfig(location, fetcher)
    : await readFile(location, 'utf-8')
  const result = boardConfigSchema.safeParse(parseYaml(text))
  if (!result.success) throw new Error(`Invalid board configuration:\n${result.error.message}`)
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
