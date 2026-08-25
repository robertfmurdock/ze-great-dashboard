import { describe, expect, it, vi } from 'vitest'
import { createCredentialResolver, parseCredentialMap } from '../src/credentials.ts'

describe('credential maps', () => {
  it('accepts only JSON objects with non-empty string values', () => {
    expect(parseCredentialMap('{"GITHUB_TOKEN":"token"}')).toEqual({ GITHUB_TOKEN: 'token' })
    for (const value of [undefined, 'not json', '[]', '{"GITHUB_TOKEN":""}', '{"GITHUB_TOKEN":1}'])
      expect(() => parseCredentialMap(value)).toThrow(
        'Credential secret must be a JSON object of non-empty string values',
      )
  })

  it('loads only the configured names from one secret map', async () => {
    const send = vi.fn(async () => ({ SecretString: '{"GITHUB_TOKEN":"private","UNUSED":"x"}' }))
    const credentials = await createCredentialResolver({
      secretReference: 'arn:aws:secretsmanager:region:account:secret:credentials',
      credentialNames: ['GITHUB_TOKEN'],
      secretsManager: { send },
    })

    expect(credentials.get('GITHUB_TOKEN')).toBe('private')
    expect(credentials.get('UNUSED')).toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('fails closed without exposing secret content', async () => {
    await expect(
      createCredentialResolver({
        secretReference: 'arn:example',
        credentialNames: ['GITHUB_TOKEN'],
        secretsManager: { send: async () => ({ SecretString: '{"OTHER":"private-value"}' }) },
      }),
    ).rejects.toThrow('Credential secret is missing configured keys: GITHUB_TOKEN')
    await expect(
      createCredentialResolver({
        secretReference: 'arn:example',
        credentialNames: ['GITHUB_TOKEN'],
        secretsManager: {
          send: async () => Promise.reject(new Error('access denied: private-value')),
        },
      }),
    ).rejects.toThrow('Unable to read credential secret for configured keys: GITHUB_TOKEN')
  })

  it('preserves environment credentials when no secret ARN is configured', async () => {
    const credentials = await createCredentialResolver({
      credentialNames: ['GITHUB_TOKEN'],
      env: { GITHUB_TOKEN: 'local-token' },
    })
    expect(credentials.get('GITHUB_TOKEN')).toBe('local-token')
  })
})
