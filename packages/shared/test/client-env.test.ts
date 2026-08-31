import { describe, expect, it } from 'vitest'
import { readClientEnv } from '../src/client-env.ts'

describe('reading window.env', () => {
  const valid = {
    assetPath: 'https://assets.example.com/dashboard/1.0.7',
    proxyPath: '/api',
    board: 'ze-great-team',
  }

  it('accepts the block the server injects', () => {
    expect(readClientEnv(valid)).toEqual(valid)
  })

  it('accepts an auth block when present, and its absence when not', () => {
    expect(
      readClientEnv({ ...valid, auth: { issuer: 'https://login.example.com' } }),
    ).toMatchObject({ auth: { issuer: 'https://login.example.com' } })
    expect(readClientEnv(valid).auth).toBeUndefined()
  })

  it('explains itself when configuration never arrived', () => {
    // The alternative is a blank board, which for a trust radiator is the worst outcome.
    expect(() => readClientEnv(undefined)).toThrow(/window\.env is missing or invalid/)
    expect(() => readClientEnv({ proxyPath: '/api' })).toThrow(/assetPath/)
  })
})
