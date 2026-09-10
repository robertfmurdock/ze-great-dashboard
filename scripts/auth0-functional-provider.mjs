import { auth0Endpoint } from './auth0-functional-config.mjs'

export async function requestAuth0Tokens(credentials) {
  return {
    allowedToken: await passwordToken('allowed user', credentials.allowedUser, credentials),
    unlistedToken: await passwordToken('unlisted user', credentials.unlistedUser, credentials),
  }
}

async function passwordToken(label, user, credentials) {
  const response = await fetch(`https://${auth0Endpoint.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'http://auth0.com/oauth/grant-type/password-realm',
      realm: auth0Endpoint.connection,
      username: user.login,
      password: user.password,
      audience: auth0Endpoint.audience,
      scope: 'openid profile read:dashboard',
      client_id: auth0Endpoint.testRunnerClientId,
      client_secret: credentials.testRunner.clientSecret,
    }),
  })
  if (!response.ok)
    throw new Error(`Auth0 ${label} token request failed with status ${response.status}.`)
  const json = await response.json()
  if (typeof json.access_token !== 'string')
    throw new Error('Auth0 did not return a user access token.')
  return json.access_token
}
