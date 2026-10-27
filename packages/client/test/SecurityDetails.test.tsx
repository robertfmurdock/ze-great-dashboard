import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test, vi } from 'vitest'
import { SecurityDetails } from '../src/SecurityDetails.tsx'
import { clientTestFixture, env } from './client-test-fixture.tsx'

describe('SecurityDetails', () => {
  test(
    'requests and renders policy metadata only after Security is opened',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
          () =>
            Promise.resolve(
              Response.json({
                oidc: true,
                policy: { mode: 'claim', claim: 'groups', match: 'any' },
              }),
            ),
        )
        vi.stubGlobal('fetch', fetcher)
        render(
          <SecurityDetails
            env={env}
            auth={{ accessToken: 'access-token', onAuthenticationFailure: vi.fn() }}
          />,
        )
        return { fetcher, user: userEvent.setup() }
      },
      exercise: async ({ fetcher, user }) => {
        const callsBeforeClick = fetcher.mock.calls.length
        await user.click(screen.getByRole('button', { name: 'Security' }))
        return { callsBeforeClick }
      },
      verify: async ({ callsBeforeClick }, { fetcher }) => {
        await screen.findByText('groups')
        const dialog = screen.getByRole('dialog')
        expect(callsBeforeClick).toBe(0)
        expect(fetcher).toHaveBeenCalledOnce()
        expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
          'Bearer access-token',
        )
        expect(dialog.textContent).toContain('groups')
        expect(dialog.textContent).toContain('any')
        expect(dialog.textContent).not.toContain('access-token')
      },
    }),
  )

  test(
    'focuses the close control on open and returns focus after Escape',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
        render(<SecurityDetails env={env} auth={{ accessToken: 'access-token' }} />)
        return { user: userEvent.setup() }
      },
      exercise: async ({ user }) => {
        await user.click(screen.getByRole('button', { name: 'Security' }))
        const closeButton = await screen.findByRole('button', { name: 'Close' })
        const focusWasClose = document.activeElement === closeButton
        await user.keyboard('{Escape}')
        return {
          focusWasClose,
          focusWasSecurityAfterEscape:
            document.activeElement === screen.getByRole('button', { name: 'Security' }),
        }
      },
      verify: ({ focusWasClose, focusWasSecurityAfterEscape }) => {
        expect(focusWasClose).toBe(true)
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(focusWasSecurityAfterEscape).toBe(true)
      },
    }),
  )

  test(
    'renders an unavailable alert without policy metadata after a failed request',
    mint({
      setup: ({ scope }) => {
        clientTestFixture(scope)
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
      setup: ({ scope }) => {
        clientTestFixture(scope)
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
