import { writeFile } from 'node:fs/promises'

const baseUrl = 'https://gitlab.test/api/v4'
const token = process.env.GITLAB_DASHBOARD_TOKEN
if (!token) throw new Error('GITLAB_DASHBOARD_TOKEN is required')

async function api(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'private-token': token, ...options.headers },
  })
  if (!response.ok)
    throw new Error(`${options.method ?? 'GET'} ${path} returned ${response.status}`)
  return response.json()
}

const projects = await api('/projects?search=dashboard-gitlab-functional&owned=true')
let project = projects.find(
  (candidate) => candidate.path_with_namespace === 'root/dashboard-gitlab-functional',
)
if (!project) {
  project = await api('/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'dashboard-gitlab-functional',
      path: 'dashboard-gitlab-functional',
      visibility: 'private',
    }),
  })
}

const content = `stages: [test]\n\ncontract:\n  image: alpine:3.22\n  tags: [dashboard-functional]\n  script:\n    - echo dashboard-gitlab-functional\n`
try {
  await api(`/projects/${project.id}/repository/files/.gitlab-ci.yml`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ branch: 'main', content, commit_message: 'Create passing pipeline' }),
  })
} catch (error) {
  if (!String(error).includes('returned 400')) throw error
}

const runner = await api('/user/runners', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    runner_type: 'project_type',
    project_id: String(project.id),
    description: 'dashboard-functional',
    tag_list: 'dashboard-functional',
    run_untagged: 'false',
  }),
})
await writeFile(
  '/state/project.json',
  JSON.stringify({ projectId: project.id, runnerToken: runner.token }),
)
