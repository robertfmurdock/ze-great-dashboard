import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import styles from './TestDirectionSummary.module.css'
import type { TestDirection } from './test-direction.ts'

export function TestDirectionSummary({
  direction,
  children,
}: {
  direction?: TestDirection
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const target = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLSpanElement>(null)
  const id = useId()
  const show = () => {
    const rect = target.current?.getBoundingClientRect()
    if (rect)
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
        top: Math.max(8, Math.min(rect.bottom, window.innerHeight - 180)),
      })
    setOpen(true)
  }
  useEffect(() => {
    if (!direction) {
      setOpen(false)
      setPinned(false)
    }
  }, [direction])
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !target.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      ) {
        setOpen(false)
        setPinned(false)
      }
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        setPinned(false)
      }
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])
  if (!direction) return <>{children}</>
  const points = direction.totals
    .map(
      (total, index, totals) =>
        `${totals.length === 1 ? 48 : (index * 48) / (totals.length - 1)},${16 - (total / Math.max(1, ...totals)) * 14}`,
    )
    .join(' ')
  return (
    <>
      <button
        ref={target}
        type="button"
        className={styles.summary}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onMouseEnter={show}
        onMouseLeave={(event) => {
          if (
            !pinned &&
            !(event.relatedTarget instanceof Node && popup.current?.contains(event.relatedTarget))
          )
            setOpen(false)
        }}
        onFocus={show}
        onBlur={() => {
          setOpen(false)
          setPinned(false)
        }}
        onClick={() => {
          if (pinned) {
            setPinned(false)
            setOpen(false)
          } else {
            setPinned(true)
            show()
          }
        }}
      >
        {children}
        {direction.mode !== 'quiet' && (
          <span
            className={`${styles.delta} ${direction.emphasized ? styles.emphasized : ''}`}
            aria-hidden="true"
          >
            {direction.symbol} {direction.delta > 0 ? '+' : direction.delta < 0 ? '−' : ''}
            {Math.abs(direction.delta).toLocaleString()}
          </span>
        )}
        {direction.totals.length > 1 && (
          <svg className={styles.sparkline} viewBox="0 0 48 18" aria-hidden="true">
            <polyline points={points} />
          </svg>
        )}
      </button>
      {open &&
        createPortal(
          <span
            ref={popup}
            id={id}
            role="tooltip"
            className={styles.explanation}
            style={{ ...position, maxHeight: Math.max(40, window.innerHeight - position.top - 8) }}
            onMouseLeave={(event) => {
              if (
                !pinned &&
                !(
                  event.relatedTarget instanceof Node &&
                  target.current?.contains(event.relatedTarget)
                )
              )
                setOpen(false)
            }}
          >
            {direction.explanation}
          </span>,
          document.body,
        )}
    </>
  )
}
