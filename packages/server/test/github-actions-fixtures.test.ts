import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const fixtureDirectory = new URL('../../../fixtures/github-actions/', import.meta.url)

const cases = [
  ['success', 'completed', 'success'],
  ['failure', 'completed', 'failure'],
  ['in-progress', 'in_progress', null],
  ['cancelled', 'completed', 'cancelled'],
] as const

describe('GitHub Actions Stage 0 fixtures', () => {
  it.each(cases)('preserves the real %s status combination', (name, status, conclusion) => {
    const file = new URL(`workflow-run-${name}.json`, fixtureDirectory)
    const fixture = JSON.parse(readFileSync(fileURLToPath(file), 'utf-8')) as {
      status: string
      conclusion: string | null
      repository: { full_name: string }
    }

    expect(fixture.status).toBe(status)
    expect(fixture.conclusion).toBe(conclusion)
    expect(fixture.repository.full_name).toBe('example-org/example-repo')
  })
})
