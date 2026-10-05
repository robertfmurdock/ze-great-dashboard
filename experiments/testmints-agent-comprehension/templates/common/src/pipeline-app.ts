import { Hono } from 'hono'

export type UpstreamPipelineRun = {
  id: string
  status: 'passed' | 'failed'
  url: string
  updatedAt?: string
}

export function createPipelineApp(run: UpstreamPipelineRun) {
  const app = new Hono()
  app.get('/api/panel/controlled/pipeline', (context) =>
    context.json(
      {
        panelId: 'pipeline',
        state: 'ok',
        link: run.url,
        signal: { type: 'pipeline-status', status: run.status, sourceRunId: run.id },
      },
      200,
      { 'cache-control': 'max-age=60' },
    ),
  )
  return app
}
