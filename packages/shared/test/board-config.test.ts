import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { boardConfigSchema } from '../src/board-config.ts'
import { parseDuration } from '../src/duration.ts'

describe('the example board configs', () => {
  // Cheap, and it catches the schema drifting away from its own documentation — the example is
  // what a new board author copies, so it being invalid is worse than a broken test.
  const exampleUrl = new URL('../../../boards/example.yaml', import.meta.url)

  it('validate against the schema', () => {
    const raw = parseYaml(readFileSync(fileURLToPath(exampleUrl), 'utf-8'))
    const result = boardConfigSchema.safeParse(raw)

    expect(result.error?.issues ?? []).toEqual([])
    expect(result.success).toBe(true)
  })

  it('keeps credentials out of the file, naming env vars instead', () => {
    const text = readFileSync(fileURLToPath(exampleUrl), 'utf-8')

    expect(text).toContain('token_env:')
    // The failure mode here is a PAT in git history, which is not a thing to discover later.
    expect(text).not.toMatch(/token:\s*\S/)
    expect(text).not.toMatch(/password:\s*\S/)
  })
})

describe('the board config schema', () => {
  const validConfig = {
    boards: {
      'ze-great-team': {
        refresh: '60s',
        panels: [{ id: 'api-build', type: 'pipeline-status', source: 'ado-main' }],
      },
    },
  }

  it('rejects duplicate panel ids loudly rather than picking one', () => {
    const result = boardConfigSchema.safeParse({
      boards: {
        'ze-great-team': {
          panels: [
            { id: 'api-build', type: 'pipeline-status' },
            { id: 'api-build', type: 'http-value' },
          ],
        },
      },
    })

    // Ids key the allowlist and address panels in the proxy URL, so a duplicate resolving to
    // "whichever came first" would silently repoint a URL. That makes this security-relevant.
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toMatch(/duplicate panel id "api-build"/)
  })

  it('requires an id and a type on every panel', () => {
    expect(
      boardConfigSchema.safeParse({
        boards: { a: { panels: [{ type: 'pipeline-status' }] } },
      }).success,
    ).toBe(false)

    expect(boardConfigSchema.safeParse({ boards: { a: { panels: [{ id: 'x' }] } } }).success).toBe(
      false,
    )
  })

  it('treats position as optional, so a board without one still renders', () => {
    expect(boardConfigSchema.safeParse(validConfig).success).toBe(true)
  })

  it('accepts named display roles and preserves unknown cosmetic roles for compatibility', () => {
    expect(
      boardConfigSchema.safeParse({
        boards: { a: { panels: [{ id: 'primary', type: 'pipeline-status', display: 'primary' }] } },
      }).success,
    ).toBe(true)
    const futureRole = boardConfigSchema.parse({
      boards: { a: { panels: [{ id: 'custom', type: 'http-value', display: 'hero' }] } },
    })
    expect(futureRole.boards.a?.panels[0]?.display).toBe('hero')
  })

  it('rejects a malformed refresh instead of letting it become NaN later', () => {
    const result = boardConfigSchema.safeParse({
      boards: { a: { refresh: 'soon', panels: [{ id: 'x', type: 'y' }] } },
    })

    expect(result.success).toBe(false)
  })

  it('preserves signal-specific fields it does not yet know about', () => {
    const result = boardConfigSchema.parse({
      boards: {
        a: {
          panels: [{ id: 'v', type: 'http-value', url: 'https://x/version', json_path: '$.v' }],
        },
      },
    })

    // Stage 2 tightens these per signal type; until then they must survive parsing rather than
    // being stripped, or the adapters would receive a config missing the fields they need.
    expect(result.boards.a?.panels[0]).toMatchObject({ json_path: '$.v' })
  })
})

describe('duration parsing', () => {
  it('reads the units a board author would write', () => {
    expect(parseDuration('500ms')).toBe(500)
    expect(parseDuration('30s')).toBe(30_000)
    expect(parseDuration('5m')).toBe(300_000)
    expect(parseDuration('1h')).toBe(3_600_000)
  })

  it('rejects anything else', () => {
    for (const bad of ['', 'soon', '30', '-5s', '0s', '5 s', '5S', '1d']) {
      expect(parseDuration(bad), bad).toBeNull()
    }
  })
})
