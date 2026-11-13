import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { expect, test } from 'vitest'

import { checkEvidence } from './check-evidence.mjs'
import { junitCounts, writeTestSummary } from './test-summary.mjs'

test(
  'counts passed, failed, and skipped cases without double-counting JUnit suites',
  mint({
    setup: () => `
    <testsuites tests="3"><testsuite tests="3">
      <testcase name="passes" />
      <testcase name="fails"><failure message="nope" /></testcase>
      <testcase name="skips"><property name="skip" value="unavailable" /></testcase>
    </testsuite></testsuites>
  `,
    exercise: junitCounts,
    verify: (counts) => expect(counts).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1 }),
  }),
)

const reports = {
  [checkEvidence.vitestJUnit]:
    '<testsuites><testcase name="script" /><testcase name="vitest"><skipped /></testcase></testsuites>',
  [checkEvidence.playwrightJUnit]:
    '<testsuites><testcase name="browser"><error /></testcase></testsuites>',
}

async function summaryFixture(scope, reports) {
  const evidenceDirectory = await mkdtemp(join(tmpdir(), 'dashboard-test-summary-'))
  scope.defer('summary fixture directory', () =>
    rm(evidenceDirectory, { recursive: true, force: true }),
  )
  await Promise.all(
    Object.entries(reports).map(([name, xml]) => writeFile(join(evidenceDirectory, name), xml)),
  )
  return {
    evidenceDirectory,
    environment: { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abc123' },
  }
}

test(
  'writes a workflow-bound summary from Vitest and Playwright',
  mint({
    setup: ({ scope }) => summaryFixture(scope, reports),
    exercise: writeTestSummary,
    verify: async (summary, { environment, evidenceDirectory }) => {
      expect(summary).toEqual({
        schemaVersion: 1,
        runId: Number(environment.GITHUB_RUN_ID),
        runAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
        headSha: environment.GITHUB_SHA,
        total: 3,
        passed: 1,
        failed: 1,
        skipped: 1,
      })
      const published = await readFile(join(evidenceDirectory, 'test-summary.json'), 'utf8')
      expect(JSON.parse(published)).toEqual(summary)
    },
  }),
)

for (const [name, xml] of Object.entries(reports)) {
  test(
    `does not publish a partial count with only ${name}`,
    mint({
      setup: ({ scope }) => summaryFixture(scope, { [name]: xml }),
      exercise: writeTestSummary,
      verify: async (summary, { evidenceDirectory }) => {
        expect(summary).toBeUndefined()
        await expect(readFile(join(evidenceDirectory, 'test-summary.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        })
      },
    }),
  )
}
