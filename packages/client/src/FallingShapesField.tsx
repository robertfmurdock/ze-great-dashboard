import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import styles from './FallingShapesField.module.css'
import {
  buildStaticField,
  type FallingDirection,
  fallingDirection,
  fallingGrid,
} from './falling-shapes.ts'
import {
  advanceFallingSimulation,
  createFallingSimulation,
  visibleFallingShapes,
} from './falling-simulation.ts'

const TICK_MS = 50
type Geometry = { columns: number; rows: number; direction: FallingDirection }

export function FallingShapesField({
  progress,
  estimatedDurationMs,
  overdue,
  seed = 0,
}: {
  progress: number
  estimatedDurationMs?: number
  overdue: boolean
  seed?: number
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [geometry, setGeometry] = useState<Geometry>({
    ...fallingGrid('vertical'),
    direction: 'vertical',
  })
  const [reducedMotion, setReducedMotion] = useState(false)
  const [view, setView] = useState(createFallingSimulation)
  const geometryRef = useRef(geometry)
  const directionRef = useRef<FallingDirection | undefined>(undefined)
  const progressRef = useRef(progress)
  const seedRef = useRef(seed)
  const simulationRef = useRef(createFallingSimulation())
  const startedAtRef = useRef(Date.now())

  useEffect(() => {
    progressRef.current = progress
    seedRef.current = seed
  }, [progress, seed])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const rect = root.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      const direction = directionRef.current ?? fallingDirection(rect.width, rect.height)
      directionRef.current = direction
      const next = { ...fallingGrid(direction, rect.width, rect.height), direction }
      geometryRef.current = next
      setGeometry(next)
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  useEffect(() => {
    simulationRef.current = createFallingSimulation()
    startedAtRef.current = Date.now()
    if (reducedMotion) {
      const settled = buildStaticField(
        geometry.direction,
        geometry.columns,
        geometry.rows,
        seedRef.current,
        Math.max(1, Math.floor(progressRef.current * 6)),
      )
      setView({ ...createFallingSimulation(), settled })
      return
    }
    setView(simulationRef.current)
  }, [geometry, reducedMotion])
  useEffect(() => {
    if (reducedMotion) return
    const timer = window.setInterval(() => {
      const next = advanceFallingSimulation(simulationRef.current, {
        elapsed: Date.now() - startedAtRef.current,
        ...geometryRef.current,
        progress: progressRef.current,
        estimatedDurationMs,
        overdue,
        seed: seedRef.current,
      })
      simulationRef.current = next
      setView(next)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [estimatedDurationMs, overdue, reducedMotion])
  const pieces = visibleFallingShapes(view)
  return (
    <div
      ref={rootRef}
      className={styles.field}
      data-running-part="falling-shapes-field"
      data-overdue={overdue || undefined}
      data-direction={geometry.direction}
      data-recycling={view.recycling || undefined}
      style={
        { '--shape-columns': geometry.columns, '--shape-rows': geometry.rows } as CSSProperties
      }
    >
      <div className={styles.grid}>
        {view.clearingCells.map((cell) => (
          <span
            key={`${cell.x}-${cell.y}`}
            className={styles.clearingCell}
            style={{ '--clear-x': cell.x, '--clear-y': cell.y } as CSSProperties}
          />
        ))}
        {pieces.map((piece) => (
          <div
            key={piece.id}
            className={styles.piece}
            data-piece={piece.id}
            data-piece-phase={piece.phase}
            style={
              {
                '--piece-x': piece.x,
                '--piece-y': piece.y,
                '--piece-width': Math.max(...piece.cells.map((cell) => cell.x)) + 1,
                '--piece-height': Math.max(...piece.cells.map((cell) => cell.y)) + 1,
              } as CSSProperties
            }
          >
            {piece.cells.map((cell) => (
              <span
                key={`${cell.x}-${cell.y}`}
                className={styles.cell}
                style={{ '--cell-x': cell.x, '--cell-y': cell.y } as CSSProperties}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
