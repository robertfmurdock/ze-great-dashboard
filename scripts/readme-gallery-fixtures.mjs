const observedAt = '2026-08-27T14:00:00.000Z'

const panel = (id, label, position, attention = false) => ({
  id,
  label,
  type: 'pipeline-status',
  position,
  ...(attention ? { attention: true } : {}),
})

const pipeline = (panelId, status, rawStatus, name, branch = 'main') => ({
  panelId,
  state: 'ok',
  observedAt,
  link: null,
  signal: {
    type: 'pipeline-status',
    status,
    rawStatus,
    name,
    branch,
    sourceUpdatedAt: observedAt,
  },
})

/** Source-free, browser-intercepted scenarios used only to make README evidence reproducible. */
export const readmeGalleryScenarios = {
  status: {
    output: 'docs/assets/readme-status-vocabulary.png',
    viewport: { width: 1600, height: 1000 },
    board: {
      panels: [
        panel('api-build', 'API Build', { x: 0, y: 0, w: 3, h: 5 }),
        panel('unit-tests', 'Unit Tests', { x: 3, y: 0, w: 3, h: 5 }),
        panel('deploy-staging', 'Deploy to Staging', { x: 6, y: 0, w: 3, h: 5 }),
        panel('release', 'Release', { x: 9, y: 0, w: 3, h: 5 }),
        panel('dependency-audit', 'Dependency Audit', { x: 0, y: 5, w: 3, h: 5 }),
        panel('integration-checks', 'Integration Checks', { x: 3, y: 5, w: 3, h: 5 }),
        {
          id: 'docs-preview',
          label: 'Docs Preview',
          type: 'http-value',
          position: { x: 6, y: 5, w: 3, h: 5 },
        },
      ],
    },
    envelopes: {
      'api-build': pipeline('api-build', 'passed', 'success', 'API Build'),
      'unit-tests': pipeline('unit-tests', 'running', 'in_progress', 'Unit Tests'),
      'deploy-staging': pipeline('deploy-staging', 'failed', 'failure', 'Deploy to Staging'),
      release: pipeline('release', 'cancelled', 'cancelled', 'Release'),
      'dependency-audit': pipeline('dependency-audit', 'unknown', 'queued', 'Dependency Audit'),
      'integration-checks': pipeline(
        'integration-checks',
        'warning',
        'partiallySucceeded',
        'Integration Checks',
      ),
      'docs-preview': {
        panelId: 'docs-preview',
        state: 'error',
        observedAt,
        link: null,
        error: { kind: 'upstream-error', message: 'Preview endpoint returned 503' },
      },
    },
    expectedText: [
      'Passed',
      'Running',
      'Failed',
      'Cancelled',
      'Unknown',
      'Warning',
      'Source unavailable',
    ],
    ready: '[data-panel-id="docs-preview"]',
  },
  attention: {
    output: 'docs/assets/readme-important-attention.png',
    viewport: { width: 1440, height: 900 },
    board: {
      attention: { treatment: 'alarm' },
      panels: [
        panel('build', 'Build', { x: 0, y: 0, w: 6, h: 7 }, true),
        panel('deploy', 'Production Deploy', { x: 6, y: 0, w: 6, h: 7 }, true),
      ],
    },
    envelopes: {
      build: pipeline('build', 'failed', 'failure', 'Build'),
      deploy: {
        panelId: 'deploy',
        state: 'error',
        observedAt,
        link: null,
        error: { kind: 'upstream-error', message: 'Deployment authority is unavailable' },
      },
    },
    expectedText: [
      'Build: Pipeline failed',
      'Production Deploy: Deployment authority is unavailable',
      'Failed',
      'Source unavailable',
    ],
    expectedAlertLabel: 'Important panel attention',
    ready: '[role="alert"]',
  },
  warning: {
    output: 'docs/assets/readme-authless-warning.png',
    viewport: { width: 1440, height: 900 },
    host: '0.0.0.0',
    board: { panels: [panel('build', 'Build', { x: 0, y: 0, w: 12, h: 7 })] },
    envelopes: { build: pipeline('build', 'passed', 'success', 'Build') },
    expectedText: ['This deployment has no authentication.', 'Build', 'Passed'],
    ready: '[aria-label="Unauthenticated deployment warning"]',
  },
  blocked: {
    output: 'docs/assets/readme-authentication-required.png',
    viewport: { width: 1440, height: 900 },
    host: '0.0.0.0',
    boardConfig: 'boards/readme-authentication-required.yaml',
    board: { panels: [] },
    envelopes: {},
    expectedText: ['Authentication configuration required', 'No dashboard data was loaded.'],
    ready: '[role="alert"]',
    expectsNoBoardData: true,
  },
}
