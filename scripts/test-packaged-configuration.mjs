import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { unzipSync } from 'fflate'

export async function testPackagedConfiguration(stagingRoot, artifactRoot) {
  const cli = join(stagingRoot, 'aws/dist/cli.js')
  const boardPath = join(artifactRoot, 'facts.yaml')
  const modeline = '# yaml-language-server: $schema=https://example.com/board-config.schema.json\n'
  const facts = Array.from({ length: 5 }, (_, i) => ({
    id: `fact${i}`,
    label: `Fact ${i}`,
    url: `https://private.example/${i}`,
  }))
  const board = (panel) =>
    modeline + JSON.stringify({ boards: { team: { panels: [{ id: 'values', ...panel }] } } })
  const parameters = join(artifactRoot, 'validation-parameters.json')
  for (const mode of ['lambda', 'ecs']) {
    await writeFile(
      parameters,
      JSON.stringify([
        { ParameterKey: 'ComputeMode', ParameterValue: mode },
        ...(mode === 'lambda'
          ? [{ ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'test-artifacts' }]
          : [
              { ParameterKey: 'Subnets', ParameterValue: 'subnet-00000000000000000' },
              { ParameterKey: 'SecurityGroups', ParameterValue: 'sg-00000000000000000' },
            ]),
      ]),
    )
    for (const scenario of [
      { name: 'five', panel: { type: 'http-value', facts }, expected: /facts[\s\S]*4/ },
      {
        name: 'unsupported',
        panel: { type: 'unknown' },
        expected: /Unsupported configured panel operation/,
      },
      { name: 'missing', panel: { type: 'http-value' }, expected: /url/ },
    ]) {
      await writeFile(boardPath, board(scenario.panel))
      const output = join(artifactRoot, `${mode}-${scenario.name}`)
      assert.throws(
        () =>
          execFileSync(
            process.execPath,
            [
              cli,
              'package',
              '--board-config',
              boardPath,
              '--parameters',
              parameters,
              '--mode',
              mode,
              '--image',
              `example.com/server@sha256:${'a'.repeat(64)}`,
              '--output',
              output,
            ],
            { stdio: 'pipe' },
          ),
        (error) => {
          assert.match(String(error.stderr), scenario.expected)
          assert.ok(String(error.stderr).includes(boardPath))
          return error.status !== 0
        },
      )
      await assert.rejects(stat(output), { code: 'ENOENT' })
    }
  }
  await writeFile(
    parameters,
    JSON.stringify([{ ParameterKey: 'LambdaArtifactBucket', ParameterValue: 'test-artifacts' }]),
  )
  await writeFile(boardPath, board({ type: 'http-value', facts: facts.slice(0, 4) }))
  const output = join(artifactRoot, 'four-facts')
  execFileSync(
    process.execPath,
    [cli, 'package', '--board-config', boardPath, '--parameters', parameters, '--output', output],
    { stdio: 'pipe' },
  )
  const runtime = join(artifactRoot, 'runtime')
  await mkdir(runtime)
  for (const [name, bytes] of Object.entries(unzipSync(await readFile(join(output, 'lambda.zip')))))
    await writeFile(join(runtime, name), bytes)
  const template = createServer((_request, response) =>
    response.end('<html><head></head><body></body></html>'),
  )
  await new Promise((resolve) => template.listen(0, '127.0.0.1', resolve))
  const previous = { ...process.env }
  const logs = []
  const log = console.log
  try {
    process.env.ASSET_PATH = `http://127.0.0.1:${template.address().port}`
    process.env.BOARD_CONFIG_URL = boardPath
    process.env.BOARD = 'team'
    delete process.env.SECRET_REFERENCE
    console.log = (message) => logs.push(JSON.parse(message))
    const { handler } = await import(pathToFileURL(join(runtime, 'index.mjs')))
    const event = {
      version: '2.0',
      rawPath: '/api/boards/team',
      rawQueryString: '',
      headers: { host: 'localhost' },
      requestContext: { http: { method: 'GET', path: '/api/boards/team', sourceIp: '127.0.0.1' } },
    }
    for (const invalid of [
      { text: 'secret-yaml: [', kind: 'modeline', location: /^line 1$/, constraint: /first-line/ },
      {
        text: `${modeline}secret-yaml: [`,
        kind: 'yaml',
        location: /^line 2, column \d+$/,
        constraint: /YAML syntax/,
      },
      {
        text: board({ type: 'http-value', facts }),
        kind: 'schema',
        location: /^boards\[0\]\.panels\[0\]\.facts$/,
        constraint: /at most 4 entries/,
      },
      {
        text: board({ type: 'secret-type', source: 'SECRET_TOKEN' }),
        kind: 'panel-admission',
        location: /^boards\[0\]\.panels\[0\]$/,
        constraint: /supported panel\/source combination/,
      },
      {
        text:
          modeline +
          JSON.stringify({
            boards: { secret: { panels: [{ id: 'secret', type: 'pipeline-animation-demo' }] } },
          }),
        kind: 'board-selection',
        location: /^BOARD$/,
        constraint: /Select a board/,
      },
      {
        text:
          modeline +
          JSON.stringify({
            sources: {
              'private-first': { type: 'unused' },
              'private-source': { type: 'github-actions', token_env: 'SECRET_TOKEN' },
            },
            boards: {
              team: {
                panels: [
                  {
                    id: 'private-panel',
                    type: 'pipeline-status',
                    source: 'private-source',
                    pipeline: 'ci.yml',
                  },
                ],
              },
            },
          }),
        kind: 'panel-admission',
        location: /^sources\[1\]\.repo$/,
        constraint: /type string/,
      },
      {
        text:
          modeline +
          JSON.stringify({
            sources: {
              'private-first': { type: 'unused' },
              'private-source': { type: 'github-actions', repo: 'private-repo' },
            },
            boards: {
              team: {
                panels: [
                  {
                    id: 'private-panel',
                    type: 'pipeline-status',
                    source: 'private-source',
                    pipeline: 'ci.yml',
                  },
                ],
              },
            },
          }),
        kind: 'panel-admission',
        location: /^sources\[1\]\.repo$/,
        constraint: /owner\/repository pair/,
      },
      {
        text:
          modeline +
          JSON.stringify({
            sources: { 'private-source': { type: 'github-actions', repo: 'example/project' } },
            boards: {
              team: {
                panels: [
                  { id: 'private-panel', type: 'pipeline-status', source: 'private-source' },
                ],
              },
            },
          }),
        kind: 'panel-admission',
        location: /^boards\[0\]\.panels\[0\]\.pipeline$/,
        constraint: /type string/,
      },
      {
        text:
          modeline +
          JSON.stringify({
            sources: {
              'private-source': {
                type: 'github-actions',
                token_env: { SECRET_TOKEN: 'private-value' },
              },
            },
            boards: {
              team: { panels: [{ id: 'private-panel', type: 'pipeline-animation-demo' }] },
            },
          }),
        kind: 'schema',
        location: /^sources\[0\]\.token_env$/,
        constraint: /type string/,
      },
      {
        text:
          modeline +
          JSON.stringify({
            boards: {
              'private-board': { panels: [{ id: 'demo', type: 'pipeline-animation-demo' }] },
              team: {
                panels: [
                  { id: 'private-duplicate', type: 'pipeline-animation-demo' },
                  { id: 'private-duplicate', type: 'pipeline-animation-demo' },
                ],
              },
            },
          }),
        kind: 'schema',
        location: /^boards\[1\]\.panels\[1\]\.id$/,
        constraint: /unique panel id/,
      },
    ]) {
      await writeFile(boardPath, invalid.text)
      const response = await handler(event, {})
      assert.equal(response.statusCode, 503)
      assert.equal(response.headers['cache-control'], 'no-store')
      const body = JSON.parse(response.body)
      assert.equal(body.code, 'dashboard_startup_failed')
      const diagnostic = logs.findLast((entry) => entry.event === 'server.startup_failed')
      assert.equal(body.supportReference, diagnostic.supportReference)
      assert.equal(diagnostic.category, 'board-config')
      assert.equal(diagnostic.configuration[0].kind, invalid.kind)
      assert.match(diagnostic.configuration[0].location, invalid.location)
      assert.match(diagnostic.configuration[0].constraint, invalid.constraint)
      assert.doesNotMatch(
        JSON.stringify({ body, diagnostic }),
        /private[.-]|SECRET_TOKEN|secret-type|secret-yaml/,
      )
    }
    await writeFile(boardPath, await readFile(join(runtime, 'board.yaml')))
    const response = await handler(event, {})
    assert.equal(response.statusCode, 200)
    assert.deepEqual(JSON.parse(response.body).panels[0].facts, facts.slice(0, 4))
  } finally {
    console.log = log
    process.env = previous
    await new Promise((resolve) => template.close(resolve))
  }
}
