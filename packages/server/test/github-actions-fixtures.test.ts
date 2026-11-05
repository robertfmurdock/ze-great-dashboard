import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'

const fixtureDirectory = new URL('../../../fixtures/github-actions/', import.meta.url)

const cases = [
  { fixtureName: 'success', expectedStatus: 'completed', expectedConclusion: 'success' },
  { fixtureName: 'failure', expectedStatus: 'completed', expectedConclusion: 'failure' },
  { fixtureName: 'in-progress', expectedStatus: 'in_progress', expectedConclusion: null },
  { fixtureName: 'cancelled', expectedStatus: 'completed', expectedConclusion: 'cancelled' },
] as const

describe('GitHub Actions Stage 0 fixtures', () => {
  for (const scenario of cases) {
    test(
      `preserves the real ${scenario.fixtureName} status combination`,
      mint({
        setup: () => ({
          ...scenario,
          fixturePath: fileURLToPath(
            new URL(`workflow-run-${scenario.fixtureName}.json`, fixtureDirectory),
          ),
          expectedRepository: 'example-org/example-repo',
        }),
        exercise: ({ fixturePath }) =>
          JSON.parse(readFileSync(fixturePath, 'utf8')) as {
            status: string
            conclusion: string | null
            repository: { full_name: string }
          },
        verify: (fixture, { expectedStatus, expectedConclusion, expectedRepository }) => {
          expect(fixture.status).toBe(expectedStatus)
          expect(fixture.conclusion).toBe(expectedConclusion)
          expect(fixture.repository.full_name).toBe(expectedRepository)
        },
      }),
    )
  }
})
