import { Component, createRef, type ReactNode, type RefObject } from 'react'

const reducedMotionQuery = '(prefers-reduced-motion: reduce)'

type Props = {
  layoutKey?: string
  children: (root: RefObject<HTMLElement | null>) => ReactNode
}

type Position = {
  element: HTMLElement
  x: number
  y: number
}

export class PanelLayoutMotion extends Component<Props> {
  private root = createRef<HTMLElement>()
  private animations = new Set<Animation>()
  private preference?: MediaQueryList

  override componentDidMount() {
    this.preference = window.matchMedia?.(reducedMotionQuery)
    this.preference?.addEventListener('change', this.onPreferenceChange)
  }

  override getSnapshotBeforeUpdate(previous: Props) {
    if (previous.layoutKey === undefined || previous.layoutKey === this.props.layoutKey) {
      return null
    }
    return this.props.layoutKey !== undefined && !this.preference?.matches
      ? this.positions()
      : new Map<string, Position>()
  }

  override componentDidUpdate(
    _previous: Props,
    _state: unknown,
    before: Map<string, Position> | null,
  ) {
    if (!before) return
    this.cancelAnimations()
    if (!before.size || this.preference?.matches) return

    for (const [id, after] of this.positions()) {
      const start = before.get(id)
      if (start?.element !== after.element) continue
      const x = start.x - after.x
      const y = start.y - after.y
      if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue

      const animation = after.element.animate?.(
        [{ translate: `${x}px ${y}px` }, { translate: '0px 0px' }],
        { duration: 200, easing: 'ease-out' },
      )
      if (!animation) continue
      this.animations.add(animation)
      animation.onfinish = () => this.animations.delete(animation)
    }
  }

  override componentWillUnmount() {
    this.preference?.removeEventListener('change', this.onPreferenceChange)
    this.cancelAnimations()
  }

  private positions() {
    const positions = new Map<string, Position>()
    const elements = this.root.current?.querySelectorAll<HTMLElement>('[data-panel-motion]')
    for (const element of elements ?? []) {
      const id = element.dataset.panelMotion
      if (!id || element.closest('[data-panel]') !== this.root.current) continue
      const { x, y, width, height } = element.getBoundingClientRect()
      if (width && height && getComputedStyle(element).visibility === 'visible') {
        positions.set(id, { element, x, y })
      }
    }
    return positions
  }

  private onPreferenceChange = (event: MediaQueryListEvent) => {
    if (event.matches) this.cancelAnimations()
  }

  private cancelAnimations() {
    for (const animation of this.animations) animation.cancel()
    this.animations.clear()
  }

  override render() {
    return this.props.children(this.root)
  }
}
