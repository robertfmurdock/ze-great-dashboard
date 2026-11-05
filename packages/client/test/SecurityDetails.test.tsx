import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { SecurityDetails } from '../src/SecurityDetails.tsx'
import { clientTestFixture, env } from './client-test-fixture.tsx'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('SecurityDetails', () => {
  test(
    'requests and renders policy metadata only after Security is opened',
    mint({
      setup: () => {
        clientTestFixture()
        const metadata = { oidc: true, policy: { mode: 'claim', claim: 'groups', match: 'any' } }
        const auth = { accessToken: 'access-token', onAuthenticationFailure: vi.fn() }
        const fetcher = vi.fn(async () => Response.json(metadata))
        vi.stubGlobal('fetch', fetcher)
        render(<SecurityDetails env={env} auth={auth} />)
        return {
          fetcher,
          auth,
          metadata,
          user: userEvent.setup(),
          callsBeforeClick: fetcher.mock.calls.length,
        }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: 'Security' })),
      verify: async (_, { callsBeforeClick, fetcher, auth, metadata }) => {
        await screen.findByText(metadata.policy.claim)
        const dialog = screen.getByRole('dialog')
        expect(callsBeforeClick).toBe(0)
        expect(fetcher).toHaveBeenCalledOnce()
        const init = vi.mocked(fetch).mock.calls[0]?.[1]
        expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${auth.accessToken}`)
        expect(dialog.textContent).toContain(metadata.policy.claim)
        expect(dialog.textContent).toContain(metadata.policy.match)
        expect(dialog.textContent).not.toContain(auth.accessToken)
      },
    }),
  )

  test(
    'focuses the close control when opened',
    mint({
      setup: () => {
        clientTestFixture()
        render(<SecurityDetails env={env} auth={{ accessToken: 'access-token' }} />)
        return { user: userEvent.setup() }
      },
      exercise: ({ user }) => user.click(screen.getByRole('button', { name: 'Security' })),
      verify: async () => {
        const close = await screen.findByRole('button', { name: 'Close' })
        expect(document.activeElement).toBe(close)
      },
    }),
  )

  test(
    'closes on Escape and returns focus to Security',
    mint({
      setup: async () => {
        clientTestFixture()
        render(<SecurityDetails env={env} auth={{ accessToken: 'access-token' }} />)
        const user = userEvent.setup()
        await user.click(screen.getByRole('button', { name: 'Security' }))
        await screen.findByRole('dialog')
        return { user }
      },
      exercise: ({ user }) => user.keyboard('{Escape}'),
      verify: () => {
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Security' }))
      },
    }),
  )

  test(
    'renders an unavailable alert without policy metadata after a failed request',
    mint({
      setup: () => {
        clientTestFixture()
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
        )
        render(<SecurityDetails env={env} auth={{ accessToken: 'access-token' }} />)
        return { user: userEvent.setup() }
      },
      exercise: async ({ user }) => user.click(screen.getByRole('button', { name: 'Security' })),
      verify: async () => {
        const alert = await screen.findByRole('alert')
        const dialog = screen.getByRole('dialog')
        expect(alert.textContent).toContain('Security details are unavailable.')
        expect(dialog.textContent).not.toContain('groups')
      },
    }),
  )

  test(
    'forwards a denied security response to the authentication handler',
    mint({
      setup: () => {
        clientTestFixture()
        const denied = vi.fn()
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.resolve(new Response(null, { status: 403 }))),
        )
        render(
          <SecurityDetails
            env={env}
            auth={{ accessToken: 'access-token', onAuthenticationFailure: denied }}
          />,
        )
        return { denied, user: userEvent.setup() }
      },
      exercise: async ({ user }) => user.click(screen.getByRole('button', { name: 'Security' })),
      verify: async (_output, { denied }) => {
        await waitFor(() => expect(denied).toHaveBeenCalledWith(403))
        expect(screen.getByRole('dialog').textContent).not.toContain('groups')
      },
    }),
  )
})
