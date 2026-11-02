import { mint } from '@continuous-excellence/testmints-js/vitest'
import { describe, expect, it } from 'vitest'
import { primarySymbolMeanings } from '../src/panel-symbols.ts'

describe('primary compact symbols', () => {
  it(
    'assigns one unique meaning to every primary glyph',
    mint({
      setup: () => undefined,
      exercise: () => primarySymbolMeanings(),
      verify: (meanings) =>
        expect(new Set(meanings.map(({ glyph }) => glyph)).size).toBe(meanings.length),
    }),
  )
})
