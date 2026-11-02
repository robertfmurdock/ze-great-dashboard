import { mint } from '@continuous-excellence/testmints-js/vitest'
import type {
  Envelope,
  Panel,
  PipelineStatus,
  TestEvidence,
} from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { panelDiagnosticChanged, projectPanelDiagnostic } from '../src/panel-diagnostics.ts'

const observedAt = '2026-11-02T15:00:00.000Z'
const panel: Panel = { id: 'build', type: 'pipeline-status' }
function runEnvelope(tests: TestEvidence) {
  return {
    panelId: panel.id,
    state: 'ok',
    observedAt,
    link: null,
    signal: {
      type: 'pipeline-status',
      status: 'passed',
      rawStatus: 'success',
      name: 'Build',
      testResults: tests,
    } satisfies PipelineStatus,
  } satisfies Envelope
}

describe('public test evidence diagnostics', () => {
  test(
    'recognizes test evidence arriving after an unchanged build result',
    mint({
      setup: () => ({
        previous: runEnvelope({
          state: 'ok',
          observedAt,
          signal: { type: 'test-count', status: 'not-reported' },
        }),
        next: runEnvelope({
          state: 'ok',
          observedAt,
          signal: { type: 'test-count', status: 'reported', total: 37 },
        }),
      }),
      exercise: ({ previous, next }) => panelDiagnosticChanged(previous, panel, next),
      verify: (changed) => expect(changed).toBe(true),
    }),
  )
  test(
    'projects a test failure without losing the successful build status',
    mint({
      setup: () => {
        const error = { kind: 'upstream-error', message: 'Artifact expired' } as const
        return { error, envelope: runEnvelope({ state: 'error', observedAt, error }) }
      },
      exercise: ({ envelope }) => projectPanelDiagnostic(panel, envelope),
      verify: (diagnostic, { error, envelope }) =>
        expect(diagnostic).toMatchObject({
          state: 'ok',
          status: envelope.signal.status,
          tests: { state: 'error', ...error },
        }),
    }),
  )
  test(
    'does not report observation time alone as a visible change',
    mint({
      setup: () => {
        const signal = { type: 'test-count', status: 'reported', total: 37 } as const
        return {
          previous: runEnvelope({ state: 'ok', observedAt, signal }),
          next: runEnvelope({ state: 'ok', observedAt: '2026-11-02T15:01:00.000Z', signal }),
        }
      },
      exercise: ({ previous, next }) => panelDiagnosticChanged(previous, panel, next),
      verify: (changed) => expect(changed).toBe(false),
    }),
  )
})
