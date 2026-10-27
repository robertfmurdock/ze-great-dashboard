import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { analyzeBoardLayout, type Board } from '@ze-great-dashboard/shared/browser'
import { afterEach, describe, expect, it } from 'vitest'
import { LayoutWarning } from '../src/LayoutWarning.tsx'
import { env } from './client-test-fixture.tsx'

afterEach(cleanup)

describe('LayoutWarning', () => {
  it('opens a dialog with issue details and both layout downloads', async () => {
    const board: Board = {
      panels: [
        { id: 'first', type: 'pipeline-status', position: { x: 0, y: 0, w: 8, h: 3 } },
        { id: 'second', type: 'pipeline-status', position: { x: 4, y: 12, w: 8, h: 2 } },
      ],
    }
    const layout = analyzeBoardLayout(board.panels)
    const user = userEvent.setup()
    render(<LayoutWarning board={env.board} layout={layout} env={env} />)

    await user.click(screen.getByRole('button', { name: 'Layout warnings (1)' }))

    const dialog = screen.getByRole('dialog', { name: 'Layout warnings' })
    expect(dialog.textContent).toContain('1 layout issue detected against the intended 12×12 space')
    expect(dialog.textContent).toContain('second: out-of-bounds at (4, 12), 8×2')
    expect(screen.getAllByRole('button', { name: /Download .* layout/ })).toHaveLength(2)
  })

  it('closes its open dialog with Escape', async () => {
    const layout = analyzeBoardLayout([
      { id: 'overflow', type: 'pipeline-status', position: { x: 12, y: 0, w: 1, h: 1 } },
    ])
    const user = userEvent.setup()
    render(<LayoutWarning board={env.board} layout={layout} env={env} />)

    await user.click(screen.getByRole('button', { name: 'Layout warnings (1)' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
