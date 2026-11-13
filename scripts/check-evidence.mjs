import { join } from 'node:path'

export const checkEvidence = Object.freeze({
  directoryName: 'check-results',
  summaryJson: 'summary.json',
  summaryMarkdown: 'summary.md',
  vitestJUnit: 'vitest.xml',
  playwrightJUnit: 'playwright.xml',
  playwrightArtifacts: 'playwright-artifacts',
})

export function checkEvidencePaths(cwd = process.cwd()) {
  const directory = join(cwd, checkEvidence.directoryName)
  return {
    directory,
    summaryJson: join(directory, checkEvidence.summaryJson),
    summaryMarkdown: join(directory, checkEvidence.summaryMarkdown),
    vitestJUnit: join(directory, checkEvidence.vitestJUnit),
    playwrightJUnit: join(directory, checkEvidence.playwrightJUnit),
    playwrightArtifacts: join(directory, checkEvidence.playwrightArtifacts),
  }
}

export function playwrightEvidenceOptions(checkResultsDirectory) {
  if (!checkResultsDirectory) return undefined
  return {
    junitOutputFile: join(checkResultsDirectory, checkEvidence.playwrightJUnit),
    arguments: [
      '--reporter=junit',
      `--output=${join(checkResultsDirectory, checkEvidence.playwrightArtifacts)}`,
    ],
  }
}
