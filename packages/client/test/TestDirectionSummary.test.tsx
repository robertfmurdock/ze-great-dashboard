import { mint } from '@continuous-excellence/testmints-js/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, test } from 'vitest'
import { TestDirectionSummary } from '../src/TestDirectionSummary.tsx'
import type { TestDirection } from '../src/test-direction.ts'

function summaryFixture() {
  const direction: TestDirection = {
    mode: 'jump',
    symbol: '↑',
    delta: 20,
    emphasized: true,
    totals: [100, 120],
    explanation: 'Large jump: 100 → 120 tests. Comparison: 2 runs observed by this browser.',
  }
  return { direction, summary: `${direction.totals.at(-1)} tests` }
}

/** Arrange a mounted control when an interaction, rather than rendering, is the subject. */
function interactiveFixture() {
  const input = summaryFixture()
  const outsideLabel = 'Outside'
  render(
    <>
      <TestDirectionSummary direction={input.direction}>{input.summary}</TestDirectionSummary>
      <button type="button">{outsideLabel}</button>
    </>,
  )
  return {
    ...input,
    user: userEvent.setup(),
    target: screen.getByRole('button', { name: input.summary }),
    outside: screen.getByRole('button', { name: outsideLabel }),
  }
}

describe('test direction presentation', () => {
  test(
    'renders one summary target with the supplied symbol and signed delta',
    mint({
      setup: summaryFixture,
      exercise: ({ summary, direction }) =>
        render(<TestDirectionSummary direction={direction}>{summary}</TestDirectionSummary>),
      verify: (_, { summary, direction }) => {
        const button = screen.getByRole('button', { name: summary })
        expect(button.textContent).toBe(`${summary}${direction.symbol} +${direction.delta}`)
        expect(screen.getAllByRole('button')).toHaveLength(1)
        expect(screen.queryByRole('tooltip')).toBeNull()
      },
    }),
  )
  test(
    'no reliable history preserves the plain summary without an interaction target',
    mint({
      setup: () => ({ summary: '37 tests' }),
      exercise: ({ summary }) => render(<TestDirectionSummary>{summary}</TestDirectionSummary>),
      verify: (_, { summary }) => {
        expect(screen.getByText(summary)).not.toBeNull()
        expect(screen.queryByRole('button')).toBeNull()
      },
    }),
  )
})

describe('test direction explanation interactions', () => {
  test(
    'hover reveals the supplied explanation through the accessible description',
    mint({
      setup: interactiveFixture,
      exercise: ({ user, target }) => user.hover(target),
      verify: (_, { direction, target }) => {
        const tooltip = screen.getByRole('tooltip')
        expect(tooltip.textContent).toBe(direction.explanation)
        expect(target.getAttribute('aria-describedby')).toBe(tooltip.id)
      },
    }),
  )
  test(
    'keyboard focus reveals the explanation',
    mint({
      setup: interactiveFixture,
      exercise: ({ user }) => user.tab(),
      verify: (_, { target, direction }) => {
        expect(document.activeElement).toBe(target)
        expect(screen.getByRole('tooltip').textContent).toBe(direction.explanation)
      },
    }),
  )
  test(
    'the clicked explanation remains pinned when the pointer leaves',
    mint({
      setup: async () => {
        const input = interactiveFixture()
        await input.user.click(input.target)
        return input
      },
      exercise: ({ user, target }) => user.unhover(target),
      verify: (_, { direction }) =>
        expect(screen.getByRole('tooltip').textContent).toBe(direction.explanation),
    }),
  )
  test(
    'Escape dismisses a focused explanation without moving focus',
    mint({
      setup: async () => {
        const input = interactiveFixture()
        await input.user.tab()
        return input
      },
      exercise: ({ user }) => user.keyboard('{Escape}'),
      verify: (_, { target }) => {
        expect(screen.queryByRole('tooltip')).toBeNull()
        expect(document.activeElement).toBe(target)
      },
    }),
  )
  test(
    'outside click dismisses a pinned explanation',
    mint({
      setup: async () => {
        const input = interactiveFixture()
        await input.user.click(input.target)
        return input
      },
      exercise: ({ user, outside }) => user.click(outside),
      verify: () => expect(screen.queryByRole('tooltip')).toBeNull(),
    }),
  )
  test(
    'a second click closes the pinned explanation',
    mint({
      setup: async () => {
        const input = interactiveFixture()
        await input.user.click(input.target)
        return input
      },
      exercise: ({ user, target }) => user.click(target),
      verify: () => expect(screen.queryByRole('tooltip')).toBeNull(),
    }),
  )
})
