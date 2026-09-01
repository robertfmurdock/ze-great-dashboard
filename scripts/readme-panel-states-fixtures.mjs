export const readmePanelStatesBoard = {
  panels: [
    panel('api-build', 'API Build', 'pipeline-status', { x: 0, y: 0, w: 3, h: 4 }),
    {
      ...panel('unit-tests', 'Unit Tests', 'pipeline-status', { x: 3, y: 0, w: 3, h: 4 }),
      running_animation: 'off',
    },
    panel('deploy-staging', 'Deploy to Staging', 'pipeline-status', { x: 6, y: 0, w: 3, h: 4 }),
    panel('release', 'Release', 'pipeline-status', { x: 9, y: 0, w: 3, h: 4 }),
    panel('dependency-audit', 'Dependency Audit', 'pipeline-status', { x: 0, y: 4, w: 3, h: 4 }),
    panel('integration-checks', 'Integration Checks', 'pipeline-status', {
      x: 3,
      y: 4,
      w: 3,
      h: 4,
    }),
    panel('docs-preview', 'Docs Preview', 'http-value', { x: 6, y: 4, w: 3, h: 4 }),
  ],
}

const observedAt = '2026-08-27T14:00:00.000Z'

export const readmePanelStateEnvelopes = {
  'api-build': pipeline('api-build', 'passed', 'success', 'API Build', 'main', 142_000),
  'unit-tests': pipeline(
    'unit-tests',
    'running',
    'in_progress',
    'Unit Tests',
    'feature/parallel-tests',
    undefined,
    '2026-08-27T13:58:00.000Z',
  ),
  'deploy-staging': pipeline(
    'deploy-staging',
    'failed',
    'failure',
    'Deploy to Staging',
    'main',
    318_000,
  ),
  release: pipeline('release', 'cancelled', 'cancelled', 'Release', 'main', 51_000),
  'dependency-audit': pipeline('dependency-audit', 'unknown', 'queued', 'Dependency Audit', 'main'),
  'integration-checks': pipeline(
    'integration-checks',
    'warning',
    'partiallySucceeded',
    'Integration Checks',
    'main',
    207_000,
  ),
  'docs-preview': {
    panelId: 'docs-preview',
    state: 'error',
    observedAt,
    link: null,
    error: {
      kind: 'upstream-error',
      message: 'Preview endpoint returned 503 — documentation site unavailable',
    },
  },
}

function panel(id, label, type, position) {
  return { id, label, type, position }
}

function pipeline(panelId, status, rawStatus, name, branch, durationMs, runStartedAt) {
  return {
    panelId,
    state: 'ok',
    observedAt,
    link: `https://github.com/example/project/actions/runs/${panelId}`,
    signal: {
      type: 'pipeline-status',
      status,
      rawStatus,
      name,
      branch,
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(runStartedAt === undefined ? {} : { runStartedAt, estimatedDurationMs: 240_000 }),
      sourceUpdatedAt: observedAt,
    },
  }
}
