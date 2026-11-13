import { mint } from '@continuous-excellence/testmints-js/playwright'
import { expect, test } from '@playwright/test'

const origin = process.env.PW_TEST_HTTP_ORIGIN
const hosts = JSON.parse(process.env.PW_TEST_HOSTS ?? '{}') as Record<string, string>

for (const deployment of [
  { host: 'authenticated', board: 'authenticated', version: '1.0.0', hash: 'aaaa1111' },
  { host: 'warning', board: 'warning', version: '2.0.0', hash: 'bbbb2222' },
]) {
  test(`serves the immutable client for the ${deployment.host} hostname`, ({ request }) =>
    mint({
      setup: () => ({
        ...deployment,
        assetPath: `${process.env.PW_TEST_ASSET_ORIGIN}/client-${deployment.version}`,
        authority: `${hosts[deployment.host]?.toUpperCase()}:${new URL(origin ?? '').port}`,
      }),
      exercise: ({ authority }) =>
        request.get(`${origin}/`, {
          headers: { host: authority, 'x-forwarded-host': hosts.public ?? '' },
        }),
      verify: async (response, { assetPath, board, hash }) => {
        expect(response.status()).toBe(200)
        expect(response.headers()['cache-control']).toBe('no-store')
        const html = await response.text()
        expect(html).toMatch(/<head>\s*<script>window\.env/)
        expect(html).toContain(`"board":"${board}"`)
        expect(html).toContain(`src="${assetPath}/assets/index-${hash}.js"`)
        expect(html).toContain(`href="${assetPath}/assets/index-${hash}.css"`)
        expect(html).not.toContain('__ASSET_PATH__')
        if (board === 'warning') expect(html).toContain('"security":"warning"')
      },
    }))
}

for (const scenario of [
  { host: 'authenticated', path: '/api/boards/authenticated', status: 401 },
  {
    host: 'authenticated',
    path: '/api/boards/authenticated',
    bearer: 'invalid-token',
    status: 401,
  },
  { host: 'public', path: '/api/boards/public', status: 200 },
  { host: 'blocked', path: '/', status: 503 },
  { host: 'blocked', path: '/api/boards/blocked', status: 503 },
  { host: 'unknown', path: '/', status: 404 },
]) {
  test(`${scenario.host} ${scenario.path} returns ${scenario.status}${scenario.bearer ? ' for an invalid bearer' : ''}`, ({
    request,
  }) =>
    mint({
      setup: () => ({
        ...scenario,
        headers: {
          host: hosts[scenario.host] ?? 'unknown.dashboard.test',
          'x-forwarded-host': hosts.public ?? '',
          ...(scenario.bearer ? { authorization: `Bearer ${scenario.bearer}` } : {}),
        },
      }),
      exercise: ({ path, headers }) => request.get(`${origin}${path}`, { headers }),
      verify: (response, { status }) => expect(response.status()).toBe(status),
    }))
}

test('ignores the authenticated forwarded host even for a valid token', ({ request }) =>
  mint({
    setup: () => ({
      board: 'private-operations',
      headers: {
        host: hosts.public ?? '',
        'x-forwarded-host': hosts.authenticated ?? '',
        authorization: `Bearer ${process.env.PW_TEST_FIXTURE_BEARER}`,
      },
    }),
    exercise: ({ board, headers }) => request.get(`${origin}/api/boards/${board}`, { headers }),
    verify: (response) => expect(response.status()).toBe(404),
  }))

test('renders a configured board and its upstream release value', ({ page }) =>
  mint({
    setup: () => ({ board: 'release', version: '2026.11.13' }),
    exercise: ({ board }) => page.goto(`/boards/${board}`),
    verify: async (_, { board, version }) => {
      await expect(page.getByRole('heading', { name: board, exact: true })).toBeVisible()
      await expect(page.locator('[data-panel-id="version"]')).toContainText(version)
    },
  }))

for (const board of ['authenticated', 'private-operations']) {
  test(`admits the shared-policy token to ${board}`, ({ request }) =>
    mint({
      setup: () => ({
        board,
        headers: {
          host: hosts.authenticated ?? '',
          authorization: `Bearer ${process.env.PW_TEST_FIXTURE_BEARER}`,
        },
      }),
      exercise: ({ board, headers }) => request.get(`${origin}/api/boards/${board}`, { headers }),
      verify: async (response) => {
        expect(response.status()).toBe(200)
        expect(await response.json()).toMatchObject({ panels: [{ id: 'demo' }] })
      },
    }))
}
