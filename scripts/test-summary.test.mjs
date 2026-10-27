import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { checkEvidence } from './check-evidence.mjs'
import { junitCounts, writeTestSummary } from './test-summary.mjs'

test('counts passed, failed, and skipped cases without double-counting JUnit suites', () => {
  assert.deepEqual(
    junitCounts(`
      <testsuites tests="3"><testsuite tests="3">
        <testcase name="passes" />
        <testcase name="fails"><failure message="nope" /></testcase>
        <testcase name="skips"><property name="skip" value="unavailable" /></testcase>
      </testsuite></testsuites>
    `),
    { total: 3, passed: 1, failed: 1, skipped: 1 },
  )
})

test('writes one workflow-bound summary from every aggregate test report', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-test-summary-'))
  try {
    await Promise.all([
      writeFile(
        join(directory, checkEvidence.nodeJUnit),
        '<testsuites><testcase name="node" /></testsuites>',
      ),
      writeFile(
        join(directory, checkEvidence.vitestJUnit),
        '<testsuites><testcase name="vitest"><skipped /></testcase></testsuites>',
      ),
      writeFile(
        join(directory, checkEvidence.playwrightJUnit),
        '<testsuites><testcase name="browser"><error /></testcase></testsuites>',
      ),
    ])
    const summary = await writeTestSummary({
      evidenceDirectory: directory,
      environment: { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abc123' },
    })
    assert.deepEqual(summary, {
      schemaVersion: 1,
      runId: 42,
      runAttempt: 2,
      headSha: 'abc123',
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('does not publish a partial count when an aggregate report is absent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dashboard-test-summary-'))
  try {
    await writeFile(
      join(directory, checkEvidence.nodeJUnit),
      '<testsuites><testcase name="node" /></testsuites>',
    )
    assert.equal(
      await writeTestSummary({
        evidenceDirectory: directory,
        environment: { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abc123' },
      }),
      undefined,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
