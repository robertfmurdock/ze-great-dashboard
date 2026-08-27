import type { CSSProperties } from 'react'
import { useEffect, useRef, useState } from 'react'
import styles from './FallingShapesField.module.css'
import {
  buildStaticField,
  clearTrailingLine,
  type FallingDirection,
  type FallingShape,
  fallingDirection,
  fallingGrid,
  findPlacement,
  occupiedCellCount,
  targetCellCount,
} from './falling-shapes.ts'

const TICK_MS = 50
const PIECE_INTERVAL_MS = 1_250
const ENTRY_MS = 250
const TRAVEL_MS = 850
const RECYCLE_MS = 500

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
  const [geometry, setGeometry] = useState<{
    columns: number
    rows: number
    direction: FallingDirection
  }>({
    ...fallingGrid('vertical'),
    direction: 'vertical' as const,
  })
  const [pieces, setPieces] = useState<FallingShape[]>([])
  const [recycling, setRecycling] = useState(false)
  const [clearingCells, setClearingCells] = useState<{ x: number; y: number }[]>([])
  const [reducedMotion, setReducedMotion] = useState(false)
  const geometryRef = useRef(geometry)
  const previousGeometryRef = useRef(geometry)
  const progressRef = useRef(progress)
  const seedRef = useRef(seed)
  const directionRef = useRef<FallingDirection | undefined>(undefined)
  const piecesRef = useRef<FallingShape[]>([])
  const recyclingRef = useRef(false)
  const simulation = useRef({
    startedAt: Date.now(),
    nextPieceAt: PIECE_INTERVAL_MS,
    recycleUntil: 0,
    id: 0,
    settled: [] as FallingShape[],
  })

  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  useEffect(() => {
    seedRef.current = seed
  }, [seed])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const rect = root.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      setGeometry((_current) => {
        const direction = directionRef.current ?? fallingDirection(rect.width, rect.height)
        directionRef.current = direction
        const next = { ...fallingGrid(direction, rect.width, rect.height), direction }
        geometryRef.current = next
        return next
      })
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
    const previous = previousGeometryRef.current
    const changed =
      previous.direction !== geometry.direction ||
      previous.columns !== geometry.columns ||
      previous.rows !== geometry.rows
    previousGeometryRef.current = geometry
    if (!changed || reducedMotion) return
    simulation.current = {
      startedAt: Date.now(),
      nextPieceAt: PIECE_INTERVAL_MS,
      id: 0,
      recycleUntil: 0,
      settled: [],
    }
    piecesRef.current = []
    setPieces([])
    setRecycling(false)
    setClearingCells([])
    recyclingRef.current = false
  }, [geometry, reducedMotion])

  useEffect(() => {
    if (!reducedMotion) return
    const staticPieces = buildStaticField(
      geometry.direction,
      geometry.columns,
      geometry.rows,
      seedRef.current,
      Math.max(1, Math.floor(progressRef.current * 6)),
    )
    piecesRef.current = staticPieces
    simulation.current.settled = staticPieces
    setPieces(staticPieces)
  }, [geometry, reducedMotion])

  useEffect(() => {
    if (reducedMotion) return
    const timer = window.setInterval(() => {
      const state = simulation.current
      const elapsed = Date.now() - state.startedAt
      const currentGeometry = geometryRef.current
      const currentProgress = progressRef.current
      const target = targetCellCount(currentGeometry.columns, currentGeometry.rows, currentProgress)
      let next = [...state.settled]
      let active = piecesRef.current.filter((piece) => piece.phase !== 'settled')
      if (elapsed < state.recycleUntil) return
      if (recyclingRef.current) {
        recyclingRef.current = false
        setRecycling(false)
        setClearingCells([])
      }
      if (elapsed >= state.nextPieceAt && active.length === 0) {
        if (currentProgress < 1 && occupiedCellCount(next) >= target) {
          return
        }
        const id = state.id
        const pieceSeed = seedRef.current + id * 17
        const placement = findPlacement(
          currentGeometry.direction,
          currentGeometry.columns,
          currentGeometry.rows,
          next,
          pieceSeed + 1,
          !overdue,
        )
        if (!placement && (currentProgress >= 1 || estimatedDurationMs === undefined)) {
          const cleared = clearTrailingLine(
            currentGeometry.direction,
            currentGeometry.columns,
            currentGeometry.rows,
            next,
            true,
          )
          if (cleared) {
            next = cleared.shapes
            state.settled = next
            state.recycleUntil = elapsed + RECYCLE_MS
            state.nextPieceAt = state.recycleUntil
            piecesRef.current = next
            recyclingRef.current = true
            setClearingCells(cleared.cleared)
            setPieces(next)
            setRecycling(true)
            return
          }
        }
        if (placement) {
          state.id += 1
          const { shape, destination } = placement
          const height = Math.max(...shape.map((cell) => cell.y)) + 1
          active = [
            ...active,
            {
              id,
              bornAt: elapsed,
              cells: shape,
              x:
                currentGeometry.direction === 'horizontal'
                  ? currentGeometry.columns - Math.max(...shape.map((cell) => cell.x)) - 0.5
                  : destination.x,
              y: currentGeometry.direction === 'vertical' ? -height + 0.5 : destination.y,
              targetX: destination.x,
              targetY: destination.y,
              phase: 'entry',
            },
          ]
        }
        state.nextPieceAt += pieceInterval(estimatedDurationMs, currentGeometry)
      }
      active = active.map((piece) => {
        const age = elapsed - piece.bornAt
        const destination =
          piece.targetX === undefined || piece.targetY === undefined
            ? undefined
            : { x: piece.targetX, y: piece.targetY }
        if (!destination) return piece
        const amount = Math.min(1, Math.max(0, (age - ENTRY_MS) / TRAVEL_MS))
        if (amount >= 1) {
          next = [
            ...next,
            { ...piece, x: destination.x, y: destination.y, phase: 'settled' as const },
          ]
          return { ...piece, x: destination.x, y: destination.y, phase: 'settled' as const }
        }
        const startX =
          currentGeometry.direction === 'horizontal'
            ? currentGeometry.columns - Math.max(...piece.cells.map((cell) => cell.x)) - 1
            : destination.x
        const startY = currentGeometry.direction === 'vertical' ? 0 : destination.y
        const lifecycleAmount = Math.min(1, Math.max(0, age / (ENTRY_MS + TRAVEL_MS)))
        return {
          ...piece,
          x:
            currentGeometry.direction === 'horizontal'
              ? startX + (destination.x - startX) * amount
              : startX,
          y:
            currentGeometry.direction === 'vertical'
              ? startY + (destination.y - startY) * amount
              : startY,
          phase: age < ENTRY_MS ? 'entry' : lifecycleAmount < 0.35 ? 'align' : 'travel',
        }
      })
      state.settled = next
      const visible = [...next, ...active.filter((piece) => piece.phase !== 'settled')]
      piecesRef.current = visible
      setPieces(visible)
    }, TICK_MS)
    return () => window.clearInterval(timer)
  }, [estimatedDurationMs, overdue, reducedMotion])

  return (
    <div
      ref={rootRef}
      className={styles.field}
      data-running-part="falling-shapes-field"
      data-overdue={overdue || undefined}
      data-direction={geometry.direction}
      data-recycling={recycling || undefined}
      style={
        { '--shape-columns': geometry.columns, '--shape-rows': geometry.rows } as CSSProperties
      }
    >
      <div className={styles.grid}>
        {clearingCells.map((cell) => (
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

function pieceInterval(
  estimatedDurationMs: number | undefined,
  geometry: { columns: number; rows: number },
) {
  const target = Math.ceil(geometry.columns * geometry.rows * 0.85)
  if (estimatedDurationMs === undefined || target <= 0) return PIECE_INTERVAL_MS
  return Math.max(400, estimatedDurationMs / Math.max(1, Math.ceil(target / 3)))
}
