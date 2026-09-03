import type { Board, ClientEnv } from '@ze-great-dashboard/shared'
import { describe, expect, it } from 'vitest'
import { initialPollingSchedule, panelProxyPath, pollingPanels } from '../src/polling-panels.ts'

const env: ClientEnv = {
  assetPath: 'https://assets.example.com/dashboard/1',
  assetPathId: 'id',
  proxyPath: '/api',
  board: 'team space',
}

describe('polling panel setup', () => {
  it('selects visible supported panels and declares only their known initial proxy paths', () => {
    const board: Board = {
      refresh: '45s',
      panels: [
        { id: 'build', label: 'Build', type: 'pipeline-status' },
        { id: 'hidden', type: 'http-value', position: { x: 0, y: 0, w: 0, h: 0 } },
        { id: 'demo', type: 'pipeline-animation-demo' },
        {
          id: 'updates',
          type: 'pull-request-health',
          update_workflows: [{ workflow: 'dependency update.yml' }],
        },
      ],
    }
    const panels = pollingPanels(board)
    expect(panels.map((panel) => panel.id)).toEqual(['build', 'updates'])
    expect(panelProxyPath(env, 'team/build')).toBe('/api/panel/team%20space/team%2Fbuild')
    const updates = panels.find((panel) => panel.id === 'updates')
    if (!updates) throw new Error('Expected updates polling panel.')
    expect(initialPollingSchedule(board, env, updates)).toMatchObject({
      panelId: 'updates',
      label: 'updates',
      settings: { refreshMillis: 45_000 },
      knownPaths: [
        '/api/panel/team%20space/updates/pull-requests',
        '/api/panel/team%20space/updates/update-workflow/dependency%20update.yml',
      ],
    })
  })
})
