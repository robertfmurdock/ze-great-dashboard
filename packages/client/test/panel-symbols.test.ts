import { describe, expect, it } from 'vitest'
import { panelTypeSymbols, primarySymbolMeanings, statusSymbols } from '../src/panel-symbols.ts'

describe('primary compact symbols', () => {
  it('assigns one unique meaning to every primary glyph', () => {
    expect(new Set(primarySymbolMeanings.map(({ glyph }) => glyph)).size).toBe(
      primarySymbolMeanings.length,
    )
  })

  it('covers every renderable panel type and every pipeline status', () => {
    expect(Object.keys(panelTypeSymbols).sort()).toEqual([
      'http-value',
      'pipeline-animation-demo',
      'pipeline-status',
      'pull-request-health',
    ])
    expect(Object.keys(statusSymbols).sort()).toEqual([
      'cancelled',
      'failed',
      'passed',
      'running',
      'unknown',
      'warning',
    ])
  })
})
