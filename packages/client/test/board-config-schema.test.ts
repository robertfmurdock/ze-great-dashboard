import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serializeBoardConfigJsonSchema } from '../../shared/src/board-config.ts'

describe('the published board configuration schema', () => {
  it('is the deterministic schema generated during the normal Vite build', async () => {
    const schemaPath = resolve(process.cwd(), 'packages/client/dist/board-config.schema.json')
    const published = await readFile(schemaPath, 'utf8')
    const schema = JSON.parse(published) as Record<string, unknown>

    expect(published).toBe(serializeBoardConfigJsonSchema())
    expect(schema).toMatchObject({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'board-config.schema.json',
      title: 'Ze Great Dashboard board configuration',
      'x-dashboard-runtime-rules': expect.arrayContaining([
        expect.objectContaining({ category: 'unique-panel-and-fact-ids' }),
        expect.objectContaining({ category: 'panel-source-relationships' }),
      ]),
    })
    expect(published).toMatch(
      /"facts":\s*\{[\s\S]*?"items":\s*\{[\s\S]*?"link":\s*\{\s*"type":\s*"string",\s*"format":\s*"uri"/,
    )
  })
})
