import type { CSSProperties } from 'react'
import styles from './FlightPathField.module.css'

export type FlightStage = 'rollout' | 'climb' | 'cruise' | 'approach' | 'holding'

export type FlightPosition = {
  /** Position in the decorative world, before the camera follows the aircraft. */
  worldX: number
  worldY: number
  /** Camera displacement in field percentages. */
  cameraX: number
  cameraY: number
  /** Aircraft position in the clipped field after camera displacement. */
  x: number
  y: number
  /** Deliberate aircraft attitude, not the tangent of its world journey. */
  pitch: number
  /** Extra downward displacement that lets the ground leave during cruise and return on approach. */
  groundOffsetY: number
  stage: FlightStage
}

type Point = { x: number; y: number }

const departure: Point = { x: 8, y: 74 }
const rotation: Point = { x: 22, y: 74 }
const cruiseStart: Point = { x: 38, y: 30 }
const cruiseEnd: Point = { x: 65, y: 30 }
// The final frame is still well above the ground: an active run has not arrived.
const approachEnd: Point = { x: 88, y: 48 }

function pointOnLine(from: Point, to: Point, progress: number): Point {
  return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress }
}

function pointOnCubic(
  start: Point,
  controlOne: Point,
  controlTwo: Point,
  end: Point,
  progress: number,
): Point {
  const inverse = 1 - progress
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * progress * controlOne.x +
      3 * inverse * progress ** 2 * controlTwo.x +
      progress ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * progress * controlOne.y +
      3 * inverse * progress ** 2 * controlTwo.y +
      progress ** 3 * end.y,
  }
}

function frame(
  world: Point,
  camera: Point,
  pitch: number,
  stage: FlightStage,
  groundOffsetY = 0,
): FlightPosition {
  return {
    worldX: world.x,
    worldY: world.y,
    cameraX: camera.x,
    cameraY: camera.y,
    x: world.x - camera.x,
    y: world.y - camera.y,
    pitch,
    groundOffsetY,
    stage,
  }
}

function followCamera(world: Point): Point {
  return { x: world.x - 50, y: world.y - 50 }
}

/**
 * Maps estimated elapsed progress to world movement, a deliberately lagged camera, and restrained
 * aircraft attitude. Keeping those concerns separate makes the field read as a tracked flight,
 * rather than as a route diagram.
 */
export function flightPosition(progress: number, indeterminate: boolean): FlightPosition {
  if (indeterminate) {
    const world = { x: 50, y: 30 }
    return frame(world, followCamera(world), 0, 'holding', 20)
  }
  const clamped = Math.min(1, Math.max(0, progress))
  if (clamped < 0.18)
    return frame(pointOnLine(departure, rotation, clamped / 0.18), { x: 0, y: 0 }, 0, 'rollout')
  if (clamped < 0.35) {
    const phase = (clamped - 0.18) / 0.17
    const world = pointOnCubic(rotation, { x: 28, y: 74 }, { x: 32, y: 30 }, cruiseStart, phase)
    // The camera takes a moment to catch up after rotation instead of snapping the plane center.
    const engagement = phase * phase * (3 - 2 * phase)
    const target = followCamera(world)
    return frame(
      world,
      { x: target.x * engagement, y: target.y * engagement },
      -7,
      'climb',
      20 * engagement,
    )
  }
  if (clamped < 0.7) {
    const world = pointOnLine(cruiseStart, cruiseEnd, (clamped - 0.35) / 0.35)
    return frame(world, followCamera(world), 0, 'cruise', 20)
  }
  const phase = (clamped - 0.7) / 0.3
  const world = pointOnCubic(cruiseEnd, { x: 72, y: 30 }, { x: 80, y: 47 }, approachEnd, phase)
  // Reintroduce the ground only during approach; cruise should read as open air.
  const returnGround = phase * phase * (3 - 2 * phase)
  return frame(world, followCamera(world), 4, 'approach', 20 * (1 - returnGround))
}

/** Decorative estimated-flight progress, framed as a camera-following aircraft shot. */
export function FlightPathField({
  progress,
  indeterminate,
}: {
  progress: number
  indeterminate: boolean
}) {
  const position = flightPosition(progress, indeterminate)
  const style = {
    '--flight-x': `${position.x}%`,
    '--flight-y': `${position.y}%`,
    '--flight-camera-x': `${position.cameraX}%`,
    '--flight-camera-y': `${position.cameraY}%`,
    '--flight-ground-x': `${-position.cameraX}%`,
    '--flight-ground-y': `${-position.cameraY + position.groundOffsetY}%`,
    '--flight-cloud-x': `${-position.cameraX * 0.45}%`,
    '--flight-cloud-y': `${-position.cameraY * 0.32}%`,
    '--flight-pitch': `${position.pitch}deg`,
  } as CSSProperties
  return (
    <span
      className={styles.scene}
      data-running-part="flight-path"
      data-flight-stage={position.stage}
      style={style}
    >
      <span className={styles.ground} data-running-part="flight-ground">
        <span className={styles.groundGlow} />
        <span className={styles.groundTerrain} data-running-part="flight-ground-terrain" />
        <span
          className={styles.groundTerrainOverdrive}
          data-running-part="flight-ground-overdrive"
        />
        <span className={styles.groundRunway} data-running-part="flight-ground-runway" />
      </span>
      <span
        className={`${styles.cloudLayer} ${styles.cloudLayerFar}`}
        data-running-part="flight-cloud-layer"
        data-flight-depth="far"
      >
        <span className={`${styles.cloud} ${styles.cloudOne}`} data-running-part="flight-cloud" />
        <span className={`${styles.cloud} ${styles.cloudTwo}`} data-running-part="flight-cloud" />
        <span className={`${styles.cloud} ${styles.cloudThree}`} data-running-part="flight-cloud" />
        <span className={`${styles.cloud} ${styles.cloudFour}`} data-running-part="flight-cloud" />
      </span>
      <span className={styles.plane} data-running-part="flight-plane">
        <svg className={styles.aircraft} viewBox="0 0 72 40" aria-hidden="true">
          <path
            data-running-part="flight-fuselage"
            d="M3 21c5-4 12-6 23-6h27c8 0 13 2 16 5-3 3-8 5-16 5H26C15 25 8 24 3 21Z"
          />
          <path data-running-part="flight-wing" d="m33 23 17 11h-12L23 24Z" />
          <path data-running-part="flight-tail" d="m13 17 5-11h7l-1 11Z" />
          <path className={styles.windows} d="M25 18h4v2h-4zm7 0h4v2h-4zm7 0h4v2h-4z" />
        </svg>
      </span>
      <span
        className={`${styles.cloudLayer} ${styles.cloudLayerNear}`}
        data-running-part="flight-cloud-layer"
        data-flight-depth="near"
      >
        <span className={`${styles.cloud} ${styles.cloudFive}`} data-running-part="flight-cloud" />
        <span className={`${styles.cloud} ${styles.cloudSix}`} data-running-part="flight-cloud" />
        <span className={`${styles.cloud} ${styles.cloudSeven}`} data-running-part="flight-cloud" />
        <span className={`${styles.cloud} ${styles.cloudEight}`} data-running-part="flight-cloud" />
      </span>
    </span>
  )
}
