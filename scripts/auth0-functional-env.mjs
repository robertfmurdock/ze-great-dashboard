import { execFile } from 'node:child_process'
import {
  auth0CredentialNames,
  auth0FunctionalInfrastructure,
  auth0ReaderRoleArn,
  functionalAuth0,
} from './auth0-functional-config.mjs'

export async function resolveAuth0FunctionalEnvironment({
  environment = process.env,
  execute = executeAws,
  strict = environment.AUTH0_FUNCTIONAL_STRICT === 'true',
} = {}) {
  let directFailure
  try {
    const value = await getParameter(execute, environment)
    return resolved(value, 'ssm')
  } catch (error) {
    if (error instanceof ParameterContentError) return unavailable(error, strict)
    directFailure = error
  }

  let assumed
  try {
    assumed = await assumeReaderRole(execute, environment)
  } catch (error) {
    return unavailable(
      discoveryError(directFailure, `reader role assumption ${failureSummary(error)}`),
      strict,
    )
  }

  try {
    const value = await getParameter(execute, { ...environment, ...assumed })
    return resolved(value, 'assumed-role')
  } catch (error) {
    if (error instanceof ParameterContentError) return unavailable(error, strict)
    return unavailable(
      discoveryError(directFailure, `assumed-role parameter read ${failureSummary(error)}`),
      strict,
    )
  }
}

function discoveryError(directFailure, fallbackFailure) {
  return new Error(
    `Auth0 functional credentials are unavailable: direct parameter read ${failureSummary(directFailure)}; ${fallbackFailure}.`,
  )
}

function failureSummary(error) {
  return error instanceof AwsCommandError ? error.category : 'failed'
}

function resolved(value, source) {
  const values = parseCredentialMap(value)
  return { available: true, source, credentials: capability(values) }
}

function unavailable(error, strict) {
  if (strict) throw error
  return { available: false, reason: error.message }
}

class ParameterContentError extends Error {}
class AwsCommandError extends Error {
  constructor(category) {
    super(category)
    this.category = category
  }
}

function parseCredentialMap(value) {
  let parsed
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new ParameterContentError('The Auth0 functional SSM parameter is not valid JSON.')
  }
  if (
    parsed === null ||
    typeof parsed !== 'object' ||
    !auth0CredentialNames.every((name) => typeof parsed[name] === 'string' && parsed[name].trim())
  ) {
    throw new ParameterContentError(
      `The Auth0 functional SSM parameter must contain: ${auth0CredentialNames.join(', ')}.`,
    )
  }
  return parsed
}

function capability(values) {
  return {
    testRunner: { clientSecret: values.AUTH0_FUNCTIONAL_TEST_RUNNER_CLIENT_SECRET },
    allowedUser: {
      login: functionalAuth0.allowedLogin,
      password: values.AUTH0_FUNCTIONAL_ALLOWED_PASSWORD,
    },
    unlistedUser: {
      login: functionalAuth0.unlistedLogin,
      password: values.AUTH0_FUNCTIONAL_UNLISTED_PASSWORD,
    },
    secretValues: auth0CredentialNames.map((name) => values[name]),
  }
}

async function getParameter(execute, environment) {
  return execute(
    'aws',
    [
      'ssm',
      'get-parameter',
      '--name',
      auth0FunctionalInfrastructure.parameterName,
      '--with-decryption',
      '--query',
      'Parameter.Value',
      '--output',
      'text',
      '--region',
      auth0FunctionalInfrastructure.region,
    ],
    environment,
  )
}

async function assumeReaderRole(execute, environment) {
  const output = await execute(
    'aws',
    [
      'sts',
      'assume-role',
      '--role-arn',
      auth0ReaderRoleArn,
      '--role-session-name',
      `dashboard-auth0-functional-${process.pid}`,
      '--query',
      'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]',
      '--output',
      'json',
      '--region',
      auth0FunctionalInfrastructure.region,
    ],
    environment,
  )
  let credentials
  try {
    credentials = JSON.parse(output)
  } catch {
    throw new Error('AWS returned malformed functional-test role credentials.')
  }
  if (!Array.isArray(credentials) || credentials.length !== 3 || credentials.some((item) => !item))
    throw new Error('AWS returned incomplete functional-test role credentials.')
  return {
    AWS_ACCESS_KEY_ID: credentials[0],
    AWS_SECRET_ACCESS_KEY: credentials[1],
    AWS_SESSION_TOKEN: credentials[2],
  }
}

function executeAws(file, args, environment) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: environment, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new AwsCommandError(classifyAwsFailure(error, stderr)))
        return
      }
      resolve(stdout.trim())
    })
  })
}

export function classifyAwsFailure(error, stderr) {
  const diagnostic = `${error?.code ?? ''} ${stderr ?? ''}`
  if (/AccessDenied/i.test(diagnostic)) return 'was denied'
  if (/ParameterNotFound/i.test(diagnostic)) return 'did not find the parameter'
  if (/ExpiredToken|InvalidClientTokenId|UnrecognizedClient/i.test(diagnostic))
    return 'has no valid AWS session'
  if (error?.code === 'ENOENT') return 'could not run the AWS CLI'
  return 'failed'
}
