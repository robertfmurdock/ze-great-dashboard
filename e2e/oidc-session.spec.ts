import { text } from 'node:stream/consumers'
import { expect, type Page, type Route, test } from '@playwright/test'

const preview = process.env.PW_TEST_ORIGIN ?? 'http://127.0.0.1:4173'
// OIDC PKCE needs Web Crypto. The Docker browser reaches Vite over plain HTTP on a non-loopback host.
const dashboard = 'https://dashboard.fixture.test'
const assetPath = `${dashboard}/__ASSET_PATH__`
const issuer = 'https://oidc.example.test'
const clientId = 'dashboard'
const board = 'operations'
const boardUrl = `${dashboard}/boards/${board}`
const bearers = ['fixture-access-token', 'fixture-replacement-token'] as const
const refreshToken = 'fixture-refresh-token'
const providerSession = {
  name: 'provider_session',
  value: 'active',
  url: issuer,
  sameSite: 'Lax',
  secure: true,
} as const

async function serveDashboard(page: Page) {
  await page.addInitScript(
    (env) => {
      window.env = {
        ...env,
        // The root callback serves the default board, as in a multi-board deployment.
        board: location.pathname.startsWith('/boards/') ? env.board : 'default',
      }
    },
    {
      assetPath,
      assetPathId: 'sha256:644e4b913dada33b64ab521018c8541df48c4b93e2b0c14de80112c4e58a9f21',
      proxyPath: '/api',
      board,
      auth: { issuer, clientId, audience: 'dashboard-api' },
    },
  )
  await page.route(`${dashboard}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    const previewPath = pathname.startsWith('/__ASSET_PATH__/') ? pathname : '/__ASSET_PATH__/'
    await route.fulfill({ response: await route.fetch({ url: `${preview}${previewPath}` }) })
  })
  await page.route('**/api/**', async (route) => {
    const authorization = await route.request().headerValue('authorization')
    const authorized = bearers.some((bearer) => authorization === `Bearer ${bearer}`)
    await route.fulfill({ status: authorized ? 200 : 401, json: { panels: [] } })
  })
}

async function serveProvider(page: Page, firstTokenExpiresIn = 3600) {
  let issuedTokens = 0
  const rejectedRefreshes: string[] = []
  const authorizationRequests: { topLevel: boolean; prompt: string | null }[] = []
  await page.route(`${issuer}/.well-known/openid-configuration`, (route) =>
    route.fulfill({
      json: {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        end_session_endpoint: `${issuer}/logout`,
      },
    }),
  )
  await page.route(`${issuer}/authorize?**`, async (route) => {
    const request = route.request()
    const params = new URL(request.url()).searchParams
    authorizationRequests.push({
      topLevel: request.frame() === page.mainFrame(),
      prompt: params.get('prompt'),
    })
    const callback = new URL(params.get('redirect_uri') ?? '')
    callback.searchParams.set('state', params.get('state') ?? '')
    if ((await request.headerValue('cookie'))?.includes('provider_session=active'))
      callback.searchParams.set('code', 'fixture-code')
    else {
      callback.searchParams.set('error', 'login_required')
      callback.searchParams.set('error_description', 'fixture-private-provider-detail')
    }
    await navigate(route, callback.href)
  })
  await page.route(`${issuer}/token`, (route) => {
    const grant = new URLSearchParams(route.request().postData() ?? '')
    if (grant.get('grant_type') === 'refresh_token') {
      rejectedRefreshes.push(grant.get('refresh_token') ?? '')
      return route.fulfill({ status: 400, json: { error: 'invalid_grant' } })
    }
    const first = issuedTokens++ === 0
    return route.fulfill({
      json: {
        access_token: first ? bearers[0] : bearers[1],
        token_type: 'Bearer',
        expires_in: first ? firstTokenExpiresIn : 3600,
        refresh_token: refreshToken,
        id_token: `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(
          JSON.stringify({ sub: 'fixture-subject', iss: issuer, aud: clientId }),
        ).toString('base64url')}.fixture-signature`,
      },
    })
  })
  await page.route(`${issuer}/logout?**`, (route) => navigate(route, `${dashboard}/`))
  return { authorizationRequests, rejectedRefreshes }
}

// A new document navigation lets Playwright route the callback to the HTTPS dashboard fixture.
function navigate(route: Route, target: string) {
  return route.fulfill({
    contentType: 'text/html',
    body: `<script>location.replace(${JSON.stringify(target)})</script>`,
  })
}

async function admittedBoard(page: Page, accessToken: string) {
  const request = await page.waitForRequest(
    (request) =>
      new URL(request.url()).pathname === `/api/boards/${board}` &&
      request.headers().authorization === `Bearer ${accessToken}`,
    { timeout: 5_000 },
  )
  const response = await request.response()
  expect(response?.ok()).toBe(true)
}

test('restores the requested board on reload using a first-party provider session', async ({
  page,
  context,
}) => {
  await serveDashboard(page)
  const { authorizationRequests } = await serveProvider(page)
  await context.addCookies([providerSession])

  await Promise.all([admittedBoard(page, bearers[0]), page.goto(boardUrl)])
  await Promise.all([admittedBoard(page, bearers[1]), page.reload()])

  await expect(page).toHaveURL(boardUrl)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(authorizationRequests).toEqual([
    { topLevel: true, prompt: 'none' },
    { topLevel: true, prompt: 'none' },
  ])
})

test('offers sign-in and a sanitized diagnostic when the provider requires interaction', async ({
  page,
}) => {
  await serveDashboard(page)
  const { authorizationRequests } = await serveProvider(page)
  await page.goto(boardUrl)

  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page).toHaveURL(boardUrl)
  await page.getByRole('button', { name: /Diagnostics/ }).click()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download', exact: true }).click(),
  ])
  const diagnostic = await text(await download.createReadStream())
  expect(
    JSON.parse(diagnostic).events.filter(({ kind }: { kind: string }) => kind === 'auth-session'),
  ).toEqual([
    expect.objectContaining({ outcome: 'restoring', trigger: 'startup' }),
    expect.objectContaining({ outcome: 'failed', phase: 'callback', reason: 'login_required' }),
  ])
  expect(diagnostic).not.toContain('fixture-private-provider-detail')
  expect(authorizationRequests).toEqual([{ topLevel: true, prompt: 'none' }])
})

test('recovers an open board after its access token expires and refresh fails', async ({
  page,
  context,
}) => {
  await serveDashboard(page)
  const { authorizationRequests, rejectedRefreshes } = await serveProvider(page, 120)
  await context.addCookies([providerSession])
  await page.clock.install()
  await Promise.all([admittedBoard(page, bearers[0]), page.goto(boardUrl)])

  await Promise.all([admittedBoard(page, bearers[1]), page.clock.fastForward(122_000)])
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  expect(rejectedRefreshes).toEqual([refreshToken])
  expect(authorizationRequests).toEqual([
    { topLevel: true, prompt: 'none' },
    { topLevel: true, prompt: 'none' },
  ])
})

test('respects explicit sign-out even when the provider session survives', async ({
  page,
  context,
}) => {
  await serveDashboard(page)
  const { authorizationRequests } = await serveProvider(page)
  await context.addCookies([providerSession])
  await page.goto(boardUrl)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(`${dashboard}/`)
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  expect(authorizationRequests).toEqual([{ topLevel: true, prompt: 'none' }])
})
