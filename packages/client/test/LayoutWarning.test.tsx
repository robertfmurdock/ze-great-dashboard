import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { analyzeBoardLayout, type Board } from '@ze-great-dashboard/shared/browser'
import { describe, expect, test } from 'vitest'
import { LayoutWarning } from '../src/LayoutWarning.tsx'
import { env } from './client-test-fixture.tsx'

describe('LayoutWarning', () => {
  test(
    'opens a dialog with issue details and both layout downloads',
    mint({
      setup: () => {
        const board: Board = {
          panels: [
            { id: 'first', type: 'pipeline-status', position: { x: 0, y: 0, w: 8, h: 3 } },
            { id: 'second', type: 'pipeline-status', position: { x: 4, y: 12, w: 8, h: 2 } },
          ],
        }
        const layout = analyzeBoardLayout(board.panels)
        const user = userEvent.setup()
        render(<LayoutWarning board={env.board} layout={layout} env={env} />)
        return { user, issue: board.panels[1] }
      },
      exercise: ({ user }) =>
        user.click(screen.getByRole('button', { name: 'Layout warnings (1)' })),
      verify: (_output, { issue }) => {
        const dialog = screen.getByRole('dialog', { name: 'Layout warnings' })
        expect(dialog.textContent).toContain(
          '1 layout issue detected against the intended 12×12 space',
        )
        expect(dialog.textContent).toContain(
          `${issue?.id}: out-of-bounds at (${issue?.position?.x}, ${issue?.position?.y}), ${issue?.position?.w}×${issue?.position?.h}`,
        )
        expect(screen.getAllByRole('button', { name: /Download .* layout/ })).toHaveLength(2)
      },
    }),
  )

  test(
    'closes its open dialog with Escape',
    mint({
      setup: async () => {
        const layout = analyzeBoardLayout([
          { id: 'overflow', type: 'pipeline-status', position: { x: 12, y: 0, w: 1, h: 1 } },
        ])
        const user = userEvent.setup()
        render(<LayoutWarning board={env.board} layout={layout} env={env} />)
        await user.click(screen.getByRole('button', { name: 'Layout warnings (1)' }))
        return { user }
      },
      exercise: ({ user }) => user.keyboard('{Escape}'),
      verify: () => expect(screen.queryByRole('dialog')).toBeNull(),
    }),
  )
})
