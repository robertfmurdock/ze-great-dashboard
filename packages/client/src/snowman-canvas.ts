import { resolvedCells, resolvedHat, type SnowmanSimulation } from './snowman.ts'

export function drawSnowmanCanvas(
  canvas: HTMLCanvasElement | null,
  simulation: SnowmanSimulation,
  dimensions: { width: number; height: number },
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
  const hat = resolvedHat(simulation)
  if (hat && simulation.head) {
    const radius = simulation.head.radius
    context.save()
    context.translate(hat.x * cellWidth, hat.y * cellHeight)
    context.scale(cellWidth, cellHeight)
    context.rotate(hat.angle)
    context.fillStyle = 'rgba(27, 31, 24, 0.78)'
    context.fillRect(-radius * 0.65, -2, radius * 1.3, 2)
    context.fillRect(-radius, -0.3, radius * 2, 0.45)
    context.restore()
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
