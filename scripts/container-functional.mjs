import { resolveAuth0FunctionalEnvironment } from './auth0-functional-env.mjs'
import { requestAuth0Tokens } from './auth0-functional-provider.mjs'
import { createFunctionalContainer } from './container-functional-docker.mjs'
import {
  exercisePackagedServer,
  startFunctionalFixtures,
} from './container-functional-fixtures.mjs'

const auth0 =
  process.env.AUTH0_FUNCTIONAL_SKIP === 'true'
    ? { available: false, reason: 'explicitly disabled for this untrusted CI ref' }
    : await resolveAuth0FunctionalEnvironment()
const sensitiveValues = auth0.available ? [...auth0.credentials.secretValues] : []
const tokens = auth0.available ? await requestAuth0Tokens(auth0.credentials) : undefined
if (tokens) sensitiveValues.push(tokens.allowedToken, tokens.unlistedToken)

const fixtures = await startFunctionalFixtures(tokens?.allowedToken)
const container = createFunctionalContainer({ assetOrigin: fixtures.assetOrigin, sensitiveValues })
try {
  const origin = await container.start()
  await exercisePackagedServer(origin, fixtures, tokens)
  console.log('Container functional checks passed.')
  if (tokens) console.log(`Auth0 functional checks passed using credentials from ${auth0.source}.`)
  else console.log(`SKIP Auth0 functional checks: ${auth0.reason}`)
} finally {
  await container.cleanup()
  await fixtures.close()
}
