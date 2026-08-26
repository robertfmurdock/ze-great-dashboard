import type { Panel, Position } from './board-config.ts'

export type LayoutIssueKind = 'overlap' | 'out-of-bounds'

export type LayoutIssue = {
  panelId: string
  kind: LayoutIssueKind
  position: Position
  conflictsWith: string[]
}

type BoardLayoutAnalysis = {
  issues: LayoutIssue[]
}

type Rectangle = Position & { panelId: string }

const columnCount = 12
const rowCount = 12

/** Reports problems in the intended 12×12 space without changing live CSS-grid placement. */
export function analyzeBoardLayout(panels: readonly Panel[]): BoardLayoutAnalysis {
  const issues: LayoutIssue[] = panels.flatMap((panel) => {
    if (!panel.position || isZeroPosition(panel.position) || isPositionInCanvas(panel.position))
      return []
    return [
      {
        panelId: panel.id,
        kind: 'out-of-bounds' as const,
        position: panel.position,
        conflictsWith: [],
      },
    ]
  })

  const overlapIssues = new Map<string, LayoutIssue>()

  for (let leftIndex = 0; leftIndex < panels.length; leftIndex++) {
    const left = panels[leftIndex]
    if (!left?.position || isZeroPosition(left.position)) continue
    for (let rightIndex = leftIndex + 1; rightIndex < panels.length; rightIndex++) {
      const right = panels[rightIndex]
      if (!right?.position || isZeroPosition(right.position)) continue
      if (!overlaps(left.position, right.position)) continue
      const key = `${right.id}\u0000overlap`
      const issue = overlapIssues.get(key)
      if (issue) issue.conflictsWith.push(left.id)
      else {
        const nextIssue: LayoutIssue = {
          panelId: right.id,
          kind: 'overlap',
          position: right.position,
          conflictsWith: [left.id],
        }
        overlapIssues.set(key, nextIssue)
        issues.push(nextIssue)
      }
    }
  }

  return { issues }
}

/**
 * Projects the explicit rendered area into one legal 12×12 canvas. This is deliberately separate
 * from analysis: the live renderer continues to use the authored coordinates unchanged.
 */
export function normalizeBoardLayout(panels: readonly Panel[]): Panel[] {
  const positioned = panels.flatMap((panel) => {
    if (!panel.position || isZeroPosition(panel.position)) return []
    return [{ ...panel.position, panelId: panel.id }]
  })
  if (positioned.length === 0) return panels.map((panel) => ({ ...panel }))

  const minX = Math.min(...positioned.map((rectangle) => rectangle.x))
  const minY = Math.min(...positioned.map((rectangle) => rectangle.y))
  const maxX = Math.max(...positioned.map((rectangle) => rectangle.x + rectangle.w))
  const maxY = Math.max(...positioned.map((rectangle) => rectangle.y + rectangle.h))
  const scaleX = maxX - minX > columnCount ? columnCount / (maxX - minX) : 1
  const scaleY = maxY - minY > rowCount ? rowCount / (maxY - minY) : 1

  const accepted: Rectangle[] = []
  return panels.map((panel) => {
    const position = panel.position
    if (!position || isZeroPosition(position)) return { ...panel }

    const desired = scaleRectangle(position, minX, minY, scaleX, scaleY)
    const legal = nearestLegalRectangle(desired, accepted)
    if (!legal) return { ...panel, position: zeroPosition }
    accepted.push({ ...legal, panelId: panel.id })
    return { ...panel, position: legal }
  })
}

export function isZeroPosition(position: Position | undefined): boolean {
  return position?.x === 0 && position.y === 0 && position.w === 0 && position.h === 0
}

const zeroPosition: Position = { x: 0, y: 0, w: 0, h: 0 }

function isPositionInCanvas(position: Position): boolean {
  return (
    !isZeroPosition(position) &&
    position.x + position.w <= columnCount &&
    position.y + position.h <= rowCount
  )
}

function overlaps(left: Position, right: Position): boolean {
  return (
    left.x < right.x + right.w &&
    left.x + left.w > right.x &&
    left.y < right.y + right.h &&
    left.y + left.h > right.y
  )
}

function scaleRectangle(
  position: Position,
  minX: number,
  minY: number,
  scaleX: number,
  scaleY: number,
): Position {
  const x = scaleCoordinate(position.x, minX, scaleX)
  const y = scaleCoordinate(position.y, minY, scaleY)
  const right = scaleCoordinate(position.x + position.w, minX, scaleX)
  const bottom = scaleCoordinate(position.y + position.h, minY, scaleY)
  return {
    x,
    y,
    w: Math.max(1, right - x),
    h: Math.max(1, bottom - y),
  }
}

function scaleCoordinate(value: number, origin: number, scale: number): number {
  return Math.round((value - origin) * scale)
}

function nearestLegalRectangle(
  desired: Position,
  accepted: readonly Rectangle[],
): Position | undefined {
  const candidates: Array<Position & { shrink: number; distance: number }> = []
  for (let width = desired.w; width >= 1; width--) {
    for (let height = desired.h; height >= 1; height--) {
      const shrink = desired.w - width + (desired.h - height)
      for (let y = 0; y <= rowCount - height; y++) {
        for (let x = 0; x <= columnCount - width; x++) {
          const candidate = { x, y, w: width, h: height }
          if (accepted.some((rectangle) => overlaps(candidate, rectangle))) continue
          candidates.push({
            ...candidate,
            shrink,
            distance: Math.abs(x - desired.x) + Math.abs(y - desired.y),
          })
        }
      }
    }
  }
  candidates.sort(
    (left, right) =>
      left.shrink - right.shrink ||
      left.distance - right.distance ||
      left.y - right.y ||
      left.x - right.x,
  )
  const [candidate] = candidates
  if (!candidate) return undefined
  return { x: candidate.x, y: candidate.y, w: candidate.w, h: candidate.h }
}
