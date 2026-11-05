import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResourceScope } from '@continuous-excellence/testmints-js'
import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, test } from 'vitest'
import { stringify } from 'yaml'
import { assembleRelease, clientAssetUrl, validateBoardConfig } from '../src/index.ts'

const modeline =
  '# yaml-language-server: $schema=https://public-assets.zegreatrob.com/dashboard/0.18.0/board-config.schema.json'

async function boardFixture(scope: ResourceScope, source: string) {
  const root = await scope.using(
    'consumer release directory',
    () => mkdtemp(join(tmpdir(), 'dashboard-core-')),
    (directory) => rm(directory, { recursive: true, force: true }),
  )
  const boardPath = join(root, 'board.yaml')
  await writeFile(boardPath, source)
  return { root, boardPath }
}

function rejects<Input>(action: (input: Input) => Promise<unknown>) {
  return async (input: Input) => {
    try {
      await action(input)
    } catch (error) {
      return error
    }
    throw new Error('Expected the exercise to reject.')
  }
}

describe('consumer board validation', () => {
  test(
    'validates the example consumer board',
    mint({
      setup: () => ({
        boardPath: fileURLToPath(new URL('../../../boards/example.yaml', import.meta.url)),
      }),
      exercise: ({ boardPath }) => validateBoardConfig(boardPath),
      verify: (board) => expect(board.config.boards.example).toBeDefined(),
    }),
  )

  test(
    'rejects invalid consumer board configuration',
    mint({
      setup: ({ scope }) =>
        boardFixture(scope, `${modeline}\nboards: {demo: {panels: []}}\nsources: {}\n`),
      exercise: rejects<{ boardPath: string }>(({ boardPath }) => validateBoardConfig(boardPath)),
      verify: (error) =>
        expect(error).toMatchObject({
          message: expect.stringMatching(/Invalid board configuration/),
        }),
    }),
  )

  test(
    'preserves density settings through the release boundary',
    mint({
      setup: async ({ scope }) => {
        const panels = [
          { id: 'build', type: 'pipeline-status', density: 'comfortable' },
          { id: 'future', type: 'http-value', density: 'compact' },
        ]
        const source = `${modeline}\n${stringify({ boards: { demo: { panels } }, sources: {} })}`
        return { ...(await boardFixture(scope, source)), panels }
      },
      exercise: ({ boardPath }) => validateBoardConfig(boardPath),
      verify: (result, { panels }) => {
        expect(result.config.boards.demo?.panels).toEqual(panels)
        for (const panel of panels) expect(result.yaml).toContain(`density: ${panel.density}`)
      },
    }),
  )
})

describe('consumer schema modelines', () => {
  test(
    'canonicalizes an older schema modeline for a valid release',
    mint({
      setup: async ({ scope }) => ({
        ...(await boardFixture(
          scope,
          '# yaml-language-server: $schema=https://public-assets.zegreatrob.com/dashboard/0.9.0/board-config.schema.json\nboards: {demo: {panels: [{id: p, type: x}]}}\n',
        )),
        expectedSchemaUrl:
          'https://public-assets.zegreatrob.com/dashboard/1.2.3/board-config.schema.json',
      }),
      exercise: ({ boardPath, expectedSchemaUrl }) =>
        validateBoardConfig(boardPath, expectedSchemaUrl),
      verify: (result, { expectedSchemaUrl }) =>
        expect(result.yaml.split('\n')[0]).toBe(
          `# yaml-language-server: $schema=${expectedSchemaUrl}`,
        ),
    }),
  )

  test(
    'reports configuration and stale-schema errors together',
    mint({
      setup: async ({ scope }) => ({
        ...(await boardFixture(
          scope,
          '# yaml-language-server: $schema=https://public-assets.zegreatrob.com/dashboard/0.9.0/board-config.schema.json\nboards: {demo: {panels: []}}\n',
        )),
        expectedSchemaUrl:
          'https://public-assets.zegreatrob.com/dashboard/1.2.3/board-config.schema.json',
      }),
      exercise: rejects<{ boardPath: string; expectedSchemaUrl: string }>(
        ({ boardPath, expectedSchemaUrl }) => validateBoardConfig(boardPath, expectedSchemaUrl),
      ),
      verify: (error, { expectedSchemaUrl }) => {
        expect(error).toMatchObject({
          message: expect.stringMatching(
            /Invalid board configuration[\s\S]*panels[\s\S]*Stale schema modeline/,
          ),
        })
        expect(error).toMatchObject({ message: expect.stringContaining(expectedSchemaUrl) })
      },
    }),
  )

  test(
    'requires the schema modeline on the first line',
    mint({
      setup: async ({ scope }) => {
        const expectedSchemaUrl =
          'https://public-assets.zegreatrob.com/dashboard/1.2.3/board-config.schema.json'
        return {
          ...(await boardFixture(
            scope,
            `boards: {demo: {panels: [{id: p, type: x}]}}\n# yaml-language-server: $schema=${expectedSchemaUrl}\n`,
          )),
          expectedSchemaUrl,
        }
      },
      exercise: rejects<{ boardPath: string; expectedSchemaUrl: string }>(
        ({ boardPath, expectedSchemaUrl }) => validateBoardConfig(boardPath, expectedSchemaUrl),
      ),
      verify: (error, { expectedSchemaUrl }) =>
        expect(error).toMatchObject({
          message: expect.stringContaining(
            `Add this as the first line:\n# yaml-language-server: $schema=${expectedSchemaUrl}`,
          ),
        }),
    }),
  )

  test(
    'rejects a malformed schema modeline',
    mint({
      setup: ({ scope }) =>
        boardFixture(
          scope,
          '# yaml-language-server: $schema=not-a-url\nboards: {demo: {panels: [{id: p, type: x}]}}\n',
        ),
      exercise: rejects<{ boardPath: string }>(({ boardPath }) => validateBoardConfig(boardPath)),
      verify: (error) =>
        expect(error).toMatchObject({
          message: expect.stringMatching(/Malformed board schema modeline/),
        }),
    }),
  )
})

describe('consumer release artifacts', () => {
  test(
    'emits a stable asset URL for a consumer version',
    mint({
      setup: () => ({ version: '1.2.3', assetOrigin: 'https://public-assets.zegreatrob.com' }),
      exercise: ({ version }) => clientAssetUrl(version),
      verify: (url, { version, assetOrigin }) =>
        expect(url).toBe(`${assetOrigin}/dashboard/${version}`),
    }),
  )

  test(
    'assembles equivalent YAML deterministically without secrets',
    mint({
      setup: async ({ scope }) => {
        const config = {
          boards: {
            zeta: { panels: [{ id: 'build', type: 'pipeline-status' }] },
            alpha: { panels: [{ id: 'value', type: 'http-value' }] },
          },
          sources: {},
        }
        const world = await boardFixture(scope, `${modeline}\n${stringify(config)}`)
        const equivalentBoardPath = join(world.root, 'equivalent.yaml')
        const reordered = {
          sources: config.sources,
          boards: Object.fromEntries(Object.entries(config.boards).reverse()),
        }
        await writeFile(equivalentBoardPath, `${modeline}\n${stringify(reordered, { indent: 4 })}`)
        const version = '1.0.0'
        return {
          one: { boardConfigPath: world.boardPath, outputDir: join(world.root, 'one'), version },
          two: {
            boardConfigPath: equivalentBoardPath,
            outputDir: join(world.root, 'two'),
            version,
          },
        }
      },
      exercise: async ({ one, two }) => ({
        one: await assembleRelease(one),
        two: await assembleRelease(two),
      }),
      verify: async (releases, { one, two }) => {
        expect(releases.one.files).toEqual(releases.two.files)
        const boardOne = await readFile(join(one.outputDir, 'board.yaml'), 'utf8')
        const boardTwo = await readFile(join(two.outputDir, 'board.yaml'), 'utf8')
        expect(boardOne).toBe(boardTwo)
        expect(await readFile(join(one.outputDir, 'release.json'), 'utf8')).not.toMatch(
          /token|secret/i,
        )
      },
    }),
  )
})
