import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager'

/** Server-only lookup for credentials named by a board source's `token_env`. */
export type CredentialResolver = {
  get(name: string): string | undefined
}

type SecretsManager = {
  send(command: GetSecretValueCommand): Promise<{ SecretString?: string }>
}

/**
 * Uses a single JSON Secrets Manager value as a credential map when configured. The map is read
 * during boot and retained only in this execution environment; a Lambda cold start picks up a
 * rotated value. Local and Docker starts deliberately retain ordinary environment lookups.
 */
export async function createCredentialResolver(options: {
  secretReference?: string
  credentialNames: Iterable<string>
  env?: Record<string, string | undefined>
  secretsManager?: SecretsManager
}): Promise<CredentialResolver> {
  const names = [...new Set(options.credentialNames)]
  if (!options.secretReference) return environmentCredentials(options.env)

  let secret: { SecretString?: string }
  try {
    const secretsManager = options.secretsManager ?? new SecretsManagerClient({})
    secret = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: options.secretReference }),
    )
  } catch {
    throw new Error(`Unable to read credential secret for configured keys: ${formatNames(names)}`)
  }

  const values = parseCredentialMap(secret.SecretString)
  const missing = names.filter((name) => !Object.hasOwn(values, name))
  if (missing.length)
    throw new Error(`Credential secret is missing configured keys: ${formatNames(missing)}`)
  const requestedValues = Object.fromEntries(names.map((name) => [name, values[name]])) as Record<
    string,
    string
  >
  return { get: (name) => requestedValues[name] }
}

export function environmentCredentials(
  env: Record<string, string | undefined> = process.env,
): CredentialResolver {
  return { get: (name) => env[name] }
}

/** Secret values must be a simple string map; credentials never enter logs or client responses. */
export function parseCredentialMap(secretString: string | undefined): Record<string, string> {
  let parsed: unknown
  try {
    parsed = secretString === undefined ? undefined : JSON.parse(secretString)
  } catch {
    throw new Error('Credential secret must be a JSON object of non-empty string values')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Credential secret must be a JSON object of non-empty string values')
  const entries = Object.entries(parsed)
  if (entries.some(([, value]) => typeof value !== 'string' || value.length === 0))
    throw new Error('Credential secret must be a JSON object of non-empty string values')
  return Object.fromEntries(entries) as Record<string, string>
}

function formatNames(names: string[]): string {
  return names.length ? names.join(', ') : '(none)'
}
