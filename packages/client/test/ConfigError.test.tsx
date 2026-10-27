import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { ConfigError } from '../src/ConfigError.tsx'

describe('ConfigError', () => {
  test(
    'renders the configuration message in an accessible alert',
    mint({
      setup: () => ({ message: 'assetPath: required' }),
      exercise: ({ message }) => render(<ConfigError message={message} />),
      verify: async (_output, { message }) => {
        expect(
          await screen.findByRole('heading', { name: /dashboard misconfigured/i }),
        ).not.toBeNull()
        expect(screen.getByRole('alert').textContent).toContain(message)
      },
    }),
  )
})
