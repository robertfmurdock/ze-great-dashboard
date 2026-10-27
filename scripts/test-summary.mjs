import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkEvidence } from './check-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Counts JUnit case outcomes without adding an XML parser dependency. */
export function junitCounts(xml) {
  const cases = xml.match(/<testcase\b[\s\S]*?(?:\/>|<\/testcase>)/g) ?? []
  return cases.reduce(
    (counts, testCase) => {
      counts.total += 1
      if (/<(?:failure|error)\b/.test(testCase)) counts.failed += 1
      else if (/<skipped\b|<property\s+name=["']skip["']/.test(testCase)) counts.skipped += 1
      else counts.passed += 1
      return counts
    },
    { total: 0, passed: 0, failed: 0, skipped: 0 },
  )
}

export async function writeTestSummary({
  evidenceDirectory = resolve(root, checkEvidence.directoryName),
  environment = process.env,
} = {}) {
  const runId = positiveInteger(environment.GITHUB_RUN_ID, 'GITHUB_RUN_ID')
  const runAttempt = positiveInteger(environment.GITHUB_RUN_ATTEMPT, 'GITHUB_RUN_ATTEMPT')
  const headSha = required(environment.GITHUB_SHA, 'GITHUB_SHA')
  const reports = [
    checkEvidence.nodeJUnit,
    checkEvidence.vitestJUnit,
    checkEvidence.playwrightJUnit,
  ]
  let xml
  try {
    xml = await Promise.all(
      reports.map((report) => readFile(resolve(evidenceDirectory, report), 'utf8')),
    )
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') return undefined
    throw error
  }
  const counts = xml
    .map(junitCounts)
    .reduce(addCounts, { total: 0, passed: 0, failed: 0, skipped: 0 })
  const summary = { schemaVersion: 1, runId, runAttempt, headSha, ...counts }
  await writeFile(resolve(evidenceDirectory, 'test-summary.json'), `${JSON.stringify(summary)}\n`)
  return summary
}

function addCounts(left, right) {
  return {
    total: left.total + right.total,
    passed: left.passed + right.passed,
    failed: left.failed + right.failed,
    skipped: left.skipped + right.skipped,
  }
}

function positiveInteger(value, name) {
  if (!/^[1-9]\d*$/.test(value ?? '')) throw new Error(`${name} must be a positive integer.`)
  return Number(value)
}

function required(value, name) {
  if (!value) throw new Error(`${name} is required.`)
  return value
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await writeTestSummary()
