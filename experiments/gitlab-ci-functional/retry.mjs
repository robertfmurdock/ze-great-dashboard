import { readFile } from 'node:fs/promises'

const token = process.env.GITLAB_DASHBOARD_TOKEN
if (!token) throw new Error('GITLAB_DASHBOARD_TOKEN is required')
const { projectId } = JSON.parse(await readFile('/state/project.json', 'utf8'))
const headers = { 'private-token': token }
const pipelines = await fetch(
  `https://gitlab.test/api/v4/projects/${projectId}/pipelines?per_page=1`,
  {
    headers,
  },
).then((response) => response.json())
const pipeline = pipelines[0]
if (!pipeline) throw new Error('No pipeline to retry')
const response = await fetch(
  `https://gitlab.test/api/v4/projects/${projectId}/pipelines/${pipeline.id}/retry`,
  { method: 'POST', headers },
)
if (!response.ok) throw new Error(`Retry returned ${response.status}`)
