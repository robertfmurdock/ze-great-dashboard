import { expect, it } from 'vitest'
import { createPipelineApp } from '../src/pipeline-app.ts'

it('pipeline-status route returns public evidence', async () => {
  const app = createPipelineApp({
    id: '101',
    status: 'passed',
    url: 'https://source.example.test/runs/101',
    updatedAt: '2026-10-05T12:02:00.000Z',
  })

  const response = await app.request('/api/panel/controlled/pipeline')
  const body = await response.json()

  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('max-age=60')
  expect(body).toEqual({
    panelId: 'pipeline',
    state: 'ok',
    link: 'https://source.example.test/runs/101',
    signal: { type: 'pipeline-status', status: 'passed', sourceRunId: '101' },
  })
})
