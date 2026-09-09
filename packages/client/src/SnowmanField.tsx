import { useEffect, useRef, useState } from 'react'
import styles from './SnowmanField.module.css'
import {
  advanceSnowmanSimulation,
  createSnowmanSimulation,
  interpolateSnowman,
  snowmanScenePhase,
} from './snowman.ts'
import { drawSnowmanCanvas } from './snowman-canvas.ts'

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
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  const progressRef = useRef(progress)
  const overdueRef = useRef(overdue)
  const state = useRef({
    startedAt: Date.now(),
    progressAt: Date.now(),
    progress,
    simulation: createSnowmanSimulation(),
  })

  useEffect(() => {
    progressRef.current = progress
    state.current.progressAt = Date.now()
    state.current.progress = progress
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
    if (reducedMotion) return
    state.current.simulation = createSnowmanSimulation(dimensions)
    let frame = 0
    const paint = () => {
      const current = state.current
      const elapsed =
        estimatedDurationMs === undefined
          ? Date.now() - current.startedAt
          : current.progress * estimatedDurationMs + (Date.now() - current.progressAt)
      const options = {
        progress: progressRef.current,
        estimatedDurationMs,
        overdue: overdueRef.current,
        seed,
        dimensions,
      }
      const next = advanceSnowmanSimulation(current.simulation, { ...options, elapsed })
      current.simulation = next
      const future = advanceSnowmanSimulation(next, { ...options, elapsed: next.lastElapsed + 25 })
      const scene = interpolateSnowman(next, future, (elapsed - next.lastElapsed) / 25)
      drawSnowmanCanvas(canvasRef.current, scene, dimensions)
      const root = rootRef.current
      if (root) {
        root.dataset.snowCellCount = String(next.cells.length)
        root.dataset.snowDensity = next.grid.columns < 65 ? 'compact' : 'full'
        if (next.toppled) root.dataset.snowmanToppled = 'true'
        else delete root.dataset.snowmanToppled
      }
      if (!reducedMotion) frame = window.requestAnimationFrame(paint)
    }
    frame = window.requestAnimationFrame(paint)
    return () => window.cancelAnimationFrame(frame)
  }, [dimensions, estimatedDurationMs, reducedMotion, seed])
  useEffect(() => {
    if (!reducedMotion) return
    const scene = advanceSnowmanSimulation(createSnowmanSimulation(dimensions), {
      elapsed: estimatedDurationMs === undefined ? 4800 : progress * estimatedDurationMs,
      progress,
      estimatedDurationMs,
      overdue,
      seed,
      dimensions,
    })
    drawSnowmanCanvas(canvasRef.current, scene, dimensions)
    if (rootRef.current) {
      rootRef.current.dataset.snowCellCount = String(scene.cells.length)
      if (scene.toppled) rootRef.current.dataset.snowmanToppled = 'true'
      else delete rootRef.current.dataset.snowmanToppled
    }
  }, [dimensions, estimatedDurationMs, overdue, progress, reducedMotion, seed])
  const phase = snowmanScenePhase(progress, estimatedDurationMs, overdue)
  return (
    <div
      ref={rootRef}
      className={styles.field}
      data-running-part="snowman-field"
      data-snowman-phase={phase}
      data-reduced-motion={reducedMotion || undefined}
    >
      <canvas ref={canvasRef} className={styles.canvas} data-running-part="snowman-canvas" />
    </div>
  )
}
