import { useEffect, useRef, useState } from 'react'
import styles from './SnowmanField.module.css'
import {
  advanceSnowmanSimulation,
  createSnowmanSimulation,
  resolvedBallCenter,
  resolvedCells,
  type SnowmanSimulation,
  snowmanScenePhase,
  snowmanStaticScene,
} from './snowman.ts'

/** A dense, seeded canvas snow scene. It remains decorative and never holds panel data. */
export function SnowmanField({
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dimensions, setDimensions] = useState({ width: 360, height: 180 })
  const [reducedMotion, setReducedMotion] = useState(false)
  const [simulation, setSimulation] = useState<SnowmanSimulation>(() => createSnowmanSimulation())
  const progressRef = useRef(progress)
  const overdueRef = useRef(overdue)
  const state = useRef({
    startedAt: Date.now(),
    lastRenderedAt: 0,
    simulation: createSnowmanSimulation(),
  })

  useEffect(() => {
    progressRef.current = progress
  }, [progress])
  useEffect(() => {
    overdueRef.current = overdue
  }, [overdue])
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const update = () => {
      const rect = root.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0)
        setDimensions({ width: rect.width, height: rect.height })
    }
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!reducedMotion) return
    const phase = snowmanScenePhase(progress, estimatedDurationMs, overdue)
    const staticSimulation = snowmanStaticScene(phase, seed, dimensions)
    state.current.simulation = staticSimulation
    setSimulation(staticSimulation)
  }, [dimensions, estimatedDurationMs, overdue, progress, reducedMotion, seed])
  useEffect(() => {
    if (reducedMotion) return
    let frame = 0
    const animate = () => {
      const current = state.current
      const elapsed = Date.now() - current.startedAt
      if (elapsed - current.lastRenderedAt < 50) {
        frame = window.requestAnimationFrame(animate)
        return
      }
      const next = advanceSnowmanSimulation(current.simulation, {
        elapsed,
        progress: progressRef.current,
        estimatedDurationMs,
        overdue: overdueRef.current,
        seed,
        dimensions,
      })
      current.simulation = next
      current.lastRenderedAt = elapsed
      setSimulation(next)
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [dimensions, estimatedDurationMs, reducedMotion, seed])
  const phase = snowmanScenePhase(progress, estimatedDurationMs, overdue)
  useEffect(
    () => drawSnow(canvasRef.current, simulation, dimensions, phase),
    [dimensions, phase, simulation],
  )
  return (
    <div
      ref={rootRef}
      className={styles.field}
      data-running-part="snowman-field"
      data-snowman-phase={phase}
      data-snowman-toppled={simulation.toppled || undefined}
      data-reduced-motion={reducedMotion || undefined}
      data-snow-density={simulation.grid.columns < 65 ? 'compact' : 'full'}
      data-snow-cell-count={simulation.cells.length}
    >
      <canvas ref={canvasRef} className={styles.canvas} data-running-part="snowman-canvas" />
    </div>
  )
}

function drawSnow(
  canvas: HTMLCanvasElement | null,
  simulation: SnowmanSimulation,
  dimensions: { width: number; height: number },
  phase: string,
) {
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  const scale = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(dimensions.width))
  const height = Math.max(1, Math.round(dimensions.height))
  if (canvas.width !== width * scale || canvas.height !== height * scale) {
    canvas.width = width * scale
    canvas.height = height * scale
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }
  context.setTransform(scale, 0, 0, scale, 0, 0)
  context.clearRect(0, 0, width, height)
  const cellWidth = width / simulation.grid.columns
  const cellHeight = height / simulation.grid.rows
  context.fillStyle = 'rgba(244, 241, 223, 0.52)'
  for (const cell of resolvedCells(simulation))
    drawDot(context, (cell.x + 0.5) * cellWidth, (cell.y + 0.5) * cellHeight, cellWidth, cellHeight)
  context.fillStyle = 'rgba(244, 241, 223, 0.76)'
  for (const flake of simulation.flakes)
    drawDot(
      context,
      (flake.x + 0.5) * cellWidth,
      (flake.y + 0.5) * cellHeight,
      cellWidth * 0.72,
      cellHeight * 0.72,
    )
  if ((phase === 'complete' || phase === 'overdue') && simulation.head) {
    const head = resolvedBallCenter(simulation, simulation.head)
    const x = head.x * cellWidth
    const y = (head.y - head.radius - 1) * cellHeight
    context.fillStyle = 'rgba(27, 31, 24, 0.78)'
    context.fillRect(
      x - head.radius * cellWidth * 0.65,
      y - cellHeight * 2,
      head.radius * cellWidth * 1.3,
      cellHeight * 2,
    )
    context.fillRect(
      x - head.radius * cellWidth,
      y - cellHeight * 0.3,
      head.radius * cellWidth * 2,
      cellHeight * 0.45,
    )
  }
}
function drawDot(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  context.beginPath()
  context.arc(x, y, Math.max(0.8, Math.min(width, height) * 0.42), 0, Math.PI * 2)
  context.fill()
}
