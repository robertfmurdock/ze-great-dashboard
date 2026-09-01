import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'

describe('the local Entra Compose overlay', () => {
  it('supplies only the in-container token-file path and a read-only token-directory mount', async () => {
    const composePath = fileURLToPath(new URL('../../../docker-compose.entra.yml', import.meta.url))
    const compose = parseYaml(await readFile(composePath, 'utf8')) as {
      services?: { server?: { environment?: Record<string, string>; volumes?: string[] } }
    }

    expect(compose.services?.server?.environment?.ADO_ENTRA_TOKEN_FILE).toBe(
      '/run/dashboard/ado-token.json',
    )
    expect(compose.services?.server?.volumes).toEqual(['./.dashboard-entra:/run/dashboard:ro'])
  })
})
