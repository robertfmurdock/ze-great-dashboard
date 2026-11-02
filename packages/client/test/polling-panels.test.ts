import { mint } from '@continuous-excellence/testmints-js/vitest'
import { type Board, type ClientEnv, durationSchema } from '@ze-great-dashboard/shared/browser'
import { describe, expect, it } from 'vitest'
import { panelFeatures } from '../src/panel-registry.tsx'
import { initialPollingSchedule, panelProxyPath, pollingPanels } from '../src/polling-panels.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1',
  assetPathId: 'id',
  proxyPath: '/api',
  board: 'team space',
}

describe('polling feature selection', () => {
  it(
    'selects visible remote panels while excluding hidden and local panels',
    mint({
      setup: () => {
        const build = { id: 'build', type: 'pipeline-status' }
        const tests = { id: 'tests', type: 'test-count' }
        return {
          build,
          tests,
          board: {
            panels: [
              build,
              tests,
              { id: 'hidden', type: 'http-value', position: { x: 0, y: 0, w: 0, h: 0 } },
              { id: 'demo', type: 'pipeline-animation-demo' },
            ],
          } satisfies Board,
        }
      },
      exercise: ({ board }) => pollingPanels(board),
      verify: (selected, { build, tests }) =>
        expect(selected.map(({ panel }) => panel)).toEqual([build, tests]),
    }),
  )
})

describe('polling proxy paths', () => {
  it(
    'encodes board and panel identifiers as individual path segments',
    mint({
      setup: () => ({
        panelId: 'team/build',
        expectedPath: '/api/panel/team%20space/team%2Fbuild',
      }),
      exercise: ({ panelId }) => panelProxyPath(env, panelId),
      verify: (path, { expectedPath }) => expect(path).toBe(expectedPath),
    }),
  )
})

describe('initial polling schedule', () => {
  it(
    'declares configured update paths without claiming branch-dependent requests',
    mint({
      setup: () => {
        const workflow = 'dependency update.yml'
        const panel = {
          id: 'updates',
          type: 'pull-request-health',
          update_workflows: [{ workflow }],
        }
        const refreshMillis = 45_000
        const refresh = durationSchema.parse(`${refreshMillis}ms`)
        return {
          panel,
          workflow,
          board: { refresh, panels: [panel] },
          refreshMillis,
          polling: panelFeatures['pull-request-health'].polling,
        }
      },
      exercise: ({ board, panel, polling }) =>
        initialPollingSchedule(board, env, { panel, polling }),
      verify: (schedule, { panel, workflow, refreshMillis }) => {
        const root = `/api/panel/${encodeURIComponent(env.board)}/${panel.id}`
        expect(schedule).toMatchObject({
          panelId: panel.id,
          label: panel.id,
          settings: { refreshMillis },
          knownPaths: [
            `${root}/pull-requests`,
            `${root}/update-workflow/${encodeURIComponent(workflow)}`,
          ],
        })
      },
    }),
  )
})
